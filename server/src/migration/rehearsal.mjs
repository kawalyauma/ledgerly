import { ensureMigrationMetadata } from "./bookkeeping.mjs";
import { getMigrationPhase, listMigrationPhases } from "./phases.mjs";
import { D1MigrationRunner } from "./runner.mjs";

export function orderMigrationPhases({ phases = listMigrationPhases(), requested = [] } = {}) {
  const registry = new Map(phases.map((phase) => [phase.name, phase]));
  const targets = requested.length ? [...new Set(requested)] : phases.map((phase) => phase.name);
  const state = new Map();
  const ordered = [];

  function visit(name, trail = []) {
    const phase = registry.get(name);
    if (!phase) throw new Error(`Unknown migration phase in rehearsal plan: ${name}`);
    const current = state.get(name);
    if (current === "done") return;
    if (current === "visiting") throw new Error(`Migration phase dependency cycle: ${[...trail, name].join(" -> ")}`);
    state.set(name, "visiting");
    for (const prerequisite of phase.prerequisites ?? []) visit(prerequisite, [...trail, name]);
    state.set(name, "done");
    ordered.push(name);
  }

  for (const target of targets) visit(target);
  return ordered;
}

function defaultRunnerFactory(options) {
  return new D1MigrationRunner(options);
}

export async function planMigrationRehearsal({
  database,
  source,
  sourceIdentity,
  batchSize = 250,
  phaseNames = [],
  logger = console,
  runnerFactory = defaultRunnerFactory,
} = {}) {
  const order = orderMigrationPhases({ requested: phaseNames });
  const plans = [];
  for (const phaseName of order) {
    const runner = runnerFactory({ database, source, sourceIdentity, phase: getMigrationPhase(phaseName), batchSize, logger });
    plans.push(await runner.plan());
  }
  return { ok: true, mode: "plan", sourceIdentity, order, phases: plans };
}

export async function runMigrationRehearsal({
  database,
  source,
  sourceIdentity,
  batchSize = 250,
  phaseNames = [],
  resume = true,
  requireStableSource = false,
  logger = console,
  runnerFactory = defaultRunnerFactory,
} = {}) {
  const order = orderMigrationPhases({ requested: phaseNames });
  const results = [];
  for (const phaseName of order) {
    const runner = runnerFactory({ database, source, sourceIdentity, phase: getMigrationPhase(phaseName), batchSize, logger });
    const result = await runner.run({ resume, requireStableSource });
    results.push(result);
    if (result.status !== "completed") {
      const error = new Error(`Migration rehearsal stopped: phase ${phaseName} finished with ${result.status}`);
      error.results = results;
      throw error;
    }
  }
  return { ok: true, mode: "run", sourceIdentity, requireStableSource, order, phases: results };
}

export async function latestCompletedMigrationRun(database, { sourceIdentity, phaseName }) {
  await ensureMigrationMetadata(database);
  const result = await database.query(
    `SELECT id,phase,status,started_at,completed_at
       FROM ledgerly_meta.migration_runs
      WHERE source_kind='cloudflare-d1' AND source_identity=$1 AND phase=$2 AND status='completed'
      ORDER BY completed_at DESC NULLS LAST, started_at DESC
      LIMIT 1`,
    [sourceIdentity, phaseName],
  );
  return result.rows[0] ?? null;
}

export async function validateMigrationCutover({
  database,
  source,
  sourceIdentity,
  batchSize = 250,
  phaseNames = [],
  logger = console,
  runnerFactory = defaultRunnerFactory,
} = {}) {
  const order = orderMigrationPhases({ requested: phaseNames });
  const results = [];
  let ok = true;

  for (const phaseName of order) {
    const completedRun = await latestCompletedMigrationRun(database, { sourceIdentity, phaseName });
    if (!completedRun) {
      ok = false;
      results.push({ phase: phaseName, ok: false, error: "NO_COMPLETED_MIGRATION_RUN" });
      continue;
    }
    const runner = runnerFactory({ database, source, sourceIdentity, phase: getMigrationPhase(phaseName), batchSize, logger });
    const validation = await runner.validateCutover({ runId: completedRun.id });
    if (!validation.ok) ok = false;
    results.push({ phase: phaseName, runId: completedRun.id, ...validation });
  }

  return { ok, mode: "cutover-validate", sourceIdentity, order, phases: results };
}
