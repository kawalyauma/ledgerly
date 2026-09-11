#!/usr/bin/env node
import { resolve } from "node:path";
import { createPostgresDatabase } from "../adapters/postgres-database.mjs";
import { assessBackupFreshness, assessMigrationCutoverReadiness, probeSelfhostReadiness } from "./cutover-readiness.mjs";
import { assessRepositoryExposure } from "./security-exposure.mjs";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for readiness checks`);
  return value;
}

function int(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? String(fallback), 10);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function bool(value, fallback = false) {
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1","true","yes","on"].includes(normalized)) return true;
  if (["0","false","no","off"].includes(normalized)) return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

function databaseConfig() {
  return {
    host: process.env.LEDGERLY_DATABASE_HOST ?? "127.0.0.1",
    port: int("LEDGERLY_DATABASE_PORT", 6432),
    database: process.env.LEDGERLY_DATABASE_NAME ?? "ledgerly",
    user: process.env.LEDGERLY_DATABASE_USER ?? "ledgerly",
    password: required("LEDGERLY_DATABASE_PASSWORD"),
    poolMax: int("LEDGERLY_READINESS_DATABASE_POOL_MAX", 2),
    connectionTimeoutMs: int("LEDGERLY_DEPENDENCY_TIMEOUT_MS", 5000),
    idleTimeoutMs: 10000,
    ssl: bool(process.env.LEDGERLY_DATABASE_SSL, false),
    sslRejectUnauthorized: bool(process.env.LEDGERLY_DATABASE_SSL_REJECT_UNAUTHORIZED, true),
    applicationName: "ledgerly-cutover-readiness",
  };
}

function selectedPhases() {
  return String(process.env.LEDGERLY_READINESS_PHASES ?? "").split(",").map((value) => value.trim()).filter(Boolean);
}

function repositoryRoot() {
  return process.env.LEDGERLY_REPOSITORY_ROOT
    ? resolve(process.env.LEDGERLY_REPOSITORY_ROOT)
    : resolve(process.cwd(), "..");
}

async function main() {
  const command = process.argv[2] ?? "cutover";
  const accountId = required("CLOUDFLARE_ACCOUNT_ID");
  const databaseId = required("CLOUDFLARE_D1_DATABASE_ID");
  const sourceIdentity = `d1:${accountId}:${databaseId}`;
  const database = await createPostgresDatabase(databaseConfig());

  try {
    const migration = await assessMigrationCutoverReadiness(database, { sourceIdentity, phaseNames: selectedPhases() });
    if (command === "migration") {
      console.log(JSON.stringify({ ok: migration.ok, migration }, null, 2));
      if (!migration.ok) process.exitCode = 2;
      return;
    }
    if (command !== "cutover") throw new Error(`Unknown readiness command: ${command}`);

    const [runtime, backups, security] = await Promise.all([
      probeSelfhostReadiness(required("LEDGERLY_SELFHOST_BASE_URL"), { timeoutMs: int("LEDGERLY_READINESS_HTTP_TIMEOUT_MS", 5000) }),
      assessBackupFreshness({
        root: required("LEDGERLY_BACKUP_ROOT"),
        maxAgeHours: int("LEDGERLY_BACKUP_MAX_AGE_HOURS", 26),
      }),
      assessRepositoryExposure({ root: repositoryRoot() }),
    ]);
    const checks = { migration, runtime, backups, security };
    const ok = Object.values(checks).every((check) => check.ok === true);
    console.log(JSON.stringify({ ok, checkedAt: new Date().toISOString(), checks }, null, 2));
    if (!ok) process.exitCode = 2;
  } finally {
    await database.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    level: "error",
    component: "cutover-readiness",
    message: error instanceof Error ? error.message : String(error),
  }));
  process.exitCode = 1;
});
