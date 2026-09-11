import { readdir } from "node:fs/promises";

const PHASE_DIRECTORY = new URL("./phases/", import.meta.url);
const PHASE_SUFFIX = ".phase.mjs";

function normalizePhase(phase, sourceFile) {
  if (!phase || typeof phase !== "object") throw new TypeError(`Migration phase ${sourceFile} must export an object`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(String(phase.name ?? ""))) {
    throw new TypeError(`Migration phase ${sourceFile} has an invalid name`);
  }
  if (!Array.isArray(phase.tables)) throw new TypeError(`Migration phase ${phase.name} must define tables[]`);
  if (typeof phase.ensureSchema !== "function") throw new TypeError(`Migration phase ${phase.name} must define ensureSchema()`);
  const prerequisites = [...new Set((phase.prerequisites ?? []).filter(Boolean))];
  if (prerequisites.includes(phase.name)) throw new TypeError(`Migration phase ${phase.name} cannot depend on itself`);
  return Object.freeze({
    ...phase,
    description: String(phase.description ?? phase.name),
    prerequisites: Object.freeze(prerequisites),
    tables: Object.freeze([...phase.tables]),
    finalizeSchema: typeof phase.finalizeSchema === "function" ? phase.finalizeSchema : null,
    relationshipChecks: Object.freeze([...(phase.relationshipChecks ?? [])]),
    sourceFile,
  });
}

async function loadMigrationPhases() {
  const entries = (await readdir(PHASE_DIRECTORY))
    .filter((name) => name.endsWith(PHASE_SUFFIX))
    .sort((a, b) => a.localeCompare(b));
  const registry = new Map();
  for (const entry of entries) {
    const module = await import(new URL(`./phases/${entry}`, import.meta.url));
    const phase = normalizePhase(module.default ?? module.phase, entry);
    if (registry.has(phase.name)) {
      throw new Error(`Duplicate migration phase name ${phase.name}: ${registry.get(phase.name).sourceFile} and ${entry}`);
    }
    registry.set(phase.name, phase);
  }
  if (!registry.has("auth-core")) throw new Error("Migration phase registry must contain auth-core");
  return registry;
}

const PHASES = await loadMigrationPhases();

export function getMigrationPhase(name = "auth-core") {
  const phase = PHASES.get(name);
  if (!phase) throw new Error(`Unknown migration phase: ${name}. Available phases: ${[...PHASES.keys()].join(", ")}`);
  return phase;
}

export function listMigrationPhases() {
  return [...PHASES.values()].map(({ name, description, prerequisites, tables, sourceFile }) => ({
    name,
    description,
    prerequisites,
    tables: tables.map((table) => table.name),
    sourceFile,
  }));
}
