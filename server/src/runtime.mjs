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
import { createJwtCodec } from "./auth/jwt.mjs";
import { AuthCompatibilityService } from "./auth/service.mjs";
import { createAiWorkforce } from "./ai/index.mjs";
import { JobQueueRouter } from "./ai/queue-router.mjs";

export async function createRuntime(config) {
  if (config.runtimeMode === "production") {
    throw new Error("Self-hosted production mode is intentionally blocked until migrated business routes/data and cutover validation are complete");
  }

  const database = await createPostgresDatabase(config.database);
  let redisClient;
  let events;
  let schedulerRunner;
  let ai;
  try {
    redisClient = await createRedisClient(config.redis);
    const storage = await createMinioStorage(config.objectStorage);
    const scheduler = await createPostgresScheduler({ database });
    const audit = await createPostgresAudit({ database });
    events = await createRedisEventBus({ client:redisClient, namespace:config.redis.namespace });
    const notifications = createNotificationBridge(config.notifications);
    const queue = new RedisQueue({ client:redisClient, name:config.queue.name, namespace:`${config.redis.namespace}:jobs`, maxAttempts:config.queue.maxAttempts });
    const aiQueue = new RedisQueue({ client:redisClient, name:config.ai.queueName, namespace:`${config.redis.namespace}:jobs`, maxAttempts:Math.max(1,config.ai.maxRetries+1) });

    const services = assertServiceContracts({
      database,
      cache:new RedisCache({ client:redisClient, namespace:`${config.redis.namespace}:cache` }),
      storage, queue, scheduler, events, notifications, audit,
    });

    const jwt = await createJwtCodec(config.auth);
    const auth = new AuthCompatibilityService({
      database, jwt, appSecret:config.auth.secret, environment:config.environment,
      accessTokenTtlSeconds:config.auth.accessTokenTtlSeconds, refreshTtlDays:config.auth.refreshTtlDays, audit,
    });

    if (config.ai.enabled) {
      ai = await createAiWorkforce({
        services:{...services,queue:aiQueue},
        config:{
          provider:config.ai.provider,endpoint:config.ai.endpoint,model:config.ai.model,timeoutMs:config.ai.timeoutMs,
          contextLimit:config.ai.contextLimit,temperature:config.ai.temperature,toolSupport:config.ai.toolSupport,
          workerEnabled:config.ai.workerEnabled,pollIntervalMs:config.ai.pollIntervalMs,embeddingDimensions:config.ai.embeddingDimensions,
          limits:{taskTimeoutMs:config.ai.taskTimeoutMs,maxRetries:config.ai.maxRetries,maxPromptChars:config.ai.maxPromptChars,maxOutputChars:config.ai.maxOutputChars,maxToolCalls:config.ai.maxToolCalls,maxHandoffs:config.ai.maxHandoffs,maxConcurrentTasks:config.ai.maxConcurrentTasks},
        },
      });
    }

    if (config.scheduler.enabled) {
      const schedulerQueue=config.ai.enabled ? new JobQueueRouter({defaultQueue:queue,routes:{"ai.task":aiQueue}}) : queue;
      schedulerRunner = new SchedulerRunner({
        scheduler, queue:schedulerQueue, pollIntervalMs:config.scheduler.pollIntervalMs, claimLimit:config.scheduler.claimLimit,
        lockTimeoutMs:config.scheduler.lockTimeoutMs, workerId:config.scheduler.workerId??undefined,
      });
      schedulerRunner.start();
    }

    async function readiness() {
      const [databaseHealth,cacheHealth,queueHealth,storageHealth,schedulerHealth,auditHealth,eventsHealth,notificationsHealth,aiQueueHealth] = await Promise.all([
        services.database.health(),services.cache.health(),services.queue.health(),services.storage.health(),services.scheduler.health(),services.audit.health(),services.events.health(),services.notifications.health(),
        config.ai.enabled ? aiQueue.health() : Promise.resolve({ok:true,disabled:true}),
      ]);
      const dependencies={database:databaseHealth,cache:cacheHealth,queue:queueHealth,objectStorage:storageHealth,scheduler:schedulerHealth,audit:auditHealth,events:eventsHealth,notifications:notificationsHealth};
      const authMigration=await auth.health().catch((error)=>({ok:false,provider:auth.provider,schemaReady:false,error:error instanceof Error?error.message:String(error)}));
      const aiHealth=config.ai.enabled ? await ai.health().catch((error)=>({ok:false,state:"error",error:error instanceof Error?error.message:String(error)})) : {ok:true,disabled:true};
      return {
        ok:Object.values(dependencies).every((item)=>item.ok===true),
        dependencies,
        migration:{auth:authMigration},
        ai:{required:false,queue:aiQueueHealth,...aiHealth},
        schedulerRunner:schedulerRunner?.status()??{running:false,disabled:true},
      };
    }

    function describeContracts() {
      return {
        version:SERVICE_CONTRACT_VERSION,runtimeMode:config.runtimeMode,
        providers:Object.fromEntries(Object.entries(services).map(([name,service])=>[name,service.provider??"custom"])),
        durableCoreReady:true,durableSchedulerReady:true,durableAuditReady:true,distributedEventsReady:true,notificationBridgeReady:true,authCompatibilityReady:true,
        aiWorkforceReady:Boolean(ai),aiProvider:config.ai.enabled?config.ai.provider:null,aiQueue:config.ai.enabled?config.ai.queueName:null,
        auth:auth.describe(),schedulerRunner:schedulerRunner?.status()??{running:false,disabled:true},
        businessRoutesEnabled:false,authoritativeDataStore:"cloudflare-d1-until-migration",
        productionBlockers:["auth-data-migration","business-route-migration","data-migration-validation"],
      };
    }

    async function close() {
      await ai?.close();
      await schedulerRunner?.stop();
      await events?.close();
      await Promise.allSettled([database.close(),redisClient?.isOpen?redisClient.quit():undefined]);
    }

    return Object.freeze({ services, auth, ai, aiQueue, readiness, describeContracts, close });
  } catch (error) {
    await ai?.close().catch(()=>undefined);
    await schedulerRunner?.stop().catch(()=>undefined);
    await events?.close().catch(()=>undefined);
    await Promise.allSettled([database.close(),redisClient?.isOpen?redisClient.quit():undefined]);
    throw error;
  }
}
