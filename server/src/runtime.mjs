import { assertServiceContracts, SERVICE_CONTRACT_VERSION } from "./contracts.mjs";
import { createPostgresDatabase } from "./adapters/postgres-database.mjs";
import { createPostgresAudit } from "./adapters/postgres-audit.mjs";
import { createPostgresScheduler } from "./adapters/postgres-scheduler.mjs";
import { RedisCache, createRedisClient } from "./adapters/redis-cache.mjs";
import { createRedisEventBus } from "./adapters/redis-events.mjs";
import { RedisQueue } from "./adapters/redis-queue.mjs";
import { createMinioStorage } from "./adapters/minio-storage.mjs";
import { createTenantStorageFactory } from "./adapters/tenant-storage.mjs";
import { createNotificationBridge } from "./adapters/notification-bridge.mjs";
import { KindRoutingQueue } from "./adapters/kind-routing-queue.mjs";
import { SchedulerRunner } from "./scheduler-runner.mjs";
import { DurableJobWorker } from "./jobs/durable-job-worker.mjs";
import { QueueRecoveryRunner } from "./jobs/queue-recovery-runner.mjs";
import { createJwtCodec } from "./auth/jwt.mjs";
import { AuthCompatibilityService } from "./auth/service.mjs";
import { intersectPermissions, resolveCurrentActorAccess } from "./auth/access-resolver.mjs";
import { createRuntimeExtensions, listRuntimeExtensionDescriptors } from "./extensions.mjs";

export async function createRuntime(config) {
  if (config.runtimeMode === "production") {
    throw new Error("Self-hosted production mode is intentionally blocked until migrated business routes/data and cutover validation are complete");
  }

  const database = await createPostgresDatabase(config.database);
  let redisClient;
  let events;
  let schedulerRunner;
  let queueRecoveryRunner;
  let runtimeExtensions;
  const managedQueues = new Set();
  const managedWorkers = new Set();

  try {
    redisClient = await createRedisClient(config.redis);
    const storage = await createMinioStorage(config.objectStorage);
    const tenantStorage = createTenantStorageFactory(storage);
    const scheduler = await createPostgresScheduler({ database });
    const audit = await createPostgresAudit({ database });
    events = await createRedisEventBus({ client: redisClient, namespace: config.redis.namespace });
    const notifications = createNotificationBridge(config.notifications);

    const createQueue = ({ name, maxAttempts = config.queue.maxAttempts, namespace = `${config.redis.namespace}:jobs`, visibilityTimeoutMs = config.queue.visibilityTimeoutMs }) => {
      if (typeof name !== "string" || name.trim() === "") throw new TypeError("Queue name is required");
      if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new TypeError("Queue maxAttempts must be positive");
      const queue = new RedisQueue({ client: redisClient, name: name.trim(), namespace, maxAttempts, visibilityTimeoutMs });
      managedQueues.add(queue);
      return queue;
    };

    const createWorker = ({ queue: workerQueue, handlers, ...options }) => {
      if (!workerQueue || !managedQueues.has(workerQueue)) throw new Error("Workers must use a queue created by this Ledgerly runtime");
      const worker = new DurableJobWorker({
        queue: workerQueue,
        handlers,
        pollIntervalMs: options.pollIntervalMs ?? config.queue.workerPollIntervalMs,
        concurrency: options.concurrency ?? config.queue.workerConcurrency,
        retryBaseMs: options.retryBaseMs ?? config.queue.retryBaseMs,
        retryMaxMs: options.retryMaxMs ?? config.queue.retryMaxMs,
        leaseRenewIntervalMs: options.leaseRenewIntervalMs,
        logger: options.logger ?? console,
        name: options.name ?? workerQueue.name,
      });
      managedWorkers.add(worker);
      return worker;
    };

    const queue = createQueue({ name: config.queue.name });
    const services = assertServiceContracts({
      database,
      cache: new RedisCache({ client: redisClient, namespace: `${config.redis.namespace}:cache` }),
      storage,
      queue,
      scheduler,
      events,
      notifications,
      audit,
    });

    const jwt = await createJwtCodec(config.auth);
    const auth = new AuthCompatibilityService({
      database,
      jwt,
      appSecret: config.auth.secret,
      environment: config.environment,
      accessTokenTtlSeconds: config.auth.accessTokenTtlSeconds,
      refreshTtlDays: config.auth.refreshTtlDays,
      audit,
    });

    const authorization = Object.freeze({
      resolveCurrentActorAccess: (input) => resolveCurrentActorAccess({ database, ...input }),
      intersectPermissions,
    });

    runtimeExtensions = await createRuntimeExtensions({ config, services, auth, authorization, tenantStorage, createQueue, createWorker });

    if (config.queue.recoveryEnabled) {
      queueRecoveryRunner = new QueueRecoveryRunner({
        queues: managedQueues,
        intervalMs: config.queue.recoveryIntervalMs,
        batchSize: config.queue.recoveryBatchSize,
      });
      queueRecoveryRunner.start();
    }

    if (config.scheduler.enabled) {
      const schedulerQueue = Object.keys(runtimeExtensions.schedulerQueues).length > 0
        ? new KindRoutingQueue({ defaultQueue: queue, routes: runtimeExtensions.schedulerQueues })
        : queue;
      schedulerRunner = new SchedulerRunner({
        scheduler,
        queue: schedulerQueue,
        pollIntervalMs: config.scheduler.pollIntervalMs,
        claimLimit: config.scheduler.claimLimit,
        lockTimeoutMs: config.scheduler.lockTimeoutMs,
        workerId: config.scheduler.workerId ?? undefined,
      });
      schedulerRunner.start();
    }

    async function managedQueueHealth() {
      const items = {};
      let ok = true;
      for (const item of managedQueues) {
        const health = await item.health();
        items[item.name] = health;
        if (health.ok !== true) ok = false;
      }
      return { ok, items };
    }

    async function readiness() {
      const [databaseHealth, cacheHealth, queueHealth, storageHealth, schedulerHealth, auditHealth, eventsHealth, notificationsHealth, extensionHealth, queueFleetHealth] = await Promise.all([
        services.database.health(), services.cache.health(), services.queue.health(), services.storage.health(), services.scheduler.health(), services.audit.health(), services.events.health(), services.notifications.health(), runtimeExtensions.readiness(), managedQueueHealth(),
      ]);
      const dependencies = { database: databaseHealth, cache: cacheHealth, queue: queueHealth, objectStorage: storageHealth, scheduler: schedulerHealth, audit: auditHealth, events: eventsHealth, notifications: notificationsHealth };
      const authMigration = await auth.health().catch((error) => ({ ok: false, provider: auth.provider, schemaReady: false, error: error instanceof Error ? error.message : String(error) }));
      const queueRecovery = queueRecoveryRunner?.status() ?? { running: false, disabled: true };
      const queueRecoveryHealthy = queueRecovery.disabled === true || queueRecovery.lastErrors?.length === 0;
      return {
        ok: Object.values(dependencies).every((item) => item.ok === true) && extensionHealth.ok && queueFleetHealth.ok && queueRecoveryHealthy,
        dependencies,
        extensions: extensionHealth.items,
        migration: { auth: authMigration },
        queues: queueFleetHealth.items,
        queueRecovery,
        workers: [...managedWorkers].map((worker) => worker.status()),
        schedulerRunner: schedulerRunner?.status() ?? { running: false, disabled: true },
      };
    }

    function describeContracts() {
      return {
        version: SERVICE_CONTRACT_VERSION,
        runtimeMode: config.runtimeMode,
        providers: Object.fromEntries(Object.entries(services).map(([name, service]) => [name, service.provider ?? "custom"])),
        durableCoreReady: true,
        durableJobRecoveryReady: true,
        durableSchedulerReady: true,
        durableAuditReady: true,
        distributedEventsReady: true,
        notificationBridgeReady: true,
        authCompatibilityReady: true,
        backgroundAuthorizationReady: true,
        tenantStorageReady: true,
        runtimeExtensionRegistryReady: true,
        runtimeExtensionDescriptors: listRuntimeExtensionDescriptors(),
        extensions: runtimeExtensions.describe(),
        auth: auth.describe(),
        queueRuntime: {
          managedQueues: [...managedQueues].map((item) => item.name),
          recovery: queueRecoveryRunner?.status() ?? { running: false, disabled: true },
          workers: [...managedWorkers].map((worker) => worker.status()),
        },
        schedulerRunner: schedulerRunner?.status() ?? { running: false, disabled: true },
        businessRoutesEnabled: false,
        authoritativeDataStore: "cloudflare-d1-until-migration",
        productionBlockers: ["auth-data-migration", "business-route-migration", "data-migration-validation"],
      };
    }

    async function close() {
      await schedulerRunner?.stop();
      await Promise.allSettled([...managedWorkers].map((worker) => worker.stop()));
      await queueRecoveryRunner?.stop();
      await runtimeExtensions?.close();
      await events?.close();
      await Promise.allSettled([database.close(), redisClient?.isOpen ? redisClient.quit() : undefined]);
    }

    return Object.freeze({
      services,
      auth,
      authorization,
      tenantStorage,
      jobs: Object.freeze({
        createQueue,
        createWorker,
        listQueues: () => [...managedQueues].map((item) => item.name),
        recoveryStatus: () => queueRecoveryRunner?.status() ?? { running: false, disabled: true },
      }),
      extensions: runtimeExtensions.values,
      readiness,
      describeContracts,
      close,
    });
  } catch (error) {
    await schedulerRunner?.stop().catch(() => undefined);
    await Promise.allSettled([...managedWorkers].map((worker) => worker.stop()));
    await queueRecoveryRunner?.stop().catch(() => undefined);
    await runtimeExtensions?.close().catch(() => undefined);
    await events?.close().catch(() => undefined);
    await Promise.allSettled([database.close(), redisClient?.isOpen ? redisClient.quit() : undefined]);
    throw error;
  }
}
