import { randomUUID } from "node:crypto";

function requireTopic(topic) {
  if (typeof topic !== "string" || topic.trim() === "") throw new TypeError("event topic is required");
  return topic.trim();
}

export class RedisEventBus {
  #handlers = new Map();
  #listeners = new Map();

  constructor({ publisher, subscriber, namespace = "ledgerly:selfhost", logger = console }) {
    if (!publisher || typeof publisher.publish !== "function") throw new TypeError("RedisEventBus requires a Redis publisher");
    if (!subscriber || typeof subscriber.subscribe !== "function") throw new TypeError("RedisEventBus requires a Redis subscriber");
    this.provider = "redis-pubsub";
    this.publisher = publisher;
    this.subscriber = subscriber;
    this.namespace = namespace;
    this.logger = logger;
  }

  #channel(topic) {
    return `${this.namespace}:events:${requireTopic(topic)}`;
  }

  async publish(topic, event) {
    const normalizedTopic = requireTopic(topic);
    const envelope = Object.freeze({
      id: randomUUID(),
      topic: normalizedTopic,
      publishedAt: new Date().toISOString(),
      event,
    });
    const subscribers = await this.publisher.publish(this.#channel(normalizedTopic), JSON.stringify(envelope));
    return { published: true, eventId: envelope.id, subscribers: Number(subscribers ?? 0) };
  }

  async subscribe(topic, handler) {
    const normalizedTopic = requireTopic(topic);
    if (typeof handler !== "function") throw new TypeError("event handler must be a function");
    const channel = this.#channel(normalizedTopic);
    let handlers = this.#handlers.get(channel);
    if (!handlers) {
      handlers = new Set();
      this.#handlers.set(channel, handlers);
    }
    handlers.add(handler);

    if (!this.#listeners.has(channel)) {
      const listener = (raw) => {
        let envelope;
        try {
          envelope = JSON.parse(raw);
        } catch (error) {
          this.logger.error(JSON.stringify({
            level: "error",
            component: "events",
            channel,
            message: "Dropped invalid Redis event payload",
            error: error instanceof Error ? error.message : String(error),
          }));
          return;
        }
        const current = [...(this.#handlers.get(channel) ?? [])];
        for (const currentHandler of current) {
          Promise.resolve(currentHandler(envelope.event, envelope)).catch((error) => {
            this.logger.error(JSON.stringify({
              level: "error",
              component: "events",
              channel,
              eventId: envelope.id,
              message: error instanceof Error ? error.message : String(error),
            }));
          });
        }
      };
      this.#listeners.set(channel, listener);
      await this.subscriber.subscribe(channel, listener);
    }

    let active = true;
    return async () => {
      if (!active) return;
      active = false;
      const current = this.#handlers.get(channel);
      current?.delete(handler);
      if (current && current.size === 0) {
        this.#handlers.delete(channel);
        this.#listeners.delete(channel);
        await this.subscriber.unsubscribe(channel);
      }
    };
  }

  async health() {
    try {
      const pong = await this.publisher.ping();
      return {
        ok: pong === "PONG" && this.subscriber.isOpen !== false,
        provider: this.provider,
        distributed: true,
        subscriptions: this.#listeners.size,
      };
    } catch (error) {
      return {
        ok: false,
        provider: this.provider,
        distributed: true,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async close() {
    const channels = [...this.#listeners.keys()];
    if (channels.length > 0 && this.subscriber.isOpen !== false) {
      await this.subscriber.unsubscribe(channels).catch(() => undefined);
    }
    this.#handlers.clear();
    this.#listeners.clear();
    if (this.subscriber.isOpen !== false && typeof this.subscriber.quit === "function") {
      await this.subscriber.quit();
    }
  }
}

export async function createRedisEventBus({ client, namespace, logger = console }) {
  if (!client || typeof client.duplicate !== "function") throw new TypeError("Redis client must support duplicate()");
  const subscriber = client.duplicate();
  await subscriber.connect();
  return new RedisEventBus({ publisher: client, subscriber, namespace, logger });
}
