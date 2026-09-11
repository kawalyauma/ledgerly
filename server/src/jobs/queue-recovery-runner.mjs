function errorText(error) { return error instanceof Error ? error.message : String(error); }

export class QueueRecoveryRunner {
  #timer = null;
  #running = false;

  constructor({ queues, intervalMs = 30000, batchSize = 100, logger = console }) {
    if (!(queues instanceof Set) && !Array.isArray(queues)) throw new TypeError("queues must be a Set or Array");
    if (!Number.isInteger(intervalMs) || intervalMs < 1000) throw new TypeError("intervalMs must be at least 1000");
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new TypeError("batchSize must be between 1 and 1000");
    this.queues = queues;
    this.intervalMs = intervalMs;
    this.batchSize = batchSize;
    this.logger = logger;
    this.lastRunAt = null;
    this.lastRecovered = 0;
    this.lastErrors = [];
  }

  async runOnce(now = new Date()) {
    if (this.#running) return { skipped: true };
    this.#running = true;
    let recovered = 0;
    const errors = [];
    try {
      for (const queue of this.queues) {
        if (typeof queue?.recoverExpired !== "function") continue;
        try {
          const result = await queue.recoverExpired({ now, limit: this.batchSize, includeOrphans: true });
          recovered += Number(result?.recovered ?? 0);
        } catch (error) {
          const item = { queue: queue?.name ?? "unknown", error: errorText(error) };
          errors.push(item);
          this.logger.error(JSON.stringify({ level: "error", component: "queue-recovery", ...item }));
        }
      }
      this.lastRunAt = now.toISOString();
      this.lastRecovered = recovered;
      this.lastErrors = errors;
      return { recovered, errors };
    } finally {
      this.#running = false;
    }
  }

  start() {
    if (this.#timer) return;
    void this.runOnce().catch(() => undefined);
    this.#timer = setInterval(() => void this.runOnce().catch(() => undefined), this.intervalMs);
    this.#timer.unref?.();
  }

  async stop() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    while (this.#running) await new Promise((resolve) => setTimeout(resolve, 10));
  }

  status() {
    return {
      running: Boolean(this.#timer),
      sweepInProgress: this.#running,
      queues: this.queues.size ?? this.queues.length,
      intervalMs: this.intervalMs,
      batchSize: this.batchSize,
      lastRunAt: this.lastRunAt,
      lastRecovered: this.lastRecovered,
      lastErrors: [...this.lastErrors],
    };
  }
}
