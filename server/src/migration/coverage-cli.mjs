#!/usr/bin/env node
import { resolve } from "node:path";
import {
  auditRepositoryMigrationCoverage,
  loadMigrationCoverageAllowlist,
} from "./coverage-audit.mjs";

async function main() {
  const migrationsDir = process.env.LEDGERLY_MIGRATIONS_DIR
    ? resolve(process.env.LEDGERLY_MIGRATIONS_DIR)
    : resolve(process.cwd(), "..", "migrations");
  const allowlistFile = process.env.LEDGERLY_MIGRATION_COVERAGE_ALLOWLIST_FILE
    ? resolve(process.env.LEDGERLY_MIGRATION_COVERAGE_ALLOWLIST_FILE)
    : resolve(process.cwd(), "src", "migration", "coverage-allowlist.json");
  const policy = await loadMigrationCoverageAllowlist({ file: allowlistFile });
  const result = await auditRepositoryMigrationCoverage({
    migrationsDir,
    allowlist: policy.entries,
  });
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    policy: {
      file: policy.file,
      version: policy.version,
      exceptions: policy.entries.length,
    },
    ...result,
  }, null, 2));
  if (!result.ok) process.exitCode = 2;
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    component: "migration-coverage",
    error: error instanceof Error ? error.message : String(error),
  }));
  process.exitCode = 1;
});
