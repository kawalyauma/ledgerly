import test from "node:test";
import assert from "node:assert/strict";
import { PostgresAudit } from "../src/adapters/postgres-audit.mjs";
import { PostgresScheduler } from "../src/adapters/postgres-scheduler.mjs";
import { SchedulerRunner } from "../src/scheduler-runner.mjs";

class RecordingDatabase {
  constructor() {
    this.calls = [];
    this.auditRows = [];
  }

  async query(text, values = []) {
    this.calls.push({ text, values });
    if (text.includes("INSERT INTO ledgerly_meta.audit_events")) {
      const row = {
        id: values[0],
        organization_id: values[1],
        actor_type: values[2],
        actor_id: values[3],
        agent_id: values[4],
        agent_name: values[5],
        agent_role: values[6],
        action: values[7],
        entity_type: values[8],
        entity_id: values[9],
        before_data: values[10] == null ? null : JSON.parse(values[10]),
        after_data: values[11] == null ? null : JSON.parse(values[11]),
        reason: values[12],
        request_id: values[13],
        metadata: JSON.parse(values[14]),
        occurred_at: values[15],
        created_at: values[15],
      };
      this.auditRows.unshift(row);
      return { rows: [row], rowCount: 1 };
    }
    if (text.includes("FROM ledgerly_meta.audit_events") && text.includes("ORDER BY")) {
      return { rows: [...this.auditRows], rowCount: this.auditRows.length };
    }
    if (text.includes("SELECT id FROM ledgerly_meta.audit_events")) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 0 };
  }
}

test("PostgresAudit persists exact AI agent provenance and supports filtered history", async () => {
  const database = new RecordingDatabase();
  const audit = new PostgresAudit({ database });
  await audit.ensureSchema();

  const record = await audit.write({
    organizationId: "org-1",
    actorType: "ai_agent",
    actorId: "agt-academic-001",
    agentId: "agt-academic-001",
    agentName: "Mirembe",
    agentRole: "Academic Assistant",
    action: "lesson_plan.section.updated",
    entityType: "lesson_plan",
    entityId: "lp-1",
    before: { methods: null },
    after: { methods: "Group discussion" },
    reason: "Filled missing teaching methods",
    requestId: "req-1",
    metadata: { taskId: "task-1" },
    timestamp: "2026-09-11T00:00:00.000Z",
  });

  assert.equal(record.actor_type, "ai_agent");
  assert.equal(record.agent_name, "Mirembe");
  assert.equal(record.agent_role, "Academic Assistant");
  assert.deepEqual(record.after_data, { methods: "Group discussion" });

  const history = await audit.list({ organizationId: "org-1", actorType: "ai_agent", limit: 20 });
  assert.equal(history.length, 1);
  const listCall = database.calls.find((call) => call.text.includes("ORDER BY occurred_at DESC"));
  assert.match(listCall.text, /organization_id = \$1/);
  assert.match(listCall.text, /actor_type = \$2/);
  assert.deepEqual(listCall.values, ["org-1", "ai_agent", 20]);
  assert.equal((await audit.health()).ok, true);

  await assert.rejects(
    audit.write({ actorType: "unknown", actorId: "x", action: "x", entityType: "x" }),
    /Unsupported actor_type/,
  );
});

test("PostgresScheduler registers schedules and claims due work with stale-lock recovery", async () => {
  const calls = [];
  const database = {
    async query(text, values = []) {
      calls.push({ text, values });
      if (text.includes("INSERT INTO ledgerly_meta.schedules")) {
        return {
          rows: [{
            id: values[0], name: values[1], organization_id: values[2], kind: values[3],
            cron_expression: values[4], timezone: values[5], payload: JSON.parse(values[6]),
            enabled: values[7], misfire_policy: values[8], next_run_at: values[9],
          }],
          rowCount: 1,
        };
      }
      if (text.includes("WITH due AS")) {
        return {
          rows: [{
            id: "hourly-reports", name: "Hourly reports", organization_id: "system",
            kind: "reports.hourly", cron_expression: "0 * * * *", timezone: "UTC",
            payload: {}, enabled: true, misfire_policy: "coalesce",
            next_run_at: "2026-09-11T01:00:00.000Z", locked_by: values[3],
          }],
          rowCount: 1,
        };
      }
      if (text.includes("count(*)::int AS enabled_count")) return { rows: [{ enabled_count: 1 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };
  const scheduler = new PostgresScheduler({
    database,
    nextRun: (_cron, _tz, currentDate) => new Date(new Date(currentDate).getTime() + 60_000),
  });
  await scheduler.ensureSchema();

  const registered = await scheduler.register({
    id: "every-minute",
    name: "Every minute",
    organizationId: "system",
    kind: "system.tick",
    cron: "* * * * *",
    currentDate: new Date("2026-09-11T00:00:00.000Z"),
  });
  assert.equal(registered.misfire_policy, "coalesce");
  assert.equal(registered.next_run_at, "2026-09-11T00:01:00.000Z");

  const due = await scheduler.claimDue({
    workerId: "worker-1",
    now: new Date("2026-09-11T02:00:00.000Z"),
    limit: 10,
    staleAfterMs: 60_000,
  });
  assert.equal(due.length, 1);
  const claimCall = calls.find((call) => call.text.includes("WITH due AS"));
  assert.match(claimCall.text, /FOR UPDATE SKIP LOCKED/);
  assert.equal(claimCall.values[3], "worker-1");
  assert.equal(claimCall.values[1], "2026-09-11T01:59:00.000Z");
  assert.equal((await scheduler.health()).enabledSchedules, 1);
});

test("SchedulerRunner dispatches durable queue jobs with stable occurrence idempotency", async () => {
  const queued = [];
  const marked = [];
  const released = [];
  const scheduler = {
    async claimDue() {
      return [{
        id: "schedule-1",
        name: "Five minute reminders",
        organization_id: "org-1",
        kind: "work.reminders",
        cron_expression: "*/5 * * * *",
        timezone: "UTC",
        payload: { source: "scheduler" },
        next_run_at: "2026-09-11T01:00:00.000Z",
      }];
    },
    nextRun(_cron, _timezone, currentDate) {
      return new Date(new Date(currentDate).getTime() + 5 * 60_000);
    },
    async markDispatched(id, details) { marked.push({ id, details }); return { id }; },
    async releaseClaim(id, details) { released.push({ id, details }); return { id }; },
  };
  const queue = { async enqueue(job) { queued.push(job); return { queued: true }; } };
  const runner = new SchedulerRunner({
    scheduler,
    queue,
    workerId: "worker-test",
    pollIntervalMs: 5000,
    lockTimeoutMs: 60_000,
  });

  const outcome = await runner.runOnce(new Date("2026-09-11T02:00:00.000Z"));
  assert.deepEqual(outcome, { claimed: 1, dispatched: 1, failed: 0 });
  assert.equal(queued.length, 1);
  assert.equal(queued[0].kind, "work.reminders");
  assert.equal(queued[0].organizationId, "org-1");
  assert.equal(queued[0].idempotencyKey, "schedule:schedule-1:2026-09-11T01:00:00.000Z");
  assert.equal(queued[0].payload.scheduledFor, "2026-09-11T01:00:00.000Z");
  assert.equal(marked[0].details.nextRunAt.toISOString(), "2026-09-11T02:05:00.000Z");
  assert.equal(released.length, 0);
});

test("SchedulerRunner releases claims when enqueue fails", async () => {
  const released = [];
  const scheduler = {
    async claimDue() {
      return [{
        id: "schedule-2", name: "Broken", organization_id: "org-1", kind: "broken.job",
        cron_expression: "* * * * *", timezone: "UTC", payload: {},
        next_run_at: "2026-09-11T02:00:00.000Z",
      }];
    },
    nextRun() { return new Date("2026-09-11T02:01:00.000Z"); },
    async markDispatched() { throw new Error("should not mark"); },
    async releaseClaim(id, details) { released.push({ id, details }); return { id }; },
  };
  const queue = { async enqueue() { throw new Error("redis unavailable"); } };
  const runner = new SchedulerRunner({ scheduler, queue, workerId: "worker-test", logger: { error() {} } });
  const outcome = await runner.runOnce(new Date("2026-09-11T02:00:00.000Z"));
  assert.deepEqual(outcome, { claimed: 1, dispatched: 0, failed: 1 });
  assert.equal(released.length, 1);
  assert.match(released[0].details.error, /redis unavailable/);
});
