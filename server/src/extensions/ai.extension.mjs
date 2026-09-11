import { createAiWorkforce } from "../ai/index.mjs";
import { createAiDocumentRenderer } from "../ai/document-renderer.mjs";

function bool(value, fallback=false) {
  if (value == null || value === "") return fallback;
  const normalized=String(value).trim().toLowerCase();
  if (["1","true","yes","on"].includes(normalized)) return true;
  if (["0","false","no","off"].includes(normalized)) return false;
  throw new Error(`Invalid AI boolean value: ${value}`);
}
function positiveInt(value,fallback,name){const parsed=Number.parseInt(value??String(fallback),10);if(!Number.isInteger(parsed)||parsed<1)throw new Error(`${name} must be a positive integer`);return parsed;}
function nonNegativeInt(value,fallback,name){const parsed=Number.parseInt(value??String(fallback),10);if(!Number.isInteger(parsed)||parsed<0)throw new Error(`${name} must be a non-negative integer`);return parsed;}
function number(value,fallback,name){const parsed=Number(value??fallback);if(!Number.isFinite(parsed))throw new Error(`${name} must be numeric`);return parsed;}

export default {
  name:"ai",
  required:false,
  configure(env){
    const maxRetries=nonNegativeInt(env.LEDGERLY_AI_MAX_RETRIES,2,"LEDGERLY_AI_MAX_RETRIES");
    return {
      enabled:bool(env.LEDGERLY_AI_ENABLED,false),
      provider:env.LEDGERLY_AI_PROVIDER??"ollama",
      endpoint:env.LEDGERLY_AI_ENDPOINT??"http://127.0.0.1:11434",
      model:env.LEDGERLY_AI_MODEL||null,
      timeoutMs:positiveInt(env.LEDGERLY_AI_TIMEOUT_MS,60000,"LEDGERLY_AI_TIMEOUT_MS"),
      contextLimit:positiveInt(env.LEDGERLY_AI_CONTEXT_LIMIT,8192,"LEDGERLY_AI_CONTEXT_LIMIT"),
      temperature:number(env.LEDGERLY_AI_TEMPERATURE,0.2,"LEDGERLY_AI_TEMPERATURE"),
      toolSupport:bool(env.LEDGERLY_AI_TOOL_SUPPORT,true),
      workerEnabled:bool(env.LEDGERLY_AI_WORKER_ENABLED,true),
      queueName:env.LEDGERLY_AI_QUEUE_NAME??"ai-workforce",
      pollIntervalMs:positiveInt(env.LEDGERLY_AI_POLL_INTERVAL_MS,500,"LEDGERLY_AI_POLL_INTERVAL_MS"),
      embeddingDimensions:positiveInt(env.LEDGERLY_AI_EMBEDDING_DIMENSIONS,768,"LEDGERLY_AI_EMBEDDING_DIMENSIONS"),
      maxKnowledgeBytes:positiveInt(env.LEDGERLY_AI_MAX_KNOWLEDGE_BYTES,25*1024*1024,"LEDGERLY_AI_MAX_KNOWLEDGE_BYTES"),
      chunkChars:positiveInt(env.LEDGERLY_AI_CHUNK_CHARS,3200,"LEDGERLY_AI_CHUNK_CHARS"),
      chunkOverlapChars:nonNegativeInt(env.LEDGERLY_AI_CHUNK_OVERLAP_CHARS,400,"LEDGERLY_AI_CHUNK_OVERLAP_CHARS"),
      limits:{
        maxConcurrentTasks:positiveInt(env.LEDGERLY_AI_MAX_CONCURRENCY,2,"LEDGERLY_AI_MAX_CONCURRENCY"),
        maxRetries,
        taskTimeoutMs:positiveInt(env.LEDGERLY_AI_TASK_TIMEOUT_MS,120000,"LEDGERLY_AI_TASK_TIMEOUT_MS"),
        maxPromptChars:positiveInt(env.LEDGERLY_AI_MAX_PROMPT_CHARS,48000,"LEDGERLY_AI_MAX_PROMPT_CHARS"),
        maxOutputChars:positiveInt(env.LEDGERLY_AI_MAX_OUTPUT_CHARS,32000,"LEDGERLY_AI_MAX_OUTPUT_CHARS"),
        maxToolCalls:positiveInt(env.LEDGERLY_AI_MAX_TOOL_CALLS,12,"LEDGERLY_AI_MAX_TOOL_CALLS"),
        maxHandoffs:positiveInt(env.LEDGERLY_AI_MAX_HANDOFFS,3,"LEDGERLY_AI_MAX_HANDOFFS"),
      },
    };
  },
  enabled(config){return config.enabled===true;},
  async create({services,auth,authorization,tenantStorage,createQueue,extensionConfig}){
    const authHealth=await auth.health();
    if(!authHealth.ok){
      const missing=(authHealth.missingTables??[]).join(", ");
      throw new Error(`AI Workforce requires completed auth-core migration${missing?`: missing ${missing}`:""}`);
    }
    const aiQueue=createQueue({name:extensionConfig.queueName,maxAttempts:Math.max(1,extensionConfig.limits.maxRetries+1)});
    const documentRenderer=createAiDocumentRenderer({database:services.database,tenantStorage});
    const ai=await createAiWorkforce({
      services:{...services,queue:aiQueue},
      config:extensionConfig,
      authorization,
      tenantStorage,
      documentRenderer,
    });
    return {
      value:ai,
      schedulerQueues:{"ai.task":aiQueue},
      readiness:()=>ai.health(),
      describe:()=>({
        enabled:true,
        provider:extensionConfig.provider,
        model:extensionConfig.model,
        queue:extensionConfig.queueName,
        workerEnabled:extensionConfig.workerEnabled,
        localFirst:true,
        rawDatabaseCredentialsExposed:false,
        tenantScopedStorage:true,
        liveRequesterAuthorization:true,
        structuredPdfRendering:true,
        authCoreRequired:true,
      }),
      close:()=>ai.close(),
    };
  },
};
