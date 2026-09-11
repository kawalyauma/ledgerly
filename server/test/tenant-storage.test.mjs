import test from "node:test";
import assert from "node:assert/strict";
import { TenantScopedStorage, createTenantStorageFactory } from "../src/adapters/tenant-storage.mjs";

class FakeStorage {
  constructor() {
    this.provider = "fake";
    this.objects = new Map();
    this.calls = [];
  }

  async put(key, bytes, metadata = {}) {
    this.calls.push(["put", key]);
    const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    this.objects.set(key, { body, metadata });
    return { key, size: body.length, provider: this.provider };
  }

  async get(key) {
    this.calls.push(["get", key]);
    const item = this.objects.get(key);
    if (!item) throw new Error("missing");
    return item.body;
  }

  async head(key) {
    this.calls.push(["head", key]);
    const item = this.objects.get(key);
    if (!item) return null;
    return { key, size: item.body.length, metadata: item.metadata };
  }

  async delete(key) {
    this.calls.push(["delete", key]);
    return this.objects.delete(key);
  }

  async list(prefix = "") {
    this.calls.push(["list", prefix]);
    return [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
  }

  async createDownloadUrl(key, options = {}) {
    this.calls.push(["download", key]);
    return `https://example.invalid/${encodeURIComponent(key)}?expires=${options.expiresSeconds ?? 900}`;
  }

  async health() {
    return { ok: true, provider: this.provider };
  }
}

test("tenant storage maps logical keys under exactly one organization prefix", async () => {
  const backing = new FakeStorage();
  const storage = new TenantScopedStorage({ storage: backing, organizationId: "org one" });

  const written = await storage.put("documents/report card.pdf", "hello", { contentType: "application/pdf" });
  assert.equal(written.key, "documents/report card.pdf");
  assert.equal(written.tenantScoped, true);
  assert.equal(backing.calls[0][1], "org/org%20one/documents/report%20card.pdf");

  assert.equal((await storage.get("documents/report card.pdf")).toString("utf8"), "hello");
  const head = await storage.head("documents/report card.pdf");
  assert.equal(head.key, "documents/report card.pdf");
  assert.equal(head.size, 5);
  assert.deepEqual(await storage.list("documents"), ["documents/report card.pdf"]);

  const url = await storage.createDownloadUrl("documents/report card.pdf", { expiresSeconds: 60 });
  assert.match(url, /org%2Forg%2520one%2Fdocuments%2Freport%2520card\.pdf/);
});

test("tenant storage never treats a caller supplied tenant-looking path as a physical key", async () => {
  const backing = new FakeStorage();
  const storage = new TenantScopedStorage({ storage: backing, organizationId: "org-a" });

  await storage.put("org/org-b/private/secret.txt", "safe");
  assert.equal(backing.objects.has("org/org-b/private/secret.txt"), false);
  assert.equal(backing.objects.has("org/org-a/org/org-b/private/secret.txt"), true);
  assert.deepEqual(await storage.list(), ["org/org-b/private/secret.txt"]);
});

test("tenant storage rejects traversal and backing keys outside its tenant prefix", async () => {
  const backing = new FakeStorage();
  const storage = new TenantScopedStorage({ storage: backing, organizationId: "org-a" });

  await assert.rejects(storage.put("../secret.txt", "no"), /traversal/i);
  backing.objects.set("org/org-a/good.txt", { body: Buffer.from("ok"), metadata: {} });
  backing.objects.set("org/org-b/bad.txt", { body: Buffer.from("bad"), metadata: {} });

  const originalList = backing.list.bind(backing);
  backing.list = async (prefix) => [...await originalList(prefix), "org/org-b/bad.txt"];
  await assert.rejects(storage.list(), /outside the tenant prefix/i);
});

test("tenant storage factory reuses scoped views without crossing organizations", async () => {
  const backing = new FakeStorage();
  const factory = createTenantStorageFactory(backing);
  const a1 = factory.forOrganization("org-a");
  const a2 = factory.forOrganization("org-a");
  const b = factory.forOrganization("org-b");

  assert.equal(a1, a2);
  assert.notEqual(a1, b);
  await a1.put("same.txt", "A");
  await b.put("same.txt", "B");
  assert.equal((await a1.get("same.txt")).toString("utf8"), "A");
  assert.equal((await b.get("same.txt")).toString("utf8"), "B");
  assert.deepEqual([...backing.objects.keys()].sort(), ["org/org-a/same.txt", "org/org-b/same.txt"]);
});
