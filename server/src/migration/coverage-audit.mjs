import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { listMigrationPhases } from "./phases.mjs";

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

export function evaluateMigrationCoverage({ createdTables, phases = listMigrationPhases(), allowlist = [] }) {
  const created = [...new Set(createdTables.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const allowed = new Set(allowlist.filter(Boolean));
  const owners = phaseOwnership(phases);
  const migrated = [...owners.keys()].sort((a, b) => a.localeCompare(b));
  const uncovered = created.filter((table) => !owners.has(table) && !allowed.has(table));
  const intentionallyUnmigrated = created.filter((table) => !owners.has(table) && allowed.has(table));
  const phaseTablesMissingFromSource = migrated.filter((table) => !created.includes(table));
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
    },
    uncovered,
    intentionallyUnmigrated,
    duplicateOwners,
    phaseTablesMissingFromSource,
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
