import { randomUUID } from "node:crypto";

export async function ensureMigrationMetadata(database) {
  await database.query(`
    CREATE TABLE IF NOT EXISTS ledgerly_meta.migration_runs (
      id uuid PRIMARY KEY,
      source_kind text NOT NULL,
      source_identity text NOT NULL,
      phase text NOT NULL,
      status text NOT NULL CHECK (status IN ('running','completed','failed','validation_failed','cancelled')),
      started_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      error text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    )
  `);
  await database.query(`
    CREATE TABLE IF NOT EXISTS ledgerly_meta.migration_table_state (
      run_id uuid NOT NULL REFERENCES ledgerly_meta.migration_runs(id) ON DELETE CASCADE,
      table_name text NOT NULL,
      status text NOT NULL CHECK (status IN ('pending','copying','copied','validated','failed')),
      last_rowid bigint NOT NULL DEFAULT 0,
      copied_rows bigint NOT NULL DEFAULT 0,
      source_count_start bigint,
      source_count_end bigint,
      target_count bigint,
      started_at timestamptz,
      completed_at timestamptz,
      error text,
      PRIMARY KEY (run_id, table_name)
    )
  `);
  await database.query(`
    CREATE TABLE IF NOT EXISTS ledgerly_meta.migration_validations (
      id bigserial PRIMARY KEY,
      run_id uuid NOT NULL REFERENCES ledgerly_meta.migration_runs(id) ON DELETE CASCADE,
      table_name text,
      check_name text NOT NULL,
      status text NOT NULL CHECK (status IN ('passed','failed','warning')),
      expected jsonb,
      actual jsonb,
      details jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await database.query("CREATE INDEX IF NOT EXISTS migration_validations_run_idx ON ledgerly_meta.migration_validations (run_id, status, table_name)");
}

export async function createMigrationRun(database, { sourceIdentity, phase = "auth-core", metadata = {} }) {
  const id = randomUUID();
  await database.query(
    `INSERT INTO ledgerly_meta.migration_runs (id,source_kind,source_identity,phase,status,metadata)
     VALUES ($1,'cloudflare-d1',$2,$3,'running',$4::jsonb)`,
    [id, sourceIdentity, phase, JSON.stringify(metadata)],
  );
  return id;
}

export async function resumeLatestRun(database, { sourceIdentity, phase = "auth-core" }) {
  const result = await database.query(
    `SELECT id FROM ledgerly_meta.migration_runs
     WHERE source_kind='cloudflare-d1' AND source_identity=$1 AND phase=$2 AND status IN ('running','failed','validation_failed')
     ORDER BY started_at DESC LIMIT 1`,
    [sourceIdentity, phase],
  );
  return result.rows[0]?.id ?? null;
}

export async function ensureTableState(database, runId, tableName, sourceCountStart) {
  await database.query(
    `INSERT INTO ledgerly_meta.migration_table_state (run_id,table_name,status,source_count_start)
     VALUES ($1,$2,'pending',$3)
     ON CONFLICT (run_id,table_name) DO UPDATE SET source_count_start=COALESCE(ledgerly_meta.migration_table_state.source_count_start,EXCLUDED.source_count_start)`,
    [runId, tableName, sourceCountStart],
  );
  const result = await database.query(
    `SELECT run_id,table_name,status,last_rowid,copied_rows,source_count_start,source_count_end,target_count,error
     FROM ledgerly_meta.migration_table_state WHERE run_id=$1 AND table_name=$2`,
    [runId, tableName],
  );
  return result.rows[0];
}

export async function markTableCopying(database, runId, tableName) {
  await database.query(
    `UPDATE ledgerly_meta.migration_table_state SET status='copying',started_at=COALESCE(started_at,now()),error=NULL WHERE run_id=$1 AND table_name=$2`,
    [runId, tableName],
  );
}

export async function checkpointTable(database, runId, tableName, { lastRowid, copiedRows }) {
  await database.query(
    `UPDATE ledgerly_meta.migration_table_state SET last_rowid=$3,copied_rows=$4,status='copying',error=NULL WHERE run_id=$1 AND table_name=$2`,
    [runId, tableName, lastRowid, copiedRows],
  );
}

export async function finishTableCopy(database, runId, tableName, { sourceCountEnd, targetCount }) {
  await database.query(
    `UPDATE ledgerly_meta.migration_table_state
     SET status='copied',source_count_end=$3,target_count=$4,completed_at=now(),error=NULL
     WHERE run_id=$1 AND table_name=$2`,
    [runId, tableName, sourceCountEnd, targetCount],
  );
}

export async function failTable(database, runId, tableName, error) {
  await database.query(
    `UPDATE ledgerly_meta.migration_table_state SET status='failed',error=$3 WHERE run_id=$1 AND table_name=$2`,
    [runId, tableName, String(error).slice(0, 8000)],
  );
}

export async function recordValidation(database, runId, { tableName = null, checkName, status, expected = null, actual = null, details = {} }) {
  await database.query(
    `INSERT INTO ledgerly_meta.migration_validations (run_id,table_name,check_name,status,expected,actual,details)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb)`,
    [runId, tableName, checkName, status, JSON.stringify(expected), JSON.stringify(actual), JSON.stringify(details)],
  );
}

export async function finishRun(database, runId, status, error = null) {
  await database.query(
    `UPDATE ledgerly_meta.migration_runs SET status=$2,completed_at=CASE WHEN $2='running' THEN NULL ELSE now() END,error=$3 WHERE id=$1`,
    [runId, status, error == null ? null : String(error).slice(0, 8000)],
  );
}
