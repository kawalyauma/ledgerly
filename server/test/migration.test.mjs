import test from "node:test";
import assert from "node:assert/strict";
import { D1HttpSource } from "../src/migration/d1-source.mjs";
import { AUTH_CORE_TABLES } from "../src/migration/auth-core-manifest.mjs";
import { assertMigrationPrerequisites } from "../src/migration/bookkeeping.mjs";
import { getMigrationPhase, listMigrationPhases } from "../src/migration/phases.mjs";
import { D1MigrationRunner } from "../src/migration/runner.mjs";
import { SCHOOL_REFERENCE_TABLES } from "../src/migration/school-reference-manifest.mjs";
import { ensureSchoolReferenceSchema, finalizeSchoolReferenceSchema } from "../src/migration/school-reference-schema.mjs";
import { validateTableCounts } from "../src/migration/validators.mjs";

class CopyDatabase {
  constructor() {
    this.state = { status: "pending", last_rowid: 0, copied_rows: 0 };
    this.targetRows = new Map();
    this.validations = [];
  }
  async query(sql, values = []) {
    if (sql.includes("INSERT INTO ledgerly_meta.migration_table_state")) return { rows: [] };
    if (sql.includes("SELECT run_id,table_name,status,last_rowid")) return { rows: [{ ...this.state }] };
    if (sql.includes("SET status='copying'")) { this.state.status = "copying"; return { rows: [] }; }
    if (sql.includes("SET last_rowid=$3")) {
      this.state.last_rowid = Number(values[2]);
      this.state.copied_rows = Number(values[3]);
      return { rows: [] };
    }
    if (sql.startsWith("INSERT INTO \"demo\"")) {
      for (let index = 0; index < values.length; index += 2) this.targetRows.set(values[index], values[index + 1]);
      return { rows: [], rowCount: values.length / 2 };
    }
    if (sql.includes('SELECT count(*)::bigint AS count FROM "demo"')) return { rows: [{ count: this.targetRows.size }] };
    if (sql.includes("SET status='copied'")) { this.state.status = "copied"; return { rows: [] }; }
    if (sql.includes("SET status='failed'")) { this.state.status = "failed"; return { rows: [] }; }
    if (sql.includes("INSERT INTO ledgerly_meta.migration_validations")) { this.validations.push(values); return { rows: [] }; }
    throw new Error(`Unexpected SQL in CopyDatabase: ${sql.slice(0, 120)}`);
  }
  async transaction(work) { return work({ query: this.query.bind(this) }); }
}

test("D1HttpSource sends parameterized Cloudflare queries without leaking the token into SQL", async () => {
  const calls = [];
  const source = new D1HttpSource({
    accountId: "acct",
    databaseId: "db",
    apiToken: "secret-token",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, async json() { return { success: true, result: [{ success: true, results: [{ count: 2 }] }] }; } };
    },
  });
  assert.equal(await source.count("users"), 2);
  assert.match(calls[0].url, /accounts\/acct\/d1\/database\/db\/query$/);
  assert.equal(calls[0].init.headers.Authorization, "Bearer secret-token");
  assert.doesNotMatch(JSON.parse(calls[0].init.body).sql, /secret-token/);
  await assert.rejects(() => source.count("users; DROP TABLE users"), /unsupported characters/);
});

test("auth-core manifest converts SQLite security flags to booleans", () => {
  const account = AUTH_CORE_TABLES.find((item) => item.name === "accounts");
  const transformedAccount = account.transform({ id: "a", organization_id: "o", allow_posting: 1, active: 0 });
  assert.equal(transformedAccount.allow_posting, true);
  assert.equal(transformedAccount.active, false);
  const mfa = AUTH_CORE_TABLES.find((item) => item.name === "school_user_mfa");
  assert.equal(mfa.transform({ organization_id: "o", user_id: "u", method: "totp", enabled: 1 }).enabled, true);
});

test("school-reference phase preserves dependency order and SQLite flags", async () => {
  const phase = getMigrationPhase("school-reference");
  assert.deepEqual(phase.prerequisites, ["auth-core"]);
  assert.deepEqual(phase.tables.map((item) => item.name), [
    "school_profiles", "school_branches", "school_academic_years", "school_terms", "school_departments",
    "school_class_levels", "school_classes", "school_streams", "school_subjects", "school_class_subjects", "school_lesson_periods",
  ]);
  const currentYear = SCHOOL_REFERENCE_TABLES.find((item) => item.name === "school_academic_years")
    .transform({ id: "y", organization_id: "o", is_current: 1 });
  assert.equal(currentYear.is_current, true);
  const classSubject = SCHOOL_REFERENCE_TABLES.find((item) => item.name === "school_class_subjects")
    .transform({ id: "cs", organization_id: "o", compulsory: 0, active: 1 });
  assert.equal(classSubject.compulsory, false);
  assert.equal(classSubject.active, true);

  const source = { async tableExists() { return true; }, async count() { return 1; } };
  const runner = new D1MigrationRunner({ database: {}, source, sourceIdentity: "test", phase: "school-reference" });
  const plan = await runner.plan();
  assert.equal(plan.phase, "school-reference");
  assert.deepEqual(plan.prerequisites, ["auth-core"]);
  assert.equal(plan.tables.length, 11);
  assert.equal(listMigrationPhases().some((item) => item.name === "school-reference"), true);
});

test("migration phase prerequisites fail closed until the same D1 source completed them", async () => {
  const missingDatabase = {
    async query(sql, values) {
      assert.match(sql, /status='completed'/);
      assert.equal(values[0], "d1:acct:db");
      assert.deepEqual(values[1], ["auth-core"]);
      return { rows: [] };
    },
  };
  await assert.rejects(
    () => assertMigrationPrerequisites(missingDatabase, { sourceIdentity: "d1:acct:db", prerequisites: ["auth-core"] }),
    /auth-core/,
  );

  const completedDatabase = {
    async query() { return { rows: [{ phase: "auth-core" }] }; },
  };
  const result = await assertMigrationPrerequisites(completedDatabase, {
    sourceIdentity: "d1:acct:db",
    prerequisites: ["auth-core", "auth-core"],
  });
  assert.deepEqual(result, { ok: true, completed: ["auth-core"], missing: [] });
});

test("school self-references are finalized only after reference rows can be copied", async () => {
  const sql = [];
  const database = { async query(text) { sql.push(text); return { rows: [] }; } };
  await ensureSchoolReferenceSchema(database);
  assert.equal(sql.some((text) => text.includes("school_departments_parent_fk")), false);
  assert.equal(sql.some((text) => text.includes("school_class_levels_promotion_fk")), false);
  await finalizeSchoolReferenceSchema(database);
  assert.equal(sql.at(-1).includes("school_departments_parent_fk"), true);
  assert.equal(sql.at(-1).includes("school_class_levels_promotion_fk"), true);
});

test("copy resumes from the last committed rowid after a failed batch", async () => {
  const database = new CopyDatabase();
  const requested = [];
  let failOnce = true;
  const source = {
    async tableExists() { return true; },
    async count() { return 3; },
    async batch(_table, { afterRowid }) {
      requested.push(afterRowid);
      if (afterRowid === 0) return [
        { __ledgerly_rowid: 1, id: "a", value: "one" },
        { __ledgerly_rowid: 2, id: "b", value: "two" },
      ];
      if (afterRowid === 2 && failOnce) { failOnce = false; throw new Error("temporary D1 failure"); }
      if (afterRowid === 2) return [{ __ledgerly_rowid: 3, id: "c", value: "three" }];
      return [];
    },
  };
  const table = {
    name: "demo",
    columns: ["id", "value"],
    conflict: ["id"],
    dependencies: [],
    transform: (row) => ({ id: row.id, value: row.value }),
  };
  const runner = new D1MigrationRunner({ database, source, sourceIdentity: "test", batchSize: 2, logger: { info() {} } });
  await assert.rejects(runner.copyTable("00000000-0000-0000-0000-000000000001", table), /temporary D1 failure/);
  assert.equal(database.state.last_rowid, 2);
  assert.equal(database.state.copied_rows, 2);
  await runner.copyTable("00000000-0000-0000-0000-000000000001", table);
  assert.equal(database.state.last_rowid, 3);
  assert.equal(database.state.copied_rows, 3);
  assert.deepEqual([...database.targetRows.keys()].sort(), ["a", "b", "c"]);
  assert.deepEqual(requested, [0, 2, 2, 3]);
});

test("row-count validation fails closed when target differs from D1", async () => {
  const validations = [];
  const database = {
    async query(sql, values = []) {
      if (sql.startsWith("SELECT count(*)")) return { rows: [{ count: 4 }] };
      if (sql.includes("INSERT INTO ledgerly_meta.migration_validations")) { validations.push(values); return { rows: [] }; }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const source = { async count() { return 5; } };
  const result = await validateTableCounts(database, source, "00000000-0000-0000-0000-000000000001", { name: "users" });
  assert.equal(result.ok, false);
  assert.equal(result.sourceCount, 5);
  assert.equal(result.targetCount, 4);
  assert.equal(validations.length, 1);
});
