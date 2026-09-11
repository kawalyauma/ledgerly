#!/usr/bin/env node
import { createPostgresDatabase } from "../adapters/postgres-database.mjs";
import { D1HttpSource } from "./d1-source.mjs";
import { listMigrationPhases } from "./phases.mjs";
import { planMigrationRehearsal, runMigrationRehearsal, validateMigrationCutover } from "./rehearsal.mjs";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for migration rehearsal`);
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

function option(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function selectedPhases(args) {
  const raw = option(args, "--phases") ?? process.env.LEDGERLY_REHEARSAL_PHASES ?? "";
  return raw.split(",").map((value) => value.trim()).filter(Boolean);
}

function databaseConfig() {
  return {
    host: process.env.LEDGERLY_DATABASE_HOST ?? "127.0.0.1",
    port: int("LEDGERLY_DATABASE_PORT", 6432),
    database: process.env.LEDGERLY_DATABASE_NAME ?? "ledgerly",
    user: process.env.LEDGERLY_DATABASE_USER ?? "ledgerly",
    password: required("LEDGERLY_DATABASE_PASSWORD"),
    poolMax: int("LEDGERLY_MIGRATION_DATABASE_POOL_MAX", 4),
    connectionTimeoutMs: int("LEDGERLY_DEPENDENCY_TIMEOUT_MS", 5000),
    idleTimeoutMs: 30000,
    ssl: bool(process.env.LEDGERLY_DATABASE_SSL, false),
    sslRejectUnauthorized: bool(process.env.LEDGERLY_DATABASE_SSL_REJECT_UNAUTHORIZED, true),
    applicationName: "ledgerly-migration-rehearsal",
  };
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] ?? "plan";
  if (command === "phases") {
    console.log(JSON.stringify(listMigrationPhases(), null, 2));
    return;
  }

  const accountId = required("CLOUDFLARE_ACCOUNT_ID");
  const databaseId = required("CLOUDFLARE_D1_DATABASE_ID");
  const sourceIdentity = `d1:${accountId}:${databaseId}`;
  const source = new D1HttpSource({
    accountId,
    databaseId,
    apiToken: required("CLOUDFLARE_API_TOKEN"),
    apiBaseUrl: process.env.CLOUDFLARE_API_BASE_URL ?? "https://api.cloudflare.com/client/v4",
    timeoutMs: int("LEDGERLY_D1_MIGRATION_HTTP_TIMEOUT_MS", 15000),
  });
  const database = await createPostgresDatabase(databaseConfig());
  const common = {
    database,
    source,
    sourceIdentity,
    batchSize: int("LEDGERLY_D1_MIGRATION_BATCH_SIZE", 250),
    phaseNames: selectedPhases(args),
  };

  try {
    if (command === "plan") {
      console.log(JSON.stringify(await planMigrationRehearsal(common), null, 2));
      return;
    }
    if (command === "run") {
      const result = await runMigrationRehearsal({
        ...common,
        resume: !args.includes("--fresh"),
        requireStableSource: args.includes("--strict") || bool(process.env.LEDGERLY_REHEARSAL_REQUIRE_STABLE_SOURCE, false),
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (command === "cutover-validate") {
      const result = await validateMigrationCutover(common);
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 2;
      return;
    }
    throw new Error(`Unknown rehearsal command: ${command}`);
  } finally {
    await database.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    level: "error",
    component: "migration-rehearsal",
    message: error instanceof Error ? error.message : String(error),
  }));
  process.exitCode = 1;
});
