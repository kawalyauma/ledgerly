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

function delayScore(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  const score = date.getTime();
  if (!Number.isFinite(score)) throw new TypeError("delayUntil must be a valid date");
  return score;
}

export class RedisQueue {
  constructor({
    client,
    name = "default",
    namespace = "ledgerly:jobs",
    maxAttempts = 5,
    idempotencyTtlSeconds = 604800,
  }) {
    if (!client) throw new TypeError("RedisQueue requires a Redis client");
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new TypeError("maxAttempts must be positive");
    if (!Number.isInteger(idempotencyTtlSeconds) || idempotencyTtlSeconds < 60) {
      throw new TypeError("idempotencyTtlSeconds must be at least 60");
    }
    this.provider = "redis-durable-list";
    this.client = client;
    this.name = name;
    this.namespace = namespace;
    this.maxAttempts = maxAttempts;
    this.idempotencyTtlSeconds = idempotencyTtlSeconds;
    this.keys = Object.freeze({
      ready: `${namespace}:${name}:ready`,
      processing: `${namespace}:${name}:processing`,
      delayed: `${namespace}:${name}:delayed`,
      dead: `${namespace}:${name}:dead`,
    });
  }

  #idempotencyKey(value) {
    const digest = createHash("sha256").update(value).digest("hex");
    return `${this.namespace}:${this.name}:idempotency:${digest}`;
  }

  async enqueue(job) {
    const valid = requireJob(job);
    const raw = JSON.stringify(valid);
    if (valid.idempotencyKey) {
      const inserted = await this.client.eval(ENQUEUE_IDEMPOTENT_SCRIPT, {
        keys: [this.#idempotencyKey(String(valid.idempotencyKey)), this.keys.ready],
        arguments: [valid.jobId, String(this.idempotencyTtlSeconds), raw],
      });
      if (Number(inserted) !== 1) {
        return { jobId: valid.jobId, queued: false, duplicate: true };
      }
      return { jobId: valid.jobId, queued: true, duplicate: false };
    }

    await this.client.lPush(this.keys.ready, raw);
    return { jobId: valid.jobId, queued: true, duplicate: false };
  }

  async promoteDue({ now = new Date(), limit = 100 } = {}) {
    if (typeof this.client.zCard !== "function") return 0;
    const score = delayScore(now);
    const moved = await this.client.eval(PROMOTE_DUE_SCRIPT, {
      keys: [this.keys.delayed, this.keys.ready],
      arguments: [String(score), String(Math.max(1, Math.min(Number(limit) || 100, 1000)))],
    });
    return Number(moved) || 0;
  }

  async take() {
    await this.promoteDue();
    const raw = await this.client.rPopLPush(this.keys.ready, this.keys.processing);
    if (raw == null) return null;
    return { job: JSON.parse(raw), receipt: encodeReceipt(raw) };
  }

  async ack(receipt) {
    const raw = decodeReceipt(receipt);
    const removed = await this.client.lRem(this.keys.processing, 1, raw);
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
    const score = delayScore(delayUntil);
    const delayed = score != null && score > Date.now();
    const multi = this.client.multi();
    multi.lRem(this.keys.processing, 1, raw);
    if (delayed) multi.zAdd(this.keys.delayed, [{ score, value: nextRaw }]);
    else multi.lPush(this.keys.ready, nextRaw);
    await multi.exec();
    return {
      jobId: next.jobId,
      retried: true,
      attempt: next.attempt,
      delayed,
      availableAt: score == null ? null : new Date(score).toISOString(),
    };
  }

  async deadLetter(receipt, { reason = "failed" } = {}) {
    const raw = decodeReceipt(receipt);
    const job = JSON.parse(raw);
    const record = JSON.stringify({
      job,
      reason,
      failedAt: new Date().toISOString(),
    });
    const multi = this.client.multi();
    multi.lRem(this.keys.processing, 1, raw);
    multi.lPush(this.keys.dead, record);
    await multi.exec();
    return { jobId: job.jobId, deadLettered: true };
  }

  async size() {
    return this.client.lLen(this.keys.ready);
  }

  async processingSize() {
    return this.client.lLen(this.keys.processing);
  }

  async delayedSize() {
    return typeof this.client.zCard === "function" ? this.client.zCard(this.keys.delayed) : 0;
  }

  async deadLetterSize() {
    return this.client.lLen(this.keys.dead);
  }

  async health() {
    try {
      const [queued, processing, delayed, dead] = await Promise.all([
        this.size(),
        this.processingSize(),
        this.delayedSize(),
        this.deadLetterSize(),
      ]);
      return {
        ok: true,
        provider: this.provider,
        name: this.name,
        queued,
        processing,
        delayed,
        dead,
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
