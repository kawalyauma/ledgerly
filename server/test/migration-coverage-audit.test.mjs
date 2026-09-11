import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateMigrationCoverage,
  extractCreatedTables,
  phaseOwnership,
  stripSqlComments,
  validateMigrationCoverageAllowlist,
} from "../src/migration/coverage-audit.mjs";

test("extractCreatedTables ignores comments and normalizes quoted/schema identifiers", () => {
  const sql = `
    -- CREATE TABLE ignored_comment (id text);
    CREATE TABLE IF NOT EXISTS users (id text primary key);
    CREATE TABLE "school_terms" (id text);
    CREATE TABLE main.[task_items] (id text);
    /* CREATE TABLE ignored_block (id text); */
    CREATE INDEX users_email_idx ON users(email);
  `;
  assert.deepEqual(extractCreatedTables(sql), ["school_terms", "task_items", "users"]);
  assert(!stripSqlComments(sql).includes("ignored_comment"));
  assert(!stripSqlComments(sql).includes("ignored_block"));
});

test("phaseOwnership accepts registry-style table names", () => {
  const owners = phaseOwnership([
    { name: "auth-core", tables: ["users", "memberships"] },
    { name: "school-reference", tables: ["school_terms"] },
  ]);
  assert.deepEqual(owners.get("users"), ["auth-core"]);
  assert.deepEqual(owners.get("school_terms"), ["school-reference"]);
});

test("coverage passes when every source table has exactly one phase owner", () => {
  const result = evaluateMigrationCoverage({
    createdTables: ["users", "school_terms"],
    phases: [
      { name: "auth-core", tables: ["users"] },
      { name: "school-reference", tables: ["school_terms"] },
    ],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.uncovered, []);
  assert.deepEqual(result.duplicateOwners, []);
});

test("coverage fails closed for an unmapped source table", () => {
  const result = evaluateMigrationCoverage({
    createdTables: ["users", "forgotten_table"],
    phases: [{ name: "auth-core", tables: ["users"] }],
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.uncovered, ["forgotten_table"]);
});

test("explicit allowlist records rather than hides intentional exceptions", () => {
  const exception = {
    table: "cloudflare_transient",
    disposition: "transient-derived",
    reason: "Rebuilt from authoritative events after cutover.",
  };
  const result = evaluateMigrationCoverage({
    createdTables: ["users", "cloudflare_transient"],
    phases: [{ name: "auth-core", tables: ["users"] }],
    allowlist: [exception],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.intentionallyUnmigrated, ["cloudflare_transient"]);
  assert.deepEqual(result.intentionallyUnmigratedDetails, [exception]);
  assert.deepEqual(result.unusedAllowlistEntries, []);
});

test("reviewed allowlist requires valid disposition, specific reason and unique tables", () => {
  assert.deepEqual(validateMigrationCoverageAllowlist({
    version: 1,
    tables: [{
      table: "cloudflare_transient",
      disposition: "cloudflare-only",
      reason: "Cloudflare delivery receipt staging remains fallback-only.",
    }],
  }), [{
    table: "cloudflare_transient",
    disposition: "cloudflare-only",
    reason: "Cloudflare delivery receipt staging remains fallback-only.",
  }]);

  assert.throws(() => validateMigrationCoverageAllowlist({
    version: 1,
    tables: [{ table: "x", disposition: "temporary", reason: "This reason is long enough." }],
  }), /invalid disposition/);
  assert.throws(() => validateMigrationCoverageAllowlist({
    version: 1,
    tables: [{ table: "x", disposition: "obsolete-empty", reason: "short" }],
  }), /minimum 12 characters/);
  assert.throws(() => validateMigrationCoverageAllowlist({
    version: 1,
    tables: [
      { table: "x", disposition: "obsolete-empty", reason: "No production rows exist." },
      { table: "x", disposition: "obsolete-empty", reason: "Duplicate exception entry." },
    ],
  }), /duplicate table/);
});

test("stale allowlist entries are surfaced for cleanup", () => {
  const result = evaluateMigrationCoverage({
    createdTables: ["users"],
    phases: [{ name: "auth-core", tables: ["users"] }],
    allowlist: [{
      table: "old_transient",
      disposition: "obsolete-empty",
      reason: "Legacy table no longer exists in source migrations.",
    }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.counts.unusedAllowlistEntries, 1);
  assert.equal(result.unusedAllowlistEntries[0].table, "old_transient");
});

test("duplicate phase ownership fails because one D1 table must have one copy authority", () => {
  const result = evaluateMigrationCoverage({
    createdTables: ["users"],
    phases: [
      { name: "auth-core", tables: ["users"] },
      { name: "shared-platform", tables: ["users"] },
    ],
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.duplicateOwners, [{ table: "users", phases: ["auth-core", "shared-platform"] }]);
});

test("target phase tables missing from source are reported as diagnostics", () => {
  const result = evaluateMigrationCoverage({
    createdTables: ["users"],
    phases: [{ name: "auth-core", tables: ["users", "target_only_projection"] }],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.phaseTablesMissingFromSource, ["target_only_projection"]);
});
