import test from "node:test";
import assert from "node:assert/strict";
import {
  orderMigrationPhases,
  runMigrationRehearsal,
  validateMigrationCutover,
} from "../src/migration/rehearsal.mjs";

test("rehearsal orders transitive prerequisites before requested phases", () => {
  const phases = [
    { name: "gamma", prerequisites: ["beta"] },
    { name: "alpha", prerequisites: [] },
    { name: "beta", prerequisites: ["alpha"] },
  ];
  assert.deepEqual(orderMigrationPhases({ phases, requested: ["gamma"] }), ["alpha", "beta", "gamma"]);
});

test("rehearsal rejects unknown prerequisites and dependency cycles", () => {
  assert.throws(
    () => orderMigrationPhases({ phases: [{ name: "a", prerequisites: ["missing"] }] }),
    /Unknown migration phase/,
  );
  assert.throws(
    () => orderMigrationPhases({ phases: [{ name: "a", prerequisites: ["b"] }, { name: "b", prerequisites: ["a"] }] }),
    /dependency cycle/,
  );
});

test("rehearsal passes strict-source mode through to each phase runner", async () => {
  const calls = [];
  const runnerFactory = ({ phase }) => ({
    async run(options) {
      calls.push({ phase: phase.name, options });
      return { runId: `run-${phase.name}`, phase: phase.name, status: "completed" };
    },
  });
  const result = await runMigrationRehearsal({
    database: {}, source: {}, sourceIdentity: "d1:test", phaseNames: ["auth-core"],
    requireStableSource: true, runnerFactory,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.order, ["auth-core"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.requireStableSource, true);
});

test("cutover validation fails closed when a phase has no completed run", async () => {
  const database = { query: async () => ({ rows: [] }) };
  const result = await validateMigrationCutover({
    database, source: {}, sourceIdentity: "d1:test", phaseNames: ["auth-core"],
    runnerFactory: () => { throw new Error("runner must not be created without a completed run"); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.phases[0].phase, "auth-core");
  assert.equal(result.phases[0].error, "NO_COMPLETED_MIGRATION_RUN");
});
