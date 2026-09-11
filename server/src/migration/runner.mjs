import { AUTH_CORE_TABLES } from "./auth-core-manifest.mjs";
import { ensureAuthCoreSchema } from "./auth-core-schema.mjs";
import {
  checkpointTable,
  createMigrationRun,
  ensureMigrationMetadata,
  ensureTableState,
  failTable,
  finishRun,
  finishTableCopy,
  markTableCopying,
  recordValidation,
  resumeLatestRun,
} from "./bookkeeping.mjs";
import { validateRelationships, validateTableCounts } from "./validators.mjs";

function quoteIdentifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new TypeError(`Unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}

function buildUpsert(table, rows) {
  if (!rows.length) return null;
  const columns = table.columns;
  const values = [];
  const groups = rows.map((row) => {
    const placeholders = columns.map((column) => {
      values.push(row[column] ?? null);
      return `$${values.length}`;
    });
    return `(${placeholders.join(",")})`;
  });
  const conflict = table.conflict.map(quoteIdentifier).join(",");
  const mutable = columns.filter((column) => !table.conflict.includes(column));
  const update = mutable.length
    ? `DO UPDATE SET ${mutable.map((column) => `${quoteIdentifier(column)}=EXCLUDED.${quoteIdentifier(column)}`).join(",")}`
    : "DO NOTHING";
  return {
    sql: `INSERT INTO ${quoteIdentifier(table.name)} (${columns.map(quoteIdentifier).join(",")}) VALUES ${groups.join(",")} ON CONFLICT (${conflict}) ${update}`,
    values,
  };
}

export class D1MigrationRunner {
  constructor({ database, source, sourceIdentity, batchSize = 250, logger = console }) {
    if (!database || !source) throw new TypeError("D1MigrationRunner requires database and source");
    this.database = database;
    this.source = source;
    this.sourceIdentity = sourceIdentity;
    this.batchSize = Math.max(1, Math.min(Number(batchSize) || 250, 1000));
    this.logger = logger;
  }

  async prepare() {
    await ensureMigrationMetadata(this.database);
    await ensureAuthCoreSchema(this.database);
  }

  async plan(tables = AUTH_CORE_TABLES) {
    const items = [];
    for (const table of tables) {
      const exists = await this.source.tableExists(table.name);
      items.push({
        table: table.name,
        exists,
        sourceCount: exists ? await this.source.count(table.name) : null,
        dependencies: table.dependencies,
      });
    }
    return { phase: "auth-core", sourceIdentity: this.sourceIdentity, tables: items };
  }

  async run({ resume = true, tables = AUTH_CORE_TABLES } = {}) {
    await this.prepare();
    const existingRun = resume ? await resumeLatestRun(this.database, { sourceIdentity: this.sourceIdentity, phase: "auth-core" }) : null;
    const runId = existingRun ?? await createMigrationRun(this.database, {
      sourceIdentity: this.sourceIdentity,
      phase: "auth-core",
      metadata: { batchSize: this.batchSize, tableCount: tables.length },
    });

    try {
      for (const table of tables) await this.copyTable(runId, table);
      let validationFailed = false;
      for (const table of tables) {
        const result = await validateTableCounts(this.database, this.source, runId, table);
        if (!result.ok) validationFailed = true;
      }
      const relationships = await validateRelationships(this.database, runId);
      if (!relationships.ok) validationFailed = true;
      await finishRun(this.database, runId, validationFailed ? "validation_failed" : "completed");
      return { runId, status: validationFailed ? "validation_failed" : "completed" };
    } catch (error) {
      await finishRun(this.database, runId, "failed", error instanceof Error ? error.message : String(error)).catch(() => undefined);
      throw error;
    }
  }

  async copyTable(runId, table) {
    if (!await this.source.tableExists(table.name)) {
      const error = new Error(`Required D1 table is missing: ${table.name}`);
      await recordValidation(this.database, runId, { tableName: table.name, checkName: "source_table_exists", status: "failed", expected: { exists: true }, actual: { exists: false } });
      throw error;
    }

    const sourceCountStart = await this.source.count(table.name);
    let state = await ensureTableState(this.database, runId, table.name, sourceCountStart);
    if (state.status === "validated") return;
    await markTableCopying(this.database, runId, table.name);
    let cursor = Number(state.last_rowid ?? 0);
    let copiedRows = Number(state.copied_rows ?? 0);

    try {
      while (true) {
        const batch = await this.source.batch(table.name, {
          columns: table.columns,
          afterRowid: cursor,
          limit: this.batchSize,
        });
        if (batch.length === 0) break;
        const transformed = batch.map((row) => table.transform(row));
        const nextCursor = Math.max(...batch.map((row) => Number(row.__ledgerly_rowid)));
        const nextCopiedRows = copiedRows + batch.length;
        const upsert = buildUpsert(table, transformed);
        await this.database.transaction(async (tx) => {
          if (upsert) await tx.query(upsert.sql, upsert.values);
          await checkpointTable(tx, runId, table.name, { lastRowid: nextCursor, copiedRows: nextCopiedRows });
        });
        cursor = nextCursor;
        copiedRows = nextCopiedRows;
        this.logger.info?.(JSON.stringify({ component: "d1-migration", runId, table: table.name, copiedRows, cursor }));
      }

      const sourceCountEnd = await this.source.count(table.name);
      const target = await this.database.query(`SELECT count(*)::bigint AS count FROM ${quoteIdentifier(table.name)}`);
      const targetCount = Number(target.rows[0]?.count ?? 0);
      await finishTableCopy(this.database, runId, table.name, { sourceCountEnd, targetCount });
      await recordValidation(this.database, runId, {
        tableName: table.name,
        checkName: "source_stability",
        status: sourceCountStart === sourceCountEnd ? "passed" : "warning",
        expected: { countAtStart: sourceCountStart },
        actual: { countAtEnd: sourceCountEnd },
        details: sourceCountStart === sourceCountEnd ? {} : { note: "D1 changed during copy; final cutover requires a write pause and another validation pass." },
      });
    } catch (error) {
      await failTable(this.database, runId, table.name, error instanceof Error ? error.message : String(error)).catch(() => undefined);
      throw error;
    }
  }

  async validate({ runId, tables = AUTH_CORE_TABLES }) {
    await this.prepare();
    let failed = false;
    const counts = [];
    for (const table of tables) {
      const result = await validateTableCounts(this.database, this.source, runId, table);
      counts.push({ table: table.name, ...result });
      if (!result.ok) failed = true;
    }
    const relationships = await validateRelationships(this.database, runId);
    if (!relationships.ok) failed = true;
    return { ok: !failed, counts, relationships };
  }
}
