function ensureKey(value, name = "cache key") {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} is required`);
  return value.trim();
}

function encode(value) {
  if (value === undefined) throw new TypeError("Redis cache cannot store undefined");
  return JSON.stringify(value);
}

export class RedisCache {
  #inflight = new Map();

  constructor({ client, namespace = "ledgerly:cache" }) {
    if (!client) throw new TypeError("RedisCache requires a Redis client");
    this.provider = "redis";
    this.client = client;
    this.namespace = ensureKey(namespace, "cache namespace");
  }

  #key(key) {
    return `${this.namespace}:entry:${ensureKey(key)}`;
  }

  #tag(tag) {
    return `${this.namespace}:tag:${ensureKey(tag, "cache tag")}`;
  }

  async get(key) {
    const raw = await this.client.get(this.#key(key));
    return raw == null ? undefined : JSON.parse(raw);
  }

  async set(key, value, { ttlMs = null, tags = [] } = {}) {
    const redisKey = this.#key(key);
    const body = encode(value);
    if (ttlMs != null) {
      if (!Number.isInteger(ttlMs) || ttlMs < 1) throw new TypeError("ttlMs must be a positive integer");
      await this.client.set(redisKey, body, { PX: ttlMs });
    } else {
      await this.client.set(redisKey, body);
    }

    const uniqueTags = [...new Set(tags.map((tag) => ensureKey(tag, "cache tag")))];
    if (uniqueTags.length > 0) {
      const multi = this.client.multi();
      for (const tag of uniqueTags) multi.sAdd(this.#tag(tag), redisKey);
      await multi.exec();
    }
    return value;
  }

  async delete(key) {
    return (await this.client.del(this.#key(key))) > 0;
  }

  async remember(key, producer, options = {}) {
    const cached = await this.get(key);
    if (cached !== undefined) return cached;
    const normalized = ensureKey(key);
    if (this.#inflight.has(normalized)) return this.#inflight.get(normalized);

    const pending = Promise.resolve()
      .then(producer)
      .then(async (value) => {
        await this.set(normalized, value, options);
        return value;
      })
      .finally(() => this.#inflight.delete(normalized));

    this.#inflight.set(normalized, pending);
    return pending;
  }

  async invalidateTag(tag) {
    const tagKey = this.#tag(tag);
    const keys = await this.client.sMembers(tagKey);
    if (!keys || keys.length === 0) {
      await this.client.del(tagKey);
      return 0;
    }
    const multi = this.client.multi();
    for (const key of keys) multi.del(key);
    multi.del(tagKey);
    await multi.exec();
    return keys.length;
  }

  async health() {
    try {
      const startedAt = Date.now();
      const pong = await this.client.ping();
      return { ok: pong === "PONG", provider: this.provider, latencyMs: Date.now() - startedAt };
    } catch (error) {
      return { ok: false, provider: this.provider, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export async function createRedisClient(config) {
  const { createClient } = await import("redis");
  const client = createClient({
    socket: {
      host: config.host,
      port: config.port,
      connectTimeout: config.connectTimeoutMs,
      reconnectStrategy: (retries) => Math.min(50 * 2 ** Math.min(retries, 6), 3000),
    },
    password: config.password || undefined,
    database: config.database ?? 0,
  });
  client.on("error", (error) => {
    console.error(JSON.stringify({ level: "error", component: "redis", message: error.message }));
  });
  await client.connect();
  return client;
}
