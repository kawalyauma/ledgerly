import { assertServiceContracts, SERVICE_CONTRACT_VERSION } from "./contracts.mjs";
import { createPostgresDatabase } from "./adapters/postgres-database.mjs";
import { RedisCache, createRedisClient } from "./adapters/redis-cache.mjs";
import { RedisQueue } from "./adapters/redis-queue.mjs";
import { createMinioStorage } from "./adapters/minio-storage.mjs";
import {
  FoundationAudit,
  FoundationEventBus,
  FoundationNotifications,
  FoundationScheduler,
} from "./adapters/foundation-services.mjs";

export async function createRuntime(config) {
  if (config.runtimeMode === "production") {
    throw new Error(
      "Self-hosted production mode is intentionally blocked until durable scheduler, notification, audit, auth, and migrated business routes are enabled",
    );
  }

  const database = await createPostgresDatabase(config.database);
  let redisClient;
  try {
    redisClient = await createRedisClient(config.redis);
    const storage = await createMinioStorage(config.objectStorage);

    const services = assertServiceContracts({
      database,
      cache: new RedisCache({
        client: redisClient,
        namespace: `${config.redis.namespace}:cache`,
      }),
      storage,
      queue: new RedisQueue({
        client: redisClient,
        name: config.queue.name,
        namespace: `${config.redis.namespace}:jobs`,
        maxAttempts: config.queue.maxAttempts,
      }),
      scheduler: new FoundationScheduler(),
      events: new FoundationEventBus(),
      notifications: new FoundationNotifications(),
      audit: new FoundationAudit(),
    });

    async function readiness() {
      const [databaseHealth, cacheHealth, queueHealth, storageHealth] = await Promise.all([
        services.database.health(),
        services.cache.health(),
        services.queue.health(),
        services.storage.health(),
      ]);
      const dependencies = {
        database: databaseHealth,
        cache: cacheHealth,
        queue: queueHealth,
        objectStorage: storageHealth,
      };
      return {
        ok: Object.values(dependencies).every((item) => item.ok === true),
        dependencies,
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
        businessRoutesEnabled: false,
        authoritativeDataStore: "cloudflare-d1-until-migration",
        productionBlockers: ["scheduler", "notifications", "audit", "auth", "business-route-migration"],
      };
    }

    async function close() {
      await Promise.allSettled([
        database.close(),
        redisClient?.isOpen ? redisClient.quit() : undefined,
      ]);
    }

    return Object.freeze({ services, readiness, describeContracts, close });
  } catch (error) {
    await Promise.allSettled([
      database.close(),
      redisClient?.isOpen ? redisClient.quit() : undefined,
    ]);
    throw error;
  }
}
