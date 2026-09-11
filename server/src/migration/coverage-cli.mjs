#!/usr/bin/env node
import { resolve } from "node:path";
import { auditRepositoryMigrationCoverage } from "./coverage-audit.mjs";

function csv(value) {
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

async function main() {
  const migrationsDir = process.env.LEDGERLY_MIGRATIONS_DIR
    ? resolve(process.env.LEDGERLY_MIGRATIONS_DIR)
    : resolve(process.cwd(), "..", "migrations");
  const allowlist = csv(process.env.LEDGERLY_MIGRATION_COVERAGE_ALLOWLIST);
  const result = await auditRepositoryMigrationCoverage({ migrationsDir, allowlist });
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
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
