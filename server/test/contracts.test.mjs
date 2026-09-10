import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createJobEnvelope,
  tenantCacheKey,
  tenantStorageKey,
} from "../src/contracts.mjs";
import { MemoryCache } from "../src/adapters/memory-cache.mjs";
import { LocalStorage } from "../src/adapters/local-storage.mjs";

test("tenant helpers always preserve organization scope", () => {
  assert.equal(
    tenantCacheKey("school one", "academics", "classes", "2026"),
    "ledgerly:v1:org:school%20one:academics:classes:2026",
  );
  assert.equal(
    tenantStorageKey("org-1", "academics/plans/lesson.pdf"),
    "org/org-1/academics/plans/lesson.pdf",
  );
  assert.throws(() => tenantStorageKey("org-1", "../secret"), /traversal/i);
});

test("job envelopes contain retry and tenant metadata", () => {
  const job = createJobEnvelope({
    kind: "report.generate",
    organizationId: "org-1",
    idempotencyKey: "report:1",
    payload: { reportId: "rpt-1" },
  });
  assert.equal(job.kind, "report.generate");
  assert.equal(job.organizationId, "org-1");
  assert.equal(job.attempt, 0);
  assert.equal(job.idempotencyKey, "report:1");
  assert.ok(job.jobId.length > 10);
});

test("cache remember coalesces concurrent producers and tag invalidation removes results", async () => {
  const cache = new MemoryCache();
  let calls = 0;
  const producer = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { value: 42 };
  };

  const [left, right] = await Promise.all([
    cache.remember("key", producer, { tags: ["classes"] }),
    cache.remember("key", producer, { tags: ["classes"] }),
  ]);

  assert.deepEqual(left, { value: 42 });
  assert.deepEqual(right, { value: 42 });
  assert.equal(calls, 1);
  assert.equal(await cache.invalidateTag("classes"), 1);
  assert.equal(await cache.get("key"), undefined);
});

test("local storage supports provider-neutral put/get/head/list/delete", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "ledgerly-storage-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storage = new LocalStorage({ root });

  await storage.put("org/org-1/documents/a.txt", "hello", { contentType: "text/plain" });
  assert.equal((await storage.get("org/org-1/documents/a.txt")).toString("utf8"), "hello");
  const head = await storage.head("org/org-1/documents/a.txt");
  assert.equal(head.size, 5);
  assert.equal(head.metadata.contentType, "text/plain");
  assert.deepEqual(await storage.list("org/org-1/documents"), ["org/org-1/documents/a.txt"]);
  await storage.delete("org/org-1/documents/a.txt");
  assert.equal(await storage.head("org/org-1/documents/a.txt"), null);
  await assert.rejects(storage.get("../outside"), /traversal/i);
});
