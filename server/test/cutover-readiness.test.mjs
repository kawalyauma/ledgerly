import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assessBackupFreshness,
  evaluatePhaseCutoverEvidence,
  probeSelfhostReadiness,
} from "../src/readiness/cutover-readiness.mjs";

function samplePhase() {
  return {
    name: "sample",
    tables: [{ name: "sample_rows" }],
    relationshipChecks: [["sample.parent", "SELECT 0"]],
  };
}

test("cutover evidence requires a strict run and every latest validation to pass", () => {
  const phase = samplePhase();
  const run = {
    id: "run-1",
    metadata: { requireStableSource: true },
    completed_at: "2026-09-11T00:00:00Z",
  };
  const validations = [
    { table_name: "sample_rows", check_name: "row_count", status: "passed" },
    { table_name: "sample_rows", check_name: "source_stability", status: "passed" },
    { table_name: "sample_rows", check_name: "final_cutover_source_stability", status: "passed" },
    { table_name: null, check_name: "relationship:sample.parent", status: "passed" },
  ];

  assert.deepEqual(evaluatePhaseCutoverEvidence({ phase, run, validations }), {
    ok: true,
    phase: "sample",
    runId: "run-1",
    completedAt: "2026-09-11T00:00:00Z",
    strict: true,
    failures: [],
  });
});

test("cutover evidence fails closed for non-strict or missing validations", () => {
  const result = evaluatePhaseCutoverEvidence({
    phase: samplePhase(),
    run: { id: "run-2", metadata: { requireStableSource: false } },
    validations: [{ table_name: "sample_rows", check_name: "row_count", status: "failed" }],
  });
  assert.equal(result.ok, false);
  assert(result.failures.includes("LATEST_COMPLETED_RUN_NOT_STRICT"));
  assert(result.failures.includes("VALIDATION_FAILED:sample_rows:row_count"));
  assert(result.failures.some((failure) => failure.startsWith("MISSING_VALIDATION:")));
});

test("self-host readiness probe only passes a ready response", async () => {
  const ready = await probeSelfhostReadiness("https://ledgerly.test", {
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ status: "ready", ok: true }) }),
  });
  assert.equal(ready.ok, true);

  const degraded = await probeSelfhostReadiness("https://ledgerly.test", {
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ status: "degraded", ok: false }) }),
  });
  assert.equal(degraded.ok, false);
});

test("backup freshness requires fresh PostgreSQL/object backups and checksum manifests", async () => {
  const root = await mkdtemp(join(tmpdir(), "ledgerly-readiness-"));
  try {
    const postgres = join(root, "postgres");
    const objects = join(root, "objects", "20260911T000000Z");
    await mkdir(postgres, { recursive: true });
    await mkdir(objects, { recursive: true });
    const dump = join(postgres, "ledgerly-20260911T000000Z.dump");
    await writeFile(dump, "test-dump");
    await writeFile(`${dump}.sha256`, "placeholder\n");
    await writeFile(join(objects, "SHA256SUMS"), "placeholder\n");

    const healthy = await assessBackupFreshness({ root, maxAgeHours: 24, now: Date.now() });
    assert.equal(healthy.ok, true);

    await rm(`${dump}.sha256`);
    const broken = await assessBackupFreshness({ root, maxAgeHours: 24, now: Date.now() });
    assert.equal(broken.ok, false);
    assert(broken.checks.some((check) => check.name === "postgres-checksum" && !check.ok));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
