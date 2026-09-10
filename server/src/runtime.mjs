import { assertServiceContracts, SERVICE_CONTRACT_VERSION } from "./contracts.mjs";
import { createPostgresDatabase } from "./adapters/postgres-database.mjs";
import { createPostgresAudit } from "./adapters/postgres-audit.mjs";
import { createPostgresScheduler } from "./adapters/postgres-scheduler.mjs";
import { RedisCache, createRedisClient } from "./adapters/redis-cache.mjs";
import { createRedisEventBus } from "./adapters/redis-events.mjs";
import { RedisQueue } from "./adapters/redis-queue.mjs";
import { createMinioStorage } from "./adapters/minio-storage.mjs";
import { createNotificationBridge } from "./adapters/notification-bridge.mjs";
import { SchedulerRunner } from "./scheduler-runner.mjs";

export async function createRuntime(config) {
  if (config.runtimeMode === "production") {
    throw new Error(
      "Self-hosted production mode is intentionally blocked until auth compatibility and migrated business routes/data are verified",
    );
  }

  const database = await createPostgresDatabase(config.database);
  let redisClient;
  let events;
  let schedulerRunner;
  try {
    redisClient = await createRedisClient(config.redis);
    const storage = await createMinioStorage(config.objectStorage);
    const scheduler = await createPostgresScheduler({ database });
    const audit = await createPostgresAudit({ database });
    events = await createRedisEventBus({
      client: redisClient,
      namespace: config.redis.namespace,
    });
    const notifications = createNotificationBridge(config.notifications);
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
      events,
      notifications,
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
      const [databaseHealth, cacheHealth, queueHealth, storageHealth, schedulerHealth, auditHealth, eventsHealth, notificationsHealth] = await Promise.all([
        services.database.health(),
        services.cache.health(),
        services.queue.health(),
        services.storage.health(),
        services.scheduler.health(),
        services.audit.health(),
        services.events.health(),
        services.notifications.health(),
      ]);
      const dependencies = {
        database: databaseHealth,
        cache: cacheHealth,
        queue: queueHealth,
        objectStorage: storageHealth,
        scheduler: schedulerHealth,
        audit: auditHealth,
        events: eventsHealth,
        notifications: notificationsHealth,
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
        distributedEventsReady: true,
        notificationBridgeReady: true,
        schedulerRunner: schedulerRunner?.status() ?? { running: false, disabled: true },
        businessRoutesEnabled: false,
        authoritativeDataStore: "cloudflare-d1-until-migration",
        productionBlockers: ["auth", "business-route-migration", "data-migration-validation"],
      };
    }

    async function close() {
      await schedulerRunner?.stop();
      await events?.close();
      await Promise.allSettled([
        database.close(),
        redisClient?.isOpen ? redisClient.quit() : undefined,
      ]);
    }

    return Object.freeze({ services, readiness, describeContracts, close });
  } catch (error) {
    await schedulerRunner?.stop().catch(() => undefined);
    await events?.close().catch(() => undefined);
    await Promise.allSettled([
      database.close(),
      redisClient?.isOpen ? redisClient.quit() : undefined,
    ]);
    throw error;
  }
}
