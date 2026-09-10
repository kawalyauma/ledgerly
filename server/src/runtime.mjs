import { assertServiceContracts, SERVICE_CONTRACT_VERSION } from "./contracts.mjs";
import { createPostgresDatabase } from "./adapters/postgres-database.mjs";
import { createPostgresAudit } from "./adapters/postgres-audit.mjs";
import { createPostgresScheduler } from "./adapters/postgres-scheduler.mjs";
import { RedisCache, createRedisClient } from "./adapters/redis-cache.mjs";
import { RedisQueue } from "./adapters/redis-queue.mjs";
import { createMinioStorage } from "./adapters/minio-storage.mjs";
import { FoundationEventBus, FoundationNotifications } from "./adapters/foundation-services.mjs";
import { SchedulerRunner } from "./scheduler-runner.mjs";

export async function createRuntime(config) {
  if (config.runtimeMode === "production") {
    throw new Error(
      "Self-hosted production mode is intentionally blocked until distributed events, notifications, auth, and migrated business routes are enabled",
    );
  }

  const database = await createPostgresDatabase(config.database);
  let redisClient;
  let schedulerRunner;
  try {
    redisClient = await createRedisClient(config.redis);
    const storage = await createMinioStorage(config.objectStorage);
    const scheduler = await createPostgresScheduler({ database });
    const audit = await createPostgresAudit({ database });
    const queue = new RedisQueue({
      client: redisClient,
      name: config.queue.name,
      namespace: `${config.redis.namespace}:jobs`,
      maxAttempts: config.queue.maxAttempts,
    });

    const services = assertServiceContracts({
      database,
      cache: new RedisCache({
        client: redisClient,
        namespace: `${config.redis.namespace}:cache`,
      }),
      storage,
      queue,
      scheduler,
      events: new FoundationEventBus(),
      notifications: new FoundationNotifications(),
      audit,
    });

    if (config.scheduler.enabled) {
      schedulerRunner = new SchedulerRunner({
        scheduler,
        queue,
        pollIntervalMs: config.scheduler.pollIntervalMs,
        claimLimit: config.scheduler.claimLimit,
        lockTimeoutMs: config.scheduler.lockTimeoutMs,
        workerId: config.scheduler.workerId ?? undefined,
      });
      schedulerRunner.start();
    }

    async function readiness() {
      const [databaseHealth, cacheHealth, queueHealth, storageHealth, schedulerHealth, auditHealth] = await Promise.all([
        services.database.health(),
        services.cache.health(),
        services.queue.health(),
        services.storage.health(),
        services.scheduler.health(),
        services.audit.health(),
      ]);
      const dependencies = {
        database: databaseHealth,
        cache: cacheHealth,
        queue: queueHealth,
        objectStorage: storageHealth,
        scheduler: schedulerHealth,
        audit: auditHealth,
      };
      return {
        ok: Object.values(dependencies).every((item) => item.ok === true),
        dependencies,
        schedulerRunner: schedulerRunner?.status() ?? { running: false, disabled: true },
      };
    }

    function describeContracts() {
      return {
        version: SERVICE_CONTRACT_VERSION,
        runtimeMode: config.runtimeMode,
        providers: Object.fromEntries(
          Object.entries(services).map(([name, service]) => [name, service.provider ?? "custom"]),
        ),
        durableCoreReady: true,
        durableSchedulerReady: true,
        durableAuditReady: true,
        schedulerRunner: schedulerRunner?.status() ?? { running: false, disabled: true },
        businessRoutesEnabled: false,
        authoritativeDataStore: "cloudflare-d1-until-migration",
        productionBlockers: ["distributed-events", "notifications", "auth", "business-route-migration"],
      };
    }

    async function close() {
      await schedulerRunner?.stop();
      await Promise.allSettled([
        database.close(),
        redisClient?.isOpen ? redisClient.quit() : undefined,
      ]);
    }

    return Object.freeze({ services, readiness, describeContracts, close });
  } catch (error) {
    await schedulerRunner?.stop().catch(() => undefined);
    await Promise.allSettled([
      database.close(),
      redisClient?.isOpen ? redisClient.quit() : undefined,
    ]);
    throw error;
  }
}
