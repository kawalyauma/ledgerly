import { createHash } from "node:crypto";

const ENQUEUE_IDEMPOTENT_SCRIPT = `
  if redis.call('EXISTS', KEYS[1]) == 1 then
    return 0
  end
  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
  redis.call('LPUSH', KEYS[2], ARGV[3])
  return 1
`;

const PROMOTE_DUE_SCRIPT = `
  local rows = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, ARGV[2])
  local moved = 0
  for _, raw in ipairs(rows) do
    if redis.call('ZREM', KEYS[1], raw) == 1 then
      redis.call('LPUSH', KEYS[2], raw)
      moved = moved + 1
    end
  end
  return moved
`;

function requireJob(job) {
  if (!job || typeof job !== "object" || typeof job.jobId !== "string" || job.jobId.trim() === "") {
    throw new TypeError("queue expects a Ledgerly job envelope");
  }
  return job;
}

function encodeReceipt(raw) {
  return Buffer.from(raw, "utf8").toString("base64url");
}

function decodeReceipt(receipt) {
  if (typeof receipt !== "string" || receipt === "") throw new TypeError("receipt is required");
  return Buffer.from(receipt, "base64url").toString("utf8");
}

function dateScore(value, name) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  const score = date.getTime();
  if (!Number.isFinite(score)) throw new TypeError(`${name} must be a valid date`);
  return score;
}

function boundedPositive(value, fallback, max = 1000) {
  return Math.max(1, Math.min(Number(value) || fallback, max));
}

export class RedisQueue {
  constructor({
    client,
    name = "default",
    namespace = "ledgerly:jobs",
    maxAttempts = 5,
    idempotencyTtlSeconds = 604800,
    visibilityTimeoutMs = 300000,
  }) {
    if (!client) throw new TypeError("RedisQueue requires a Redis client");
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new TypeError("maxAttempts must be positive");
    if (!Number.isInteger(idempotencyTtlSeconds) || idempotencyTtlSeconds < 60) {
      throw new TypeError("idempotencyTtlSeconds must be at least 60");
    }
    if (!Number.isInteger(visibilityTimeoutMs) || visibilityTimeoutMs < 1000) {
      throw new TypeError("visibilityTimeoutMs must be at least 1000");
    }
    this.provider = "redis-durable-list";
    this.client = client;
    this.name = name;
    this.namespace = namespace;
    this.maxAttempts = maxAttempts;
    this.idempotencyTtlSeconds = idempotencyTtlSeconds;
    this.visibilityTimeoutMs = visibilityTimeoutMs;
    this.keys = Object.freeze({
      ready: `${namespace}:${name}:ready`,
      processing: `${namespace}:${name}:processing`,
      leases: `${namespace}:${name}:leases`,
      delayed: `${namespace}:${name}:delayed`,
      dead: `${namespace}:${name}:dead`,
    });
  }

  #idempotencyKey(value) {
    const digest = createHash("sha256").update(value).digest("hex");
    return `${this.namespace}:${this.name}:idempotency:${digest}`;
  }

  #leaseScore(now = Date.now(), timeoutMs = this.visibilityTimeoutMs) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000) throw new TypeError("visibility timeout must be at least 1000");
    return Number(now) + timeoutMs;
  }

  async enqueue(job) {
    const valid = requireJob(job);
    const raw = JSON.stringify(valid);
    if (valid.idempotencyKey) {
      const inserted = await this.client.eval(ENQUEUE_IDEMPOTENT_SCRIPT, {
        keys: [this.#idempotencyKey(String(valid.idempotencyKey)), this.keys.ready],
        arguments: [valid.jobId, String(this.idempotencyTtlSeconds), raw],
      });
      if (Number(inserted) !== 1) return { jobId: valid.jobId, queued: false, duplicate: true };
      return { jobId: valid.jobId, queued: true, duplicate: false };
    }
    await this.client.lPush(this.keys.ready, raw);
    return { jobId: valid.jobId, queued: true, duplicate: false };
  }

  async promoteDue({ now = new Date(), limit = 100 } = {}) {
    if (typeof this.client.zCard !== "function") return 0;
    const score = dateScore(now, "now");
    const boundedLimit = boundedPositive(limit, 100);
    return Number(await this.client.eval(PROMOTE_DUE_SCRIPT, {
      keys: [this.keys.delayed, this.keys.ready],
      arguments: [String(score), String(boundedLimit)],
    })) || 0;
  }

  async take({ now = Date.now() } = {}) {
    await this.promoteDue({ now: new Date(Number(now)) });
    const raw = await this.client.rPopLPush(this.keys.ready, this.keys.processing);
    if (raw == null) return null;
    if (typeof this.client.zAdd === "function") {
      try {
        await this.client.zAdd(this.keys.leases, [{ score: this.#leaseScore(now), value: raw }]);
      } catch (error) {
        const multi = this.client.multi();
        multi.lRem(this.keys.processing, 1, raw);
        multi.lPush(this.keys.ready, raw);
        await multi.exec();
        throw error;
      }
    }
    return { job: JSON.parse(raw), receipt: encodeReceipt(raw) };
  }

  async renew(receipt, { now = Date.now(), visibilityTimeoutMs = this.visibilityTimeoutMs } = {}) {
    const raw = decodeReceipt(receipt);
    if (typeof this.client.zAdd !== "function") return { renewed: false, supported: false };
    const score = this.#leaseScore(now, visibilityTimeoutMs);
    const result = await this.client.zAdd(this.keys.leases, [{ score, value: raw }]);
    return { renewed: Number(result) >= 0, supported: true, visibleAfter: new Date(score).toISOString() };
  }

  async #clearLease(raw, multi = null) {
    if (typeof this.client.zRem !== "function") return;
    if (multi && typeof multi.zRem === "function") multi.zRem(this.keys.leases, raw);
    else await this.client.zRem(this.keys.leases, raw);
  }

  async ack(receipt) {
    const raw = decodeReceipt(receipt);
    const multi = this.client.multi();
    multi.lRem(this.keys.processing, 1, raw);
    if (typeof multi.zRem === "function") multi.zRem(this.keys.leases, raw);
    const results = await multi.exec();
    if (typeof multi.zRem !== "function") await this.#clearLease(raw);
    const removed = Array.isArray(results) ? Number(results[0]) : 0;
    return removed > 0;
  }

  async retry(receipt, { reason = null, delayUntil = null } = {}) {
    const raw = decodeReceipt(receipt);
    const job = JSON.parse(raw);
    const next = { ...job, attempt: Number(job.attempt ?? 0) + 1 };
    if (next.attempt >= this.maxAttempts) {
      return this.deadLetter(receipt, { reason: reason ?? "max_attempts_reached" });
    }

    const nextRaw = JSON.stringify(next);
    const score = dateScore(delayUntil, "delayUntil");
    const shouldDelay = score != null && score > Date.now();
    const multi = this.client.multi();
    multi.lRem(this.keys.processing, 1, raw);
    if (typeof multi.zRem === "function") multi.zRem(this.keys.leases, raw);
    if (shouldDelay) {
      if (typeof multi.zAdd !== "function") throw new Error("Redis client does not support durable delayed retries");
      multi.zAdd(this.keys.delayed, [{ score, value: nextRaw }]);
    } else {
      multi.lPush(this.keys.ready, nextRaw);
    }
    await multi.exec();
    if (typeof multi.zRem !== "function") await this.#clearLease(raw);
    return {
      jobId: next.jobId,
      retried: true,
      attempt: next.attempt,
      delayed: shouldDelay,
      availableAt: shouldDelay ? new Date(score).toISOString() : null,
      reason,
    };
  }

  async deadLetter(receipt, { reason = "failed" } = {}) {
    const raw = decodeReceipt(receipt);
    const job = JSON.parse(raw);
    const record = JSON.stringify({ job, reason, failedAt: new Date().toISOString() });
    const multi = this.client.multi();
    multi.lRem(this.keys.processing, 1, raw);
    if (typeof multi.zRem === "function") multi.zRem(this.keys.leases, raw);
    multi.lPush(this.keys.dead, record);
    await multi.exec();
    if (typeof multi.zRem !== "function") await this.#clearLease(raw);
    return { jobId: job.jobId, deadLettered: true };
  }

  async recoverExpired({ now = new Date(), limit = 100, includeOrphans = true } = {}) {
    if (typeof this.client.zRangeByScore !== "function" || typeof this.client.zRem !== "function") {
      return { supported: false, recovered: 0, expired: 0, orphans: 0 };
    }
    const score = dateScore(now, "now");
    const boundedLimit = boundedPositive(limit, 100);
    const expired = await this.client.zRangeByScore(this.keys.leases, 0, score, {
      LIMIT: { offset: 0, count: boundedLimit },
    });
    const candidates = [...expired];
    let orphanCount = 0;

    if (includeOrphans && candidates.length < boundedLimit && typeof this.client.lRange === "function" && typeof this.client.zScore === "function") {
      const processing = await this.client.lRange(this.keys.processing, 0, Math.max(0, boundedLimit - candidates.length - 1));
      for (const raw of processing) {
        if (candidates.includes(raw)) continue;
        const lease = await this.client.zScore(this.keys.leases, raw);
        if (lease == null) {
          candidates.push(raw);
          orphanCount += 1;
          if (candidates.length >= boundedLimit) break;
        }
      }
    }

    let recovered = 0;
    for (const raw of candidates) {
      const multi = this.client.multi();
      multi.lRem(this.keys.processing, 1, raw);
      if (typeof multi.zRem === "function") multi.zRem(this.keys.leases, raw);
      multi.lPush(this.keys.ready, raw);
      const results = await multi.exec();
      const removed = Array.isArray(results) ? Number(results[0]) : 0;
      if (typeof multi.zRem !== "function") await this.client.zRem(this.keys.leases, raw);
      if (removed > 0) recovered += 1;
      else {
        try { await this.client.lRem(this.keys.ready, 1, raw); } catch { /* best effort race cleanup */ }
      }
    }
    return { supported: true, recovered, expired: expired.length, orphans: orphanCount };
  }

  async size() { return this.client.lLen(this.keys.ready); }
  async processingSize() { return this.client.lLen(this.keys.processing); }
  async delayedSize() { return typeof this.client.zCard === "function" ? this.client.zCard(this.keys.delayed) : 0; }
  async leasedSize() { return typeof this.client.zCard === "function" ? this.client.zCard(this.keys.leases) : 0; }
  async deadLetterSize() { return this.client.lLen(this.keys.dead); }

  async health() {
    try {
      const [queued, processing, delayed, leased, dead] = await Promise.all([
        this.size(), this.processingSize(), this.delayedSize(), this.leasedSize(), this.deadLetterSize(),
      ]);
      return {
        ok: true,
        provider: this.provider,
        name: this.name,
        queued,
        processing,
        delayed,
        leased,
        dead,
        visibilityTimeoutMs: this.visibilityTimeoutMs,
        recoverySupported: typeof this.client.zRangeByScore === "function" && typeof this.client.zRem === "function",
      };
    } catch (error) {
      return {
        ok: false,
        provider: this.provider,
        name: this.name,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
