import { randomUUID } from "node:crypto";

export class MemoryQueue {
  #items = [];
  #processing = new Map();
  #dead = [];

  constructor({ name = "foundation", maxAttempts = 5 } = {}) {
    this.provider = "memory";
    this.name = name;
    this.maxAttempts = maxAttempts;
  }

  async enqueue(job) {
    if (!job || typeof job !== "object" || typeof job.jobId !== "string") {
      throw new TypeError("enqueue expects a Ledgerly job envelope");
    }
    this.#items.push(job);
    return { jobId: job.jobId, queued: true };
  }

  async take() {
    const job = this.#items.shift();
    if (!job) return null;
    const receipt = randomUUID();
    this.#processing.set(receipt, job);
    return { job, receipt };
  }

  async ack(receipt) {
    return this.#processing.delete(receipt);
  }

  async retry(receipt, { reason = null } = {}) {
    const job = this.#processing.get(receipt);
    if (!job) return { retried: false };
    this.#processing.delete(receipt);
    const next = { ...job, attempt: Number(job.attempt ?? 0) + 1 };
    if (next.attempt >= this.maxAttempts) {
      this.#dead.push({ job: next, reason: reason ?? "max_attempts_reached", failedAt: new Date().toISOString() });
      return { jobId: next.jobId, deadLettered: true };
    }
    this.#items.push(next);
    return { jobId: next.jobId, retried: true, attempt: next.attempt };
  }

  async deadLetter(receipt, { reason = "failed" } = {}) {
    const job = this.#processing.get(receipt);
    if (!job) return { deadLettered: false };
    this.#processing.delete(receipt);
    this.#dead.push({ job, reason, failedAt: new Date().toISOString() });
    return { jobId: job.jobId, deadLettered: true };
  }

  async size() {
    return this.#items.length;
  }

  async processingSize() {
    return this.#processing.size;
  }

  async deadLetterSize() {
    return this.#dead.length;
  }

  async health() {
    return {
      ok: true,
      provider: this.provider,
      name: this.name,
      queued: this.#items.length,
      processing: this.#processing.size,
      dead: this.#dead.length,
    };
  }
}
