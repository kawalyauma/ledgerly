import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { listMigrationPhases } from "./phases.mjs";

const ALLOWLIST_DISPOSITIONS = new Set(["cloudflare-only", "transient-derived", "obsolete-empty"]);

function normalizeIdentifier(value) {
  return String(value ?? "")
    .trim()
    .replace(/^[`"[]/, "")
    .replace(/[`"\]]$/, "")
    .split(".")
    .at(-1)
    ?.replace(/^[`"[]/, "")
    .replace(/[`"\]]$/, "")
    .trim();
}

function normalizeAllowlist(allowlist = []) {
  const entries = [];
  for (const item of allowlist ?? []) {
    if (typeof item === "string") {
      const table = normalizeIdentifier(item);
      if (table) entries.push({ table, disposition: null, reason: null });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const table = normalizeIdentifier(item.table);
    if (!table) continue;
    entries.push({
      table,
      disposition: item.disposition ? String(item.disposition) : null,
      reason: item.reason ? String(item.reason).trim() : null,
    });
  }
  return entries;
}

export function stripSqlComments(sql) {
  return String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\r\n]*/g, " ");
}

export function extractCreatedTables(sql) {
  const source = stripSqlComments(sql);
  const tables = new Set();
  const pattern = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:[`"\[]?[A-Za-z_][A-Za-z0-9_$-]*[`"\]]?\.)?[`"\[]?[A-Za-z_][A-Za-z0-9_$-]*[`"\]]?)/gi;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const name = normalizeIdentifier(match[1]);
    if (name) tables.add(name);
  }
  return [...tables].sort((a, b) => a.localeCompare(b));
}

export function phaseOwnership(phases = listMigrationPhases()) {
  const owners = new Map();
  for (const phase of phases) {
    for (const tableName of phase.tables ?? []) {
      const name = typeof tableName === "string" ? tableName : tableName?.name;
      if (!name) continue;
      if (!owners.has(name)) owners.set(name, []);
      owners.get(name).push(phase.name);
    }
  }
  return owners;
}

export function validateMigrationCoverageAllowlist(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) throw new Error("coverage allowlist must be a JSON object");
  if (document.version !== 1) throw new Error("coverage allowlist version must be 1");
  if (!Array.isArray(document.tables)) throw new Error("coverage allowlist tables must be an array");
  const seen = new Set();
  return document.tables.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`coverage allowlist tables[${index}] must be an object`);
    const table = normalizeIdentifier(entry.table);
    if (!table) throw new Error(`coverage allowlist tables[${index}].table is required`);
    if (seen.has(table)) throw new Error(`coverage allowlist contains duplicate table: ${table}`);
    seen.add(table);
    const disposition = String(entry.disposition ?? "").trim();
    if (!ALLOWLIST_DISPOSITIONS.has(disposition)) {
      throw new Error(`coverage allowlist ${table} has invalid disposition: ${disposition || "<empty>"}`);
    }
    const reason = String(entry.reason ?? "").trim();
    if (reason.length < 12) throw new Error(`coverage allowlist ${table} requires a specific reason (minimum 12 characters)`);
    return { table, disposition, reason };
  });
}

export async function loadMigrationCoverageAllowlist({ file }) {
  if (!file) throw new TypeError("coverage allowlist file is required");
  const path = resolve(file);
  const document = JSON.parse(await readFile(path, "utf8"));
  return { file: path, version: document.version, entries: validateMigrationCoverageAllowlist(document) };
}

export function evaluateMigrationCoverage({ createdTables, phases = listMigrationPhases(), allowlist = [] }) {
  const created = [...new Set(createdTables.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const normalizedAllowlist = normalizeAllowlist(allowlist);
  const allowed = new Map(normalizedAllowlist.map((entry) => [entry.table, entry]));
  const owners = phaseOwnership(phases);
  const migrated = [...owners.keys()].sort((a, b) => a.localeCompare(b));
  const uncovered = created.filter((table) => !owners.has(table) && !allowed.has(table));
  const intentionallyUnmigrated = created.filter((table) => !owners.has(table) && allowed.has(table));
  const intentionallyUnmigratedDetails = intentionallyUnmigrated.map((table) => allowed.get(table));
  const phaseTablesMissingFromSource = migrated.filter((table) => !created.includes(table));
  const unusedAllowlistEntries = normalizedAllowlist.filter((entry) => !created.includes(entry.table) || owners.has(entry.table));
  const duplicateOwners = [...owners.entries()]
    .filter(([, phaseNames]) => new Set(phaseNames).size > 1)
    .map(([table, phaseNames]) => ({ table, phases: [...new Set(phaseNames)].sort() }))
    .sort((a, b) => a.table.localeCompare(b.table));

  return {
    ok: uncovered.length === 0 && duplicateOwners.length === 0,
    counts: {
      sourceTables: created.length,
      phaseTables: migrated.length,
      uncovered: uncovered.length,
      intentionallyUnmigrated: intentionallyUnmigrated.length,
      duplicateOwners: duplicateOwners.length,
      phaseTablesMissingFromSource: phaseTablesMissingFromSource.length,
      unusedAllowlistEntries: unusedAllowlistEntries.length,
    },
    uncovered,
    intentionallyUnmigrated,
    intentionallyUnmigratedDetails,
    duplicateOwners,
    phaseTablesMissingFromSource,
    unusedAllowlistEntries,
    ownership: Object.fromEntries([...owners.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
}

export async function scanD1MigrationTables({ migrationsDir }) {
  if (!migrationsDir) throw new TypeError("migrationsDir is required");
  const directory = resolve(migrationsDir);
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .sort((a, b) => a.name.localeCompare(b.name));
  const files = [];
  const tables = new Set();
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    const created = extractCreatedTables(await readFile(path, "utf8"));
    for (const table of created) tables.add(table);
    files.push({ file: entry.name, createdTables: created });
  }
  return { migrationsDir: directory, files, tables: [...tables].sort((a, b) => a.localeCompare(b)) };
}

export async function auditRepositoryMigrationCoverage({ migrationsDir, phases = listMigrationPhases(), allowlist = [] }) {
  const source = await scanD1MigrationTables({ migrationsDir });
  const coverage = evaluateMigrationCoverage({ createdTables: source.tables, phases, allowlist });
  return { ...coverage, source: { migrationsDir: source.migrationsDir, filesScanned: source.files.length, files: source.files } };
}

export const MIGRATION_COVERAGE_ALLOWLIST_DISPOSITIONS = Object.freeze([...ALLOWLIST_DISPOSITIONS]);
