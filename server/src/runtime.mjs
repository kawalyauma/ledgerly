import { assertServiceContracts, SERVICE_CONTRACT_VERSION } from "./contracts.mjs";
import { LocalStorage } from "./adapters/local-storage.mjs";
import { MemoryCache } from "./adapters/memory-cache.mjs";
import { MemoryQueue } from "./adapters/memory-queue.mjs";
import { probeTcp } from "./adapters/tcp-health.mjs";
import {
  FoundationAudit,
  FoundationDatabase,
  FoundationEventBus,
  FoundationNotifications,
  FoundationScheduler,
} from "./adapters/foundation-services.mjs";

export function createRuntime(config) {
  if (config.runtimeMode === "production") {
    throw new Error(
      "Self-hosted production mode is intentionally blocked until durable PostgreSQL, Redis queue/cache, object-storage, scheduler, notification, and audit adapters are enabled",
    );
  }

  const services = assertServiceContracts({
    database: new FoundationDatabase({
      host: config.database.host,
      port: config.database.port,
      timeoutMs: config.dependencyTimeoutMs,
    }),
    cache: new MemoryCache({ namespace: "ledgerly-selfhost-foundation" }),
    storage: new LocalStorage({ root: config.storage.root }),
    queue: new MemoryQueue({ name: "ledgerly-selfhost-foundation" }),
    scheduler: new FoundationScheduler(),
    events: new FoundationEventBus(),
    notifications: new FoundationNotifications(),
    audit: new FoundationAudit(),
  });

  const dependencyProbe = (connection) =>
    probeTcp({
      ...connection,
      timeoutMs: config.dependencyTimeoutMs,
    });

  async function readiness() {
    const [database, redis, objectStorage, storage] = await Promise.all([
      services.database.health(),
      dependencyProbe(config.redis),
      dependencyProbe(config.objectStorage),
      services.storage.health().catch((error) => ({
        ok: false,
        provider: services.storage.provider,
        error: error instanceof Error ? error.message : String(error),
      })),
    ]);

    const dependencies = {
      database,
      redis: { provider: "redis-pending-adapter", ...redis },
      objectStorage: { provider: "minio-pending-adapter", ...objectStorage },
      storage,
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
      businessRoutesEnabled: false,
      authoritativeDataStore: "cloudflare-d1-until-migration",
    };
  }

  return Object.freeze({ services, readiness, describeContracts });
}
