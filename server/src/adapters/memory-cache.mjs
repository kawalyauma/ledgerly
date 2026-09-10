export class MemoryCache {
  #entries = new Map();
  #tags = new Map();
  #inflight = new Map();

  constructor({ namespace = "foundation" } = {}) {
    this.provider = "memory";
    this.namespace = namespace;
  }

  #unlinkTags(key, entry) {
    for (const tag of entry?.tags ?? []) {
      const keys = this.#tags.get(tag);
      if (!keys) continue;
      keys.delete(key);
      if (keys.size === 0) this.#tags.delete(tag);
    }
  }

  #read(key) {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.#unlinkTags(key, entry);
      this.#entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  async get(key) {
    return this.#read(key);
  }

  async set(key, value, { ttlSeconds = null, tags = [] } = {}) {
    if (ttlSeconds !== null && (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0)) {
      throw new TypeError("ttlSeconds must be a positive number or null");
    }
    const existing = this.#entries.get(key);
    this.#unlinkTags(key, existing);
    const normalizedTags = [...new Set(tags.map(String))];
    this.#entries.set(key, {
      value,
      expiresAt: ttlSeconds === null ? null : Date.now() + ttlSeconds * 1000,
      tags: normalizedTags,
    });
    for (const tag of normalizedTags) {
      if (!this.#tags.has(tag)) this.#tags.set(tag, new Set());
      this.#tags.get(tag).add(key);
    }
    return value;
  }

  async delete(key) {
    const existing = this.#entries.get(key);
    this.#unlinkTags(key, existing);
    return this.#entries.delete(key);
  }

  async remember(key, producer, options = {}) {
    const cached = this.#read(key);
    if (cached !== undefined) return cached;
    if (this.#inflight.has(key)) return this.#inflight.get(key);

    const pending = Promise.resolve()
      .then(producer)
      .then(async (value) => {
        await this.set(key, value, options);
        return value;
      })
      .finally(() => this.#inflight.delete(key));

    this.#inflight.set(key, pending);
    return pending;
  }

  async invalidateTag(tag) {
    const keys = [...(this.#tags.get(String(tag)) ?? [])];
    await Promise.all(keys.map((key) => this.delete(key)));
    return keys.length;
  }

  async health() {
    return { ok: true, provider: this.provider, entries: this.#entries.size };
  }
}
