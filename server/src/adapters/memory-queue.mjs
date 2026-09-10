export class MemoryQueue {
  #items = [];

  constructor({ name = "foundation" } = {}) {
    this.provider = "memory";
    this.name = name;
  }

  async enqueue(job) {
    if (!job || typeof job !== "object" || typeof job.jobId !== "string") {
      throw new TypeError("enqueue expects a Ledgerly job envelope");
    }
    this.#items.push(job);
    return { jobId: job.jobId, queued: true };
  }

  async take() {
    return this.#items.shift() ?? null;
  }

  async size() {
    return this.#items.length;
  }

  async health() {
    return { ok: true, provider: this.provider, name: this.name, queued: this.#items.length };
  }
}
