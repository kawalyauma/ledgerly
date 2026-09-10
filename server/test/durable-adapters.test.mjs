import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { PostgresDatabase } from "../src/adapters/postgres-database.mjs";
import { RedisCache } from "../src/adapters/redis-cache.mjs";
import { RedisQueue } from "../src/adapters/redis-queue.mjs";
import { MinioStorage } from "../src/adapters/minio-storage.mjs";
import { createJobEnvelope } from "../src/contracts.mjs";

class FakeRedis {
  constructor() {
    this.strings = new Map();
    this.sets = new Map();
    this.lists = new Map();
  }
  async ping() { return "PONG"; }
  async get(key) { return this.strings.get(key) ?? null; }
  async set(key, value) { this.strings.set(key, value); return "OK"; }
  async del(key) {
    let removed = 0;
    if (this.strings.delete(key)) removed += 1;
    if (this.sets.delete(key)) removed += 1;
    if (this.lists.delete(key)) removed += 1;
    return removed;
  }
  async sAdd(key, value) {
    const set = this.sets.get(key) ?? new Set();
    const before = set.size;
    set.add(value);
    this.sets.set(key, set);
    return set.size - before;
  }
  async sMembers(key) { return [...(this.sets.get(key) ?? [])]; }
  async lPush(key, value) {
    const list = this.lists.get(key) ?? [];
    list.unshift(value);
    this.lists.set(key, list);
    return list.length;
  }
  async rPopLPush(source, destination) {
    const sourceList = this.lists.get(source) ?? [];
    const value = sourceList.pop();
    this.lists.set(source, sourceList);
    if (value == null) return null;
    const destinationList = this.lists.get(destination) ?? [];
    destinationList.unshift(value);
    this.lists.set(destination, destinationList);
    return value;
  }
  async lRem(key, count, value) {
    const list = this.lists.get(key) ?? [];
    const index = list.indexOf(value);
    if (index < 0) return 0;
    list.splice(index, 1);
    this.lists.set(key, list);
    return 1;
  }
  async lLen(key) { return (this.lists.get(key) ?? []).length; }
  multi() {
    const operations = [];
    const multi = {
      sAdd: (key, value) => { operations.push(() => this.sAdd(key, value)); return multi; },
      del: (key) => { operations.push(() => this.del(key)); return multi; },
      lRem: (key, count, value) => { operations.push(() => this.lRem(key, count, value)); return multi; },
      lPush: (key, value) => { operations.push(() => this.lPush(key, value)); return multi; },
      exec: async () => Promise.all(operations.map((operation) => operation())),
    };
    return multi;
  }
}

test("PostgresDatabase commits successful work and rolls back failures", async () => {
  const events = [];
  const client = {
    async query(text, values = []) {
      events.push(text);
      return { rows: [{ text, values }], rowCount: 1, command: text.split(" ")[0] };
    },
    release() { events.push("RELEASE"); },
  };
  const pool = {
    async query() { return { rows: [{ ok: 1 }], rowCount: 1, command: "SELECT" }; },
    async connect() { return client; },
    async end() {},
  };
  const db = new PostgresDatabase({ pool });
  assert.equal((await db.health()).ok, true);
  const result = await db.transaction((tx) => tx.query("INSERT INTO demo VALUES ($1)", [1]));
  assert.equal(result.rowCount, 1);
  assert.deepEqual(events.slice(0, 4), ["BEGIN", "INSERT INTO demo VALUES ($1)", "COMMIT", "RELEASE"]);

  events.length = 0;
  await assert.rejects(db.transaction(async () => { throw new Error("boom"); }), /boom/);
  assert.deepEqual(events, ["BEGIN", "ROLLBACK", "RELEASE"]);
});

test("RedisCache caches values and invalidates tagged entries", async () => {
  const client = new FakeRedis();
  const cache = new RedisCache({ client, namespace: "test-cache" });
  let produced = 0;
  const value = await cache.remember("org:1:classes", async () => {
    produced += 1;
    return ["P1", "P2"];
  }, { ttlMs: 1000, tags: ["org:1:academics"] });
  assert.deepEqual(value, ["P1", "P2"]);
  assert.deepEqual(await cache.get("org:1:classes"), ["P1", "P2"]);
  assert.equal(produced, 1);
  assert.equal(await cache.invalidateTag("org:1:academics"), 1);
  assert.equal(await cache.get("org:1:classes"), undefined);
  assert.equal((await cache.health()).ok, true);
});

test("RedisQueue claims, retries, acknowledges and dead-letters jobs", async () => {
  const client = new FakeRedis();
  const queue = new RedisQueue({ client, name: "reports", namespace: "test-jobs", maxAttempts: 2 });
  const job = createJobEnvelope({ kind: "report.generate", organizationId: "org-1", payload: { id: "r1" } });
  await queue.enqueue(job);
  assert.equal(await queue.size(), 1);

  const first = await queue.take();
  assert.equal(first.job.jobId, job.jobId);
  assert.equal(await queue.size(), 0);
  assert.equal((await queue.health()).processing, 1);
  assert.equal((await queue.retry(first.receipt)).retried, true);

  const second = await queue.take();
  const outcome = await queue.retry(second.receipt, { reason: "still failing" });
  assert.equal(outcome.deadLettered, true);
  assert.equal(await queue.deadLetterSize(), 1);

  const next = createJobEnvelope({ kind: "report.generate", organizationId: "org-1" });
  await queue.enqueue(next);
  const claim = await queue.take();
  assert.equal(await queue.ack(claim.receipt), true);
  assert.equal((await queue.health()).processing, 0);
});

test("MinioStorage implements provider-neutral object operations", async () => {
  const objects = new Map();
  const client = {
    async putObject(bucket, key, body, size, metadata) { objects.set(`${bucket}/${key}`, { body, size, metadata }); },
    async getObject(bucket, key) { return Readable.from([objects.get(`${bucket}/${key}`).body]); },
    async statObject(bucket, key) {
      const item = objects.get(`${bucket}/${key}`);
      if (!item) { const error = new Error("missing"); error.code = "NoSuchKey"; throw error; }
      return { size: item.size, etag: "etag", metaData: item.metadata };
    },
    async removeObject(bucket, key) { objects.delete(`${bucket}/${key}`); },
    listObjectsV2(bucket, prefix) {
      const names = [...objects.keys()]
        .filter((key) => key.startsWith(`${bucket}/${prefix}`))
        .map((key) => ({ name: key.slice(bucket.length + 1) }));
      return Readable.from(names, { objectMode: true });
    },
    async presignedGetObject(bucket, key, expires) { return `https://example.test/${bucket}/${key}?expires=${expires}`; },
    async bucketExists() { return true; },
  };
  const storage = new MinioStorage({ client, bucket: "ledgerly" });
  await storage.put("org/org-1/docs/a.txt", "hello", { contentType: "text/plain" });
  assert.equal((await storage.get("org/org-1/docs/a.txt")).toString(), "hello");
  assert.equal((await storage.head("org/org-1/docs/a.txt")).size, 5);
  assert.deepEqual(await storage.list("org/org-1/docs"), ["org/org-1/docs/a.txt"]);
  assert.match(await storage.createDownloadUrl("org/org-1/docs/a.txt"), /expires=900/);
  await storage.delete("org/org-1/docs/a.txt");
  assert.equal(await storage.head("org/org-1/docs/a.txt"), null);
  assert.equal((await storage.health()).ok, true);
});
