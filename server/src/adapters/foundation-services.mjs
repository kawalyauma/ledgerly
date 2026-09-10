import { EventEmitter } from "node:events";
import { probeTcp } from "./tcp-health.mjs";

function unavailable(name) {
  throw new Error(`${name} is not enabled in foundation mode`);
}

export class FoundationDatabase {
  constructor({ host, port, timeoutMs }) {
    this.provider = "postgresql-pending-adapter";
    this.connection = { host, port, timeoutMs };
  }

  async health() {
    return { provider: this.provider, ...(await probeTcp(this.connection)) };
  }

  async query() {
    return unavailable("Database queries");
  }

  async transaction() {
    return unavailable("Database transactions");
  }
}

export class FoundationScheduler {
  constructor() {
    this.provider = "disabled-foundation";
  }

  async register() {
    return unavailable("Scheduler registration");
  }

  async cancel() {
    return unavailable("Scheduler cancellation");
  }

  async health() {
    return { ok: true, provider: this.provider, enabled: false };
  }
}

export class FoundationEventBus {
  #emitter = new EventEmitter();

  constructor() {
    this.provider = "memory";
    this.#emitter.setMaxListeners(100);
  }

  async publish(topic, event) {
    this.#emitter.emit(topic, event);
    return { published: true };
  }

  subscribe(topic, handler) {
    this.#emitter.on(topic, handler);
    return () => this.#emitter.off(topic, handler);
  }

  async health() {
    return { ok: true, provider: this.provider };
  }
}

export class FoundationNotifications {
  constructor() {
    this.provider = "disabled-foundation";
  }

  async send() {
    return unavailable("Notification delivery");
  }

  async health() {
    return { ok: true, provider: this.provider, enabled: false };
  }
}

export class FoundationAudit {
  constructor({ logger = console } = {}) {
    this.provider = "stdout-foundation";
    this.logger = logger;
  }

  async write(event) {
    const record = {
      ...event,
      timestamp: event?.timestamp ?? new Date().toISOString(),
      durability: "non-durable-foundation",
    };
    this.logger.info(JSON.stringify({ level: "audit", ...record }));
    return record;
  }

  async health() {
    return { ok: true, provider: this.provider, durable: false };
  }
}
