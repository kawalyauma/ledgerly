#!/usr/bin/env node
import { createPostgresDatabase } from "../adapters/postgres-database.mjs";
import { D1HttpSource } from "./d1-source.mjs";
import { D1MigrationRunner } from "./runner.mjs";
import { AUTH_CORE_TABLES } from "./auth-core-manifest.mjs";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for D1 migration`);
  return value;
}

function int(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? String(fallback), 10);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
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
    ssl: ["1","true","yes","on"].includes(String(process.env.LEDGERLY_DATABASE_SSL ?? "false").toLowerCase()),
    sslRejectUnauthorized: !["0","false","no","off"].includes(String(process.env.LEDGERLY_DATABASE_SSL_REJECT_UNAUTHORIZED ?? "true").toLowerCase()),
    applicationName: "ledgerly-d1-migration",
  };
}

async function main() {
  const command = process.argv[2] ?? "plan";
  const accountId = required("CLOUDFLARE_ACCOUNT_ID");
  const databaseId = required("CLOUDFLARE_D1_DATABASE_ID");
  const source = new D1HttpSource({
    accountId,
    databaseId,
    apiToken: required("CLOUDFLARE_API_TOKEN"),
    apiBaseUrl: process.env.CLOUDFLARE_API_BASE_URL ?? "https://api.cloudflare.com/client/v4",
    timeoutMs: int("LEDGERLY_D1_MIGRATION_HTTP_TIMEOUT_MS", 15000),
  });
  const database = await createPostgresDatabase(databaseConfig());
  const runner = new D1MigrationRunner({
    database,
    source,
    sourceIdentity: `d1:${accountId}:${databaseId}`,
    batchSize: int("LEDGERLY_D1_MIGRATION_BATCH_SIZE", 250),
  });

  try {
    if (command === "plan") {
      console.log(JSON.stringify(await runner.plan(AUTH_CORE_TABLES), null, 2));
      return;
    }
    if (command === "run") {
      const fresh = process.argv.includes("--fresh");
      console.log(JSON.stringify(await runner.run({ resume: !fresh }), null, 2));
      return;
    }
    if (command === "validate") {
      const runId = process.argv[3] || process.env.LEDGERLY_MIGRATION_RUN_ID;
      if (!runId) throw new Error("validate requires a run ID: migration:validate -- <run-id>");
      console.log(JSON.stringify(await runner.validate({ runId }), null, 2));
      return;
    }
    throw new Error(`Unknown migration command: ${command}`);
  } finally {
    await database.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    level: "error",
    component: "d1-migration",
    message: error instanceof Error ? error.message : String(error),
  }));
  process.exitCode = 1;
});
