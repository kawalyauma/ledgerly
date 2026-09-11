import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { getMigrationPhase, listMigrationPhases } from "../migration/phases.mjs";
import { orderMigrationPhases } from "../migration/rehearsal.mjs";

function parseJson(value) {
  if (value == null) return {};
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return {}; }
}

function latestByCheck(rows) {
  const latest = new Map();
  for (const row of rows) {
    const key = `${row.table_name ?? ""}\u0000${row.check_name}`;
    if (!latest.has(key)) latest.set(key, row);
  }
  return latest;
}

export function requiredPhaseValidationChecks(phase) {
  const checks = [];
  for (const table of phase.tables ?? []) {
    checks.push({ tableName: table.name, checkName: "row_count" });
    checks.push({ tableName: table.name, checkName: "source_stability" });
    checks.push({ tableName: table.name, checkName: "final_cutover_source_stability" });
  }
  for (const check of phase.relationshipChecks ?? []) {
    checks.push({ tableName: null, checkName: `relationship:${check[0]}` });
  }
  return checks;
}

export function evaluatePhaseCutoverEvidence({ phase, run, validations = [] }) {
  const failures = [];
  if (!run) return { ok: false, phase: phase.name, failures: ["NO_STRICT_COMPLETED_RUN"] };
  const metadata = parseJson(run.metadata);
  if (metadata.requireStableSource !== true) failures.push("LATEST_COMPLETED_RUN_NOT_STRICT");

  const latest = latestByCheck(validations);
  for (const required of requiredPhaseValidationChecks(phase)) {
    const key = `${required.tableName ?? ""}\u0000${required.checkName}`;
    const row = latest.get(key);
    if (!row) {
      failures.push(`MISSING_VALIDATION:${required.tableName ?? "phase"}:${required.checkName}`);
      continue;
    }
    if (row.status !== "passed") failures.push(`VALIDATION_${String(row.status).toUpperCase()}:${required.tableName ?? "phase"}:${required.checkName}`);
  }

  return {
    ok: failures.length === 0,
    phase: phase.name,
    runId: run.id,
    completedAt: run.completed_at ?? null,
    strict: metadata.requireStableSource === true,
    failures,
  };
}

async function strictCompletedRun(database, { sourceIdentity, phaseName }) {
  const result = await database.query(
    `SELECT id,phase,status,metadata,started_at,completed_at
       FROM ledgerly_meta.migration_runs
      WHERE source_kind='cloudflare-d1'
        AND source_identity=$1
        AND phase=$2
        AND status='completed'
        AND COALESCE((metadata->>'requireStableSource')::boolean,false)=true
      ORDER BY completed_at DESC NULLS LAST, started_at DESC
      LIMIT 1`,
    [sourceIdentity, phaseName],
  );
  return result.rows[0] ?? null;
}

async function runValidations(database, runId) {
  if (!runId) return [];
  const result = await database.query(
    `SELECT id,table_name,check_name,status,expected,actual,details,created_at
       FROM ledgerly_meta.migration_validations
      WHERE run_id=$1
      ORDER BY table_name NULLS FIRST,check_name,created_at DESC,id DESC`,
    [runId],
  );
  return result.rows;
}

export async function assessMigrationCutoverReadiness(database, { sourceIdentity, phaseNames = [] } = {}) {
  if (!database?.query) throw new TypeError("database.query is required");
  if (!sourceIdentity) throw new TypeError("sourceIdentity is required");
  const order = orderMigrationPhases({ phases: listMigrationPhases(), requested: phaseNames });
  const phases = [];
  for (const phaseName of order) {
    const phase = getMigrationPhase(phaseName);
    const run = await strictCompletedRun(database, { sourceIdentity, phaseName });
    const validations = await runValidations(database, run?.id);
    phases.push(evaluatePhaseCutoverEvidence({ phase, run, validations }));
  }
  return { ok: phases.every((phase) => phase.ok), sourceIdentity, order, phases };
}

export async function probeSelfhostReadiness(baseUrl, { timeoutMs = 5000, fetchImpl = fetch } = {}) {
  if (!baseUrl) return { ok: false, error: "SELFHOST_BASE_URL_NOT_CONFIGURED" };
  const url = new URL("/selfhost/ready", baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { headers: { accept: "application/json" }, signal: controller.signal });
    const body = await response.json().catch(() => null);
    return {
      ok: response.ok && body?.status === "ready" && body?.ok !== false,
      status: response.status,
      url: url.toString(),
      body,
    };
  } catch (error) {
    return { ok: false, url: url.toString(), error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function newestMatching(directory, predicate) {
  const entries = await readdir(directory, { withFileTypes: true });
  let newest = null;
  for (const entry of entries) {
    if (!predicate(entry)) continue;
    const path = join(directory, entry.name);
    const info = await stat(path);
    if (!newest || info.mtimeMs > newest.mtimeMs) newest = { path, name: entry.name, mtimeMs: info.mtimeMs, size: info.size, isDirectory: entry.isDirectory() };
  }
  return newest;
}

async function sha256File(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

function parseSha256Lines(text) {
  const rows = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const line = rawLine.startsWith("\\") ? rawLine.slice(1) : rawLine;
    const hash = line.slice(0, 64).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error(`Invalid SHA256SUMS line: ${rawLine}`);
    let file = line.slice(64).trimStart();
    if (file.startsWith("*")) file = file.slice(1);
    if (!file) throw new Error(`Missing path in SHA256SUMS line: ${rawLine}`);
    rows.push({ hash, file });
  }
  return rows;
}

function manifestTarget(baseDir, listedPath) {
  const target = resolve(isAbsolute(listedPath) ? listedPath : join(baseDir, listedPath));
  const rel = relative(resolve(baseDir), target);
  if (rel === "" || rel === ".") throw new Error("Checksum manifest points to the backup directory itself");
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`Checksum path escapes backup directory: ${listedPath}`);
  return target;
}

async function collectBackupFiles(directory, { exclude = new Set() } = {}) {
  const files = [];
  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in backup verification: ${path}`);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && !exclude.has(resolve(path))) files.push(resolve(path));
    }
  }
  await walk(directory);
  return files.sort();
}

async function verifyPostgresChecksum(dumpPath, checksumPath) {
  const rows = parseSha256Lines(await readFile(checksumPath, "utf8"));
  if (rows.length !== 1) throw new Error(`Expected one PostgreSQL checksum entry, found ${rows.length}`);
  const listed = manifestTarget(resolve(dumpPath, ".."), rows[0].file);
  if (listed !== resolve(dumpPath)) throw new Error("PostgreSQL checksum manifest does not reference the selected dump");
  const actual = await sha256File(dumpPath);
  if (actual !== rows[0].hash) throw new Error("PostgreSQL backup checksum mismatch");
  return { ok: true, path: checksumPath, filesVerified: 1 };
}

async function verifyObjectChecksums(directory, checksumPath) {
  const rows = parseSha256Lines(await readFile(checksumPath, "utf8"));
  const expected = new Map();
  for (const row of rows) {
    const target = manifestTarget(directory, row.file);
    if (expected.has(target)) throw new Error(`Duplicate checksum entry: ${row.file}`);
    expected.set(target, row.hash);
  }
  const actualFiles = await collectBackupFiles(directory, { exclude: new Set([resolve(checksumPath)]) });
  if (actualFiles.length !== expected.size) {
    throw new Error(`Object backup manifest count mismatch: manifest=${expected.size} files=${actualFiles.length}`);
  }
  for (const path of actualFiles) {
    const expectedHash = expected.get(path);
    if (!expectedHash) throw new Error(`Object backup file missing from checksum manifest: ${relative(directory, path)}`);
    const actualHash = await sha256File(path);
    if (actualHash !== expectedHash) throw new Error(`Object backup checksum mismatch: ${relative(directory, path)}`);
  }
  return { ok: true, path: checksumPath, filesVerified: actualFiles.length };
}

export async function assessBackupFreshness({ root, maxAgeHours = 26, now = Date.now() } = {}) {
  if (!root) return { ok: false, error: "BACKUP_ROOT_NOT_CONFIGURED" };
  const maxAgeMs = Math.max(1, Number(maxAgeHours) || 26) * 3600_000;
  try {
    const postgres = await newestMatching(join(root, "postgres"), (entry) => entry.isFile() && entry.name.endsWith(".dump"));
    const objects = await newestMatching(join(root, "objects"), (entry) => entry.isDirectory());
    const checks = [];
    for (const [name, item] of [["postgres", postgres], ["objects", objects]]) {
      if (!item) { checks.push({ name, ok: false, error: "MISSING_BACKUP" }); continue; }
      const ageMs = now - item.mtimeMs;
      checks.push({ name, ok: ageMs >= 0 && ageMs <= maxAgeMs, path: item.path, ageHours: ageMs / 3600_000, size: item.size });
    }
    if (postgres) {
      const checksumPath = `${postgres.path}.sha256`;
      try {
        checks.push({ name: "postgres-checksum", ...(await verifyPostgresChecksum(postgres.path, checksumPath)) });
      } catch (error) {
        checks.push({ name: "postgres-checksum", ok: false, error: error instanceof Error ? error.message : String(error), path: checksumPath });
      }
    }
    if (objects) {
      const checksumPath = join(objects.path, "SHA256SUMS");
      try {
        checks.push({ name: "objects-checksum", ...(await verifyObjectChecksums(objects.path, checksumPath)) });
      } catch (error) {
        checks.push({ name: "objects-checksum", ok: false, error: error instanceof Error ? error.message : String(error), path: checksumPath });
      }
    }
    return { ok: checks.every((check) => check.ok), root, maxAgeHours, checks };
  } catch (error) {
    return { ok: false, root, error: error instanceof Error ? error.message : String(error) };
  }
}
