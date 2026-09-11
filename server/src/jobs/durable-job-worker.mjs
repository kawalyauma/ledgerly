function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function errorText(error) { return error instanceof Error ? error.message : String(error); }

export function exponentialRetryDelay(attempt, { baseMs = 1000, maxMs = 300000 } = {}) {
  const normalizedAttempt = Math.max(0, Number(attempt) || 0);
  return Math.min(maxMs, baseMs * (2 ** normalizedAttempt));
}

export class DurableJobWorker {
  #timer = null;
  #running = false;
  #stopping = false;
  #inFlight = new Set();

  constructor({
    queue,
    handlers,
    pollIntervalMs = 500,
    concurrency = 4,
    retryBaseMs = 1000,
    retryMaxMs = 300000,
    leaseRenewIntervalMs = null,
    logger = console,
    name = queue?.name ?? "worker",
  }) {
    if (!queue || typeof queue.take !== "function" || typeof queue.ack !== "function") {
      throw new TypeError("DurableJobWorker requires a queue service");
    }
    if (!handlers || typeof handlers !== "object") throw new TypeError("handlers are required");
    if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 50) throw new TypeError("pollIntervalMs must be at least 50");
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 128) throw new TypeError("concurrency must be between 1 and 128");
    this.queue = queue;
    this.handlers = Object.freeze({ ...handlers });
    this.pollIntervalMs = pollIntervalMs;
    this.concurrency = concurrency;
    this.retryBaseMs = retryBaseMs;
    this.retryMaxMs = retryMaxMs;
    this.leaseRenewIntervalMs = leaseRenewIntervalMs ?? Math.max(1000, Math.floor((queue.visibilityTimeoutMs ?? 300000) / 3));
    this.logger = logger;
    this.name = name;
    this.metrics = { processed: 0, succeeded: 0, retried: 0, deadLettered: 0, failed: 0 };
  }

  async #processClaim(claim) {
    const { job, receipt } = claim;
    const handler = this.handlers[job?.kind];
    if (typeof handler !== "function") {
      await this.queue.deadLetter(receipt, { reason: `unknown_job_kind:${job?.kind ?? "missing"}` });
      this.metrics.processed += 1;
      this.metrics.deadLettered += 1;
      return { status: "dead_lettered", jobId: job?.jobId };
    }

    let renewalTimer = null;
    if (typeof this.queue.renew === "function") {
      renewalTimer = setInterval(() => {
        void this.queue.renew(receipt).catch((error) => this.logger.error(JSON.stringify({
          level: "error",
          component: "job-worker",
          worker: this.name,
          jobId: job.jobId,
          message: `lease renewal failed: ${errorText(error)}`,
        })));
      }, this.leaseRenewIntervalMs);
      renewalTimer.unref?.();
    }

    try {
      await handler(job);
      const acked = await this.queue.ack(receipt);
      if (!acked) throw new Error(`Job ${job.jobId} completed but its queue receipt was no longer claimable`);
      this.metrics.processed += 1;
      this.metrics.succeeded += 1;
      return { status: "succeeded", jobId: job.jobId };
    } catch (error) {
      this.metrics.processed += 1;
      this.metrics.failed += 1;
      const delayMs = exponentialRetryDelay(job?.attempt ?? 0, {
        baseMs: this.retryBaseMs,
        maxMs: this.retryMaxMs,
      });
      try {
        const outcome = await this.queue.retry(receipt, {
          reason: errorText(error),
          delayUntil: new Date(Date.now() + delayMs),
        });
        if (outcome?.deadLettered) this.metrics.deadLettered += 1;
        else this.metrics.retried += 1;
        return {
          status: outcome?.deadLettered ? "dead_lettered" : "retried",
          jobId: job?.jobId,
          error: errorText(error),
        };
      } catch (queueError) {
        this.logger.error(JSON.stringify({
          level: "error",
          component: "job-worker",
          worker: this.name,
          jobId: job?.jobId,
          message: `job failed and retry persistence failed: ${errorText(queueError)}`,
          cause: errorText(error),
        }));
        throw queueError;
      }
    } finally {
      if (renewalTimer) clearInterval(renewalTimer);
    }
  }

  async runOnce() {
    if (this.#running || this.#stopping) {
      return { skipped: true, reason: this.#stopping ? "stopping" : "already_running" };
    }
    this.#running = true;
    const results = [];
    try {
      const claims = [];
      for (let i = 0; i < this.concurrency; i += 1) {
        const claim = await this.queue.take();
        if (!claim) break;
        claims.push(claim);
      }
      const promises = claims.map((claim) => {
        const promise = this.#processClaim(claim);
        this.#inFlight.add(promise);
        promise.finally(() => this.#inFlight.delete(promise)).catch(() => undefined);
        return promise;
      });
      results.push(...await Promise.allSettled(promises));
      return {
        claimed: claims.length,
        succeeded: results.filter((r) => r.status === "fulfilled" && r.value?.status === "succeeded").length,
        retried: results.filter((r) => r.status === "fulfilled" && r.value?.status === "retried").length,
        deadLettered: results.filter((r) => r.status === "fulfilled" && r.value?.status === "dead_lettered").length,
        workerErrors: results.filter((r) => r.status === "rejected").length,
      };
    } finally {
      this.#running = false;
    }
  }

  start() {
    if (this.#timer || this.#stopping) return;
    const tick = () => void this.runOnce().catch((error) => this.logger.error(JSON.stringify({
      level: "error",
      component: "job-worker",
      worker: this.name,
      message: errorText(error),
    })));
    tick();
    this.#timer = setInterval(tick, this.pollIntervalMs);
    this.#timer.unref?.();
  }

  async stop({ timeoutMs = 10000 } = {}) {
    this.#stopping = true;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    const deadline = Date.now() + timeoutMs;
    while ((this.#running || this.#inFlight.size > 0) && Date.now() < deadline) await sleep(10);
    const drained = !this.#running && this.#inFlight.size === 0;
    this.#stopping = false;
    return { drained, inFlight: this.#inFlight.size };
  }

  status() {
    return {
      name: this.name,
      running: Boolean(this.#timer),
      cycleInProgress: this.#running,
      inFlight: this.#inFlight.size,
      concurrency: this.concurrency,
      pollIntervalMs: this.pollIntervalMs,
      leaseRenewIntervalMs: this.leaseRenewIntervalMs,
      metrics: { ...this.metrics },
    };
  }
}
