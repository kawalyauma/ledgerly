import { createOllamaProvider } from "./providers/ollama.mjs";
import { AiProviderRegistry } from "./runtime-provider.mjs";
import { AiWorkforceStore } from "./store.mjs";
import { AiApprovalService, AiTaskService, AiDocumentService } from "./services.mjs";
import { AiAgentService } from "./agents.mjs";
import { AiMemoryService, AiKnowledgeService } from "./knowledge-memory.mjs";
import { AiScheduleService } from "./schedules.mjs";
import { AiToolGateway, registerCoreTools } from "./tool-gateway.mjs";
import { AiWorker } from "./worker.mjs";
import { DEFAULT_LIMITS } from "./constants.mjs";

export async function createAiWorkforce({ services, config = {}, businessTools = {}, embedder = null, logger = console }) {
  const providerRegistry = new AiProviderRegistry();
  providerRegistry.register("ollama", createOllamaProvider);
  for (const [id, factory] of Object.entries(config.providerFactories ?? {})) providerRegistry.register(id, factory);

  const store = new AiWorkforceStore({ database:services.database });
  await store.ensureSchema();

  const approvalService = new AiApprovalService({ database:services.database, audit:services.audit });
  const taskService = new AiTaskService({ database:services.database, queue:services.queue, audit:services.audit, limits:config.limits });
  const documents = new AiDocumentService({ database:services.database, audit:services.audit });
  const agents = new AiAgentService({ database:services.database, audit:services.audit });
  const memory = new AiMemoryService({ database:services.database, audit:services.audit });
  const knowledge = new AiKnowledgeService({ database:services.database, storage:services.storage, audit:services.audit, embedder, embeddingDimensions:config.embeddingDimensions??768 });
  const schedules = new AiScheduleService({ scheduler:services.scheduler, audit:services.audit });
  const gateway = registerCoreTools(new AiToolGateway({ audit:services.audit, approvalService }), businessTools);

  const providerConfig = {
    endpoint:config.endpoint??process.env.LEDGERLY_AI_ENDPOINT??"http://127.0.0.1:11434",
    model:config.model??process.env.LEDGERLY_AI_MODEL??null,
    timeoutMs:Number(config.timeoutMs??process.env.LEDGERLY_AI_TIMEOUT_MS??60000),
    contextLimit:Number(config.contextLimit??process.env.LEDGERLY_AI_CONTEXT_LIMIT??8192),
    temperature:Number(config.temperature??process.env.LEDGERLY_AI_TEMPERATURE??0.2),
    toolSupport:config.toolSupport??String(process.env.LEDGERLY_AI_TOOL_SUPPORT??"true")!=="false",
  };
  const limits={
    ...DEFAULT_LIMITS,
    ...(config.limits??{}),
    maxConcurrentTasks:Number(config.limits?.maxConcurrentTasks??process.env.LEDGERLY_AI_MAX_CONCURRENCY??DEFAULT_LIMITS.maxConcurrentTasks),
    maxRetries:Number(config.limits?.maxRetries??process.env.LEDGERLY_AI_MAX_RETRIES??DEFAULT_LIMITS.maxRetries),
  };

  const worker = new AiWorker({ database:services.database, queue:services.queue, agents, taskService, gateway, providerRegistry, providerConfig, knowledge, memory, audit:services.audit, limits, logger });
  if (config.workerEnabled !== false && String(process.env.LEDGERLY_AI_WORKER_ENABLED??"true")!=="false") worker.start(Number(config.pollIntervalMs??process.env.LEDGERLY_AI_POLL_INTERVAL_MS??500));

  async function health() {
    const providerId=config.provider??process.env.LEDGERLY_AI_PROVIDER??"ollama";
    let runtime;
    try { runtime=await providerRegistry.create(providerId,providerConfig).health(); }
    catch (error) { runtime={ok:false,provider:providerId,state:"error",error:error instanceof Error?error.message:String(error)}; }
    const [queueLength, failedTasks] = await Promise.all([
      services.queue.size().catch(()=>null),
      services.database.query(`SELECT count(*)::int AS count FROM ledgerly_ai.tasks WHERE status='failed'`).then((r)=>Number(r.rows[0]?.count??0)).catch(()=>null),
    ]);
    return {
      ok:runtime.ok===true,
      provider:providerId,
      runtime,
      queueLength,
      failedTasks,
      worker:worker.status(),
      limits,
    };
  }

  async function close() { await worker.stop(); }

  return Object.freeze({ providerRegistry, store, agents, tasks:taskService, approvals:approvalService, documents, memory, knowledge, schedules, gateway, worker, health, close, config:{providerConfig,limits} });
}
