import { createAiWorkforce } from "../ai/index.mjs";

function bool(value, fallback) {
  if (value == null || value === "") return fallback;
  return !["0", "false", "no", "off"].includes(String(value).toLowerCase());
}
function number(value, fallback) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export default {
  name: "ai-workforce",
  required: false,
  configure(env) {
    return {
      enabled: bool(env.LEDGERLY_AI_ENABLED, true),
      provider: env.LEDGERLY_AI_PROVIDER || "ollama",
      endpoint: env.LEDGERLY_AI_ENDPOINT || "http://127.0.0.1:11434",
      model: env.LEDGERLY_AI_MODEL || null,
      embeddingModel: env.LEDGERLY_AI_EMBEDDING_MODEL || null,
      embeddingDimensions: number(env.LEDGERLY_AI_EMBEDDING_DIMENSIONS, 768),
      timeoutMs: number(env.LEDGERLY_AI_TIMEOUT_MS, 60000),
      contextLimit: number(env.LEDGERLY_AI_CONTEXT_LIMIT, 8192),
      temperature: Number.isFinite(Number(env.LEDGERLY_AI_TEMPERATURE)) ? Number(env.LEDGERLY_AI_TEMPERATURE) : 0.2,
      toolSupport: bool(env.LEDGERLY_AI_TOOL_SUPPORT, true),
      workerEnabled: bool(env.LEDGERLY_AI_WORKER_ENABLED, true),
      pollIntervalMs: number(env.LEDGERLY_AI_POLL_INTERVAL_MS, 500),
      queueName: env.LEDGERLY_AI_QUEUE_NAME || "ai-workforce",
      limits: {
        maxConcurrentTasks: number(env.LEDGERLY_AI_MAX_CONCURRENCY, 2),
        maxRetries: number(env.LEDGERLY_AI_MAX_RETRIES, 2),
        taskTimeoutMs: number(env.LEDGERLY_AI_TASK_TIMEOUT_MS, 120000),
        maxPromptChars: number(env.LEDGERLY_AI_MAX_PROMPT_CHARS, 48000),
        maxOutputChars: number(env.LEDGERLY_AI_MAX_OUTPUT_CHARS, 32000),
        maxToolCalls: number(env.LEDGERLY_AI_MAX_TOOL_CALLS, 12),
        maxHandoffs: number(env.LEDGERLY_AI_MAX_HANDOFFS, 3),
      },
    };
  },
  enabled(extensionConfig) {
    return extensionConfig.enabled !== false;
  },
  async create({ services, authorization, tenantStorage, createQueue, extensionConfig }) {
    const queue = createQueue({
      name: extensionConfig.queueName || "ai-workforce",
      maxAttempts: Math.max(1, Number(extensionConfig.limits?.maxRetries ?? 2) + 1),
    });
    const ai = await createAiWorkforce({
      services: { ...services, queue },
      authorization,
      tenantStorage,
      config: extensionConfig,
    });
    return {
      value: ai,
      schedulerQueues: { "ai.task": queue },
      async readiness() {
        const health = await ai.health();
        return {
          ok: true,
          available: health.ok === true,
          degraded: health.ok !== true,
          provider: health.provider,
          runtime: health.runtime,
          queueLength: health.queueLength,
          activeWorkers: health.worker?.activeWorkers ?? 0,
        };
      },
      describe() {
        return {
          provider: extensionConfig.provider,
          localFirst: true,
          queue: extensionConfig.queueName,
          workerEnabled: extensionConfig.workerEnabled !== false,
          modelConfigured: Boolean(extensionConfig.model),
          embeddingModelConfigured: Boolean(extensionConfig.embeddingModel),
        };
      },
      async close() {
        await ai.close();
      },
    };
  },
};
