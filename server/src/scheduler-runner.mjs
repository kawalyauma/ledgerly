import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { createJobEnvelope } from "./contracts.mjs";

export class SchedulerRunner {
  #timer = null;
  #running = false;
  #stopped = true;

  constructor({
    scheduler,
    queue,
    pollIntervalMs = 5000,
    claimLimit = 20,
    lockTimeoutMs = 300000,
    workerId = `${hostname()}:${process.pid}:${randomUUID()}`,
    logger = console,
  }) {
    if (!scheduler || !queue) throw new TypeError("SchedulerRunner requires scheduler and queue services");
    if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 250) throw new TypeError("pollIntervalMs must be at least 250");
    if (!Number.isInteger(claimLimit) || claimLimit < 1) throw new TypeError("claimLimit must be positive");
    if (!Number.isInteger(lockTimeoutMs) || lockTimeoutMs < 1000) throw new TypeError("lockTimeoutMs must be at least 1000");
    this.scheduler = scheduler;
    this.queue = queue;
    this.pollIntervalMs = pollIntervalMs;
    this.claimLimit = claimLimit;
    this.lockTimeoutMs = lockTimeoutMs;
    this.workerId = workerId;
    this.logger = logger;
  }

  async runOnce(now = new Date()) {
    if (this.#running) return { skipped: true };
    this.#running = true;
    let claimed = [];
    let dispatched = 0;
    let failed = 0;
    try {
      claimed = await this.scheduler.claimDue({
        workerId: this.workerId,
        now,
        limit: this.claimLimit,
        staleAfterMs: this.lockTimeoutMs,
      });

      for (const schedule of claimed) {
        const scheduledFor = new Date(schedule.next_run_at);
        try {
          await this.queue.enqueue(createJobEnvelope({
            kind: schedule.kind,
            organizationId: schedule.organization_id,
            idempotencyKey: `schedule:${schedule.id}:${scheduledFor.toISOString()}`,
            payload: {
              ...(schedule.payload ?? {}),
              scheduleId: schedule.id,
              scheduleName: schedule.name,
              scheduledFor: scheduledFor.toISOString(),
            },
          }));

          // Coalesce missed occurrences after downtime: dispatch one due job, then advance from now.
          const base = new Date(Math.max(now.getTime(), scheduledFor.getTime()));
          const nextRunAt = this.scheduler.nextRun(schedule.cron_expression, schedule.timezone, base);
          const updated = await this.scheduler.markDispatched(schedule.id, {
            workerId: this.workerId,
            dispatchedAt: now,
            nextRunAt,
          });
          if (!updated) throw new Error(`Lost scheduler claim for ${schedule.id}`);
          dispatched += 1;
        } catch (error) {
          failed += 1;
          await this.scheduler.releaseClaim(schedule.id, {
            workerId: this.workerId,
            error: error instanceof Error ? error.message : String(error),
          }).catch(() => undefined);
          this.logger.error(JSON.stringify({
            level: "error",
            component: "scheduler",
            scheduleId: schedule.id,
            message: error instanceof Error ? error.message : String(error),
          }));
        }
      }
      return { claimed: claimed.length, dispatched, failed };
    } finally {
      this.#running = false;
    }
  }

  start() {
    if (!this.#stopped) return;
    this.#stopped = false;
    void this.runOnce().catch((error) => {
      this.logger.error(JSON.stringify({
        level: "error",
        component: "scheduler",
        message: error instanceof Error ? error.message : String(error),
      }));
    });
    this.#timer = setInterval(() => {
      void this.runOnce().catch((error) => {
        this.logger.error(JSON.stringify({
          level: "error",
          component: "scheduler",
          message: error instanceof Error ? error.message : String(error),
        }));
      });
    }, this.pollIntervalMs);
    this.#timer.unref?.();
  }

  async stop() {
    this.#stopped = true;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    while (this.#running) await new Promise((resolve) => setTimeout(resolve, 10));
  }

  status() {
    return {
      running: !this.#stopped,
      dispatchInProgress: this.#running,
      workerId: this.workerId,
      pollIntervalMs: this.pollIntervalMs,
      claimLimit: this.claimLimit,
      lockTimeoutMs: this.lockTimeoutMs,
    };
  }
}
