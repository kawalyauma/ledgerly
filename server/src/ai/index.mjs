import { createOllamaProvider } from "./providers/ollama.mjs";
import { AiProviderRegistry } from "./runtime-provider.mjs";
import { AiWorkforceStore } from "./store.mjs";
import { AiApprovalService, AiTaskService } from "./services.mjs";
import { AiDocumentEngine } from "./document-engine.mjs";
import { AiAcademicService } from "./academic-service.mjs";
import { AiAgentService } from "./agents.mjs";
import { AiMemoryService, AiKnowledgeService } from "./knowledge-memory.mjs";
import { AiKnowledgeIngestionService } from "./knowledge-ingestion.mjs";
import { AiScheduleService } from "./schedules.mjs";
import { AiToolGateway, registerCoreTools } from "./tool-gateway.mjs";
import { AiWorker } from "./worker.mjs";
import { DEFAULT_LIMITS } from "./constants.mjs";

export async function createAiWorkforce({services,config={},authorization,tenantStorage,businessTools={},embedder=null,documentRenderer=null,logger=console}){
 if(!authorization?.resolveCurrentActorAccess||!authorization?.intersectPermissions)throw new TypeError("AI Workforce requires live authorization services");
 if(!tenantStorage?.forOrganization)throw new TypeError("AI Workforce requires tenant-scoped storage");
 const providerRegistry=new AiProviderRegistry();providerRegistry.register("ollama",createOllamaProvider);for(const[id,factory]of Object.entries(config.providerFactories??{}))providerRegistry.register(id,factory);
 const embeddingDimensions=Number(config.embeddingDimensions??768);
 const store=new AiWorkforceStore({database:services.database,embeddingDimensions,logger}),storeCapabilities=await store.ensureSchema();
 const approvals=new AiApprovalService({database:services.database,audit:services.audit});
 const tasks=new AiTaskService({database:services.database,queue:services.queue,audit:services.audit,limits:config.limits});
 const documents=new AiDocumentEngine({database:services.database,audit:services.audit,renderer:documentRenderer});
 const agents=new AiAgentService({database:services.database,audit:services.audit});
 const memory=new AiMemoryService({database:services.database,audit:services.audit});
 const knowledge=new AiKnowledgeService({database:services.database,audit:services.audit,embedder,embeddingDimensions,vectorEnabled:storeCapabilities.vectorSearch});
 const ingestion=new AiKnowledgeIngestionService({knowledge,storageForOrganization:(organizationId)=>tenantStorage.forOrganization(organizationId),audit:services.audit,maxBytes:Number(config.maxKnowledgeBytes??25*1024*1024),chunkChars:Number(config.chunkChars??3200),overlapChars:Number(config.chunkOverlapChars??400)});
 const schedules=new AiScheduleService({scheduler:services.scheduler,audit:services.audit,agents});
 const academic=new AiAcademicService({database:services.database,tasks,documents,audit:services.audit});
 const internalTools={
   createLessonPlanDraft:async({input,context,agent,taskId})=>documents.createAiDraft({context,agent,taskId,type:"lesson_plan",title:input.title??"Lesson Plan Draft",content:input.content??input,reason:context.reason}),
   updateDocumentDraft:async({input,context,agent,taskId})=>documents.reviseAi({context,agent,taskId,documentId:input.documentId,content:input.content,reason:context.reason}),
   createTask:async({input,context})=>tasks.create({context,assignedAgent:input.assignedAgent,instruction:input.instruction,priority:input.priority,inputReferences:input.inputReferences,idempotencyKey:input.idempotencyKey}),
   requestApproval:async({input,context,agent,taskId})=>approvals.request({organizationId:context.organizationId,agent,taskId,action:input.action??"document_approval",reason:input.reason??context.reason,payload:input.payload??{},riskLevel:input.riskLevel??"medium",requestedApprover:input.requestedApprover??null}),
   recordAcademicReview:async({input,context,agent,taskId})=>academic.recordReview({context,agent,taskId,documentId:input.documentId,recommendation:input.recommendation,findings:input.findings??[],sourceReferences:input.sourceReferences??[]}),
 };
 const gateway=registerCoreTools(new AiToolGateway({audit:services.audit,approvalService:approvals}),{...internalTools,...businessTools});
 const providerConfig={endpoint:config.endpoint??"http://127.0.0.1:11434",model:config.model??null,timeoutMs:Number(config.timeoutMs??60000),contextLimit:Number(config.contextLimit??8192),temperature:Number(config.temperature??0.2),toolSupport:config.toolSupport!==false};
 const limits={...DEFAULT_LIMITS,...(config.limits??{}),maxConcurrentTasks:Number(config.limits?.maxConcurrentTasks??DEFAULT_LIMITS.maxConcurrentTasks),maxRetries:Number(config.limits?.maxRetries??DEFAULT_LIMITS.maxRetries)};
 const worker=new AiWorker({database:services.database,queue:services.queue,agents,taskService:tasks,gateway,providerRegistry,providerConfig,knowledge,memory,audit:services.audit,authorization,limits,logger});
 if(config.workerEnabled!==false)worker.start(Number(config.pollIntervalMs??500));
 async function health(){const providerId=config.provider??"ollama";let runtime;try{runtime=await providerRegistry.create(providerId,providerConfig).health();}catch(error){runtime={ok:false,provider:providerId,state:"error",error:error instanceof Error?error.message:String(error)};}const[queueLength,failedTasks]=await Promise.all([services.queue.size().catch(()=>null),services.database.query(`SELECT count(*)::int AS count FROM ledgerly_ai.tasks WHERE status='failed'`).then((r)=>Number(r.rows[0]?.count??0)).catch(()=>null)]);return{ok:runtime.ok===true,provider:providerId,runtime,queueLength,failedTasks,worker:worker.status(),knowledge:storeCapabilities,limits};}
 async function close(){await worker.stop();}
 return Object.freeze({providerRegistry,store,storeCapabilities,agents,tasks,approvals,documents,academic,memory,knowledge,ingestion,schedules,gateway,worker,health,close,config:{providerConfig,limits}});
}
