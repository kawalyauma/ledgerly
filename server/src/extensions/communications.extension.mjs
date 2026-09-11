import { PostgresCommunicationsRepository } from "../communications/repository.mjs";
import { CommunicationsService } from "../communications/service.mjs";
import { CommunicationsWorker } from "../communications/worker.mjs";

function asPositiveInt(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export default {
  name: "communications",
  required: false,
  configure(env) {
    return {
      enabled: String(env.SELFHOST_COMMUNICATIONS_ENABLED ?? "").toLowerCase() === "true",
      batchSize: asPositiveInt(env.SELFHOST_COMMUNICATIONS_BATCH_SIZE, 100, 500),
      pollIntervalMs: asPositiveInt(env.SELFHOST_COMMUNICATIONS_POLL_MS, 500, 60000),
      maxAttempts: asPositiveInt(env.SELFHOST_COMMUNICATIONS_MAX_ATTEMPTS, 5, 25),
      scheduleCron: String(env.SELFHOST_COMMUNICATIONS_SCHEDULE_CRON ?? "* * * * *").trim() || "* * * * *",
    };
  },
  enabled(extensionConfig) {
    return extensionConfig.enabled === true;
  },
  async create({ services, createQueue, extensionConfig }) {
    const repository = new PostgresCommunicationsRepository({ database: services.database });
    const queue = createQueue({ name: "communications", maxAttempts: extensionConfig.maxAttempts });
    const service = new CommunicationsService({ repository, queue, notifications: services.notifications, audit: services.audit, batchSize: extensionConfig.batchSize });
    const worker = new CommunicationsWorker({ queue, service });
    let stopped = false;
    let running = false;

    async function ensureOrganizationSchedule(organizationId) {
      if (typeof organizationId !== "string" || organizationId.trim() === "") throw new TypeError("organizationId is required");
      return services.scheduler.register({
        id: `communications-scan:${organizationId}`,
        name: "Communications scheduled campaign scan",
        organizationId,
        kind: "communications.dispatch-due",
        cron: extensionConfig.scheduleCron,
        timezone: "UTC",
        payload: {},
        enabled: true,
      });
    }

    const orgs = await services.database.query("SELECT id FROM organizations WHERE status='active' ORDER BY id");
    for (const row of orgs.rows) await ensureOrganizationSchedule(row.id);

    async function tick() {
      if (stopped || running) return;
      running = true;
      try {
        for (let i = 0; i < 25 && !stopped; i += 1) {
          const result = await worker.runOnce();
          if (!result?.processed && !result?.retried && !result?.deadLettered && !result?.unsupported) break;
        }
      } catch (error) {
        console.error(JSON.stringify({ level: "error", component: "communications-worker", message: error instanceof Error ? error.message : String(error) }));
      } finally {
        running = false;
      }
    }

    void tick();
    const timer = setInterval(() => void tick(), extensionConfig.pollIntervalMs);
    timer.unref?.();

    return {
      value: Object.freeze({ service, repository, queue, ensureOrganizationSchedule, runWorkerOnce: () => worker.runOnce() }),
      schedulerQueues: { "communications.dispatch-due": queue },
      async readiness() {
        const [queueHealth, schema] = await Promise.all([
          queue.health(),
          services.database.query(`SELECT to_regclass('public.communication_campaigns') IS NOT NULL AS campaigns, to_regclass('public.communication_deliveries') IS NOT NULL AS deliveries, to_regclass('public.communication_preferences') IS NOT NULL AS preferences`),
        ]);
        const row = schema.rows[0] ?? {};
        const schemaReady = row.campaigns === true && row.deliveries === true && row.preferences === true;
        return { ok: queueHealth.ok === true && schemaReady, provider: "postgresql-redis-notification-bridge", queue: queueHealth, schemaReady };
      },
      describe() {
        return { provider: "postgresql-redis-notification-bridge", durableQueue: true, persistentScheduler: true, batchSize: extensionConfig.batchSize, maxAttempts: extensionConfig.maxAttempts, cloudflareFallbackPreserved: true };
      },
      async close() {
        stopped = true;
        clearInterval(timer);
        while (running) await new Promise((resolve) => setTimeout(resolve, 10));
      },
    };
  },
};
