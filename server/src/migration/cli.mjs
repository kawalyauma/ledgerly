#!/usr/bin/env node
import { createPostgresDatabase } from "../adapters/postgres-database.mjs";
import { D1HttpSource } from "./d1-source.mjs";
import { getMigrationPhase, listMigrationPhases } from "./phases.mjs";
import { D1MigrationRunner } from "./runner.mjs";

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

function option(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
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
  const args = process.argv.slice(2);
  const command = args[0] ?? "plan";
  if (command === "phases") {
    console.log(JSON.stringify(listMigrationPhases(), null, 2));
    return;
  }

  const phaseName = option(args, "--phase") || process.env.LEDGERLY_MIGRATION_PHASE || "auth-core";

  // Schema-only bootstrap is intentionally independent of Cloudflare. It is useful for
  // disposable/local self-host rehearsals where a fresh PostgreSQL database must be able
  // to accept newly registered users before any D1 data is copied. It never marks a D1
  // migration as validated and therefore does not constitute production cutover evidence.
  if (command === "schema") {
    const phase = getMigrationPhase(phaseName);
    const database = await createPostgresDatabase(databaseConfig());
    try {
      await phase.ensureSchema(database);
      if (phase.finalizeSchema) await phase.finalizeSchema(database);
      console.log(JSON.stringify({
        ok: true,
        command: "schema",
        phase: phase.name,
        tables: phase.tables.map((table) => table.name),
        migrationValidated: false,
      }, null, 2));
    } finally {
      await database.close();
    }
    return;
  }

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
    phase: phaseName,
    batchSize: int("LEDGERLY_D1_MIGRATION_BATCH_SIZE", 250),
  });

  try {
    if (command === "plan") {
      console.log(JSON.stringify(await runner.plan(), null, 2));
      return;
    }
    if (command === "run") {
      const fresh = args.includes("--fresh");
      console.log(JSON.stringify(await runner.run({ resume: !fresh }), null, 2));
      return;
    }
    if (command === "validate") {
      const runId = args[1] && !args[1].startsWith("--") ? args[1] : process.env.LEDGERLY_MIGRATION_RUN_ID;
      if (!runId) throw new Error("validate requires a run ID: validate <run-id> --phase <phase>");
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
