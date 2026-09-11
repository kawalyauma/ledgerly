import test from "node:test";
import assert from "node:assert/strict";
import { getMigrationPhase, listMigrationPhases } from "../src/migration/phases.mjs";

test("migration phases are discovered from drop-in descriptors", () => {
  const phases = listMigrationPhases();
  const names = phases.map((phase) => phase.name);
  assert.equal(names.includes("auth-core"), true);
  assert.equal(names.includes("school-reference"), true);
  const school = getMigrationPhase("school-reference");
  assert.deepEqual(school.prerequisites, ["auth-core"]);
  assert.match(school.sourceFile, /school-reference\.phase\.mjs$/);
  assert.equal(school.tables.some((table) => table.name === "school_subjects"), true);
});

test("unknown migration phases fail closed", () => {
  assert.throws(() => getMigrationPhase("does-not-exist"), /Unknown migration phase/);
});
