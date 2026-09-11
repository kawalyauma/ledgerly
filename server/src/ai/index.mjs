import { randomUUID } from "node:crypto";
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
import { createLedgerlyBusinessTools } from "./business-tools.mjs";
import { AiWorker } from "./worker.mjs";
import { createLocalPdfRenderer } from "./pdf-renderer.mjs";
import { DEFAULT_LIMITS } from "./constants.mjs";

function safeName(value) {
  const cleaned=String(value||"document").replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,120);
  return cleaned||"document";
}
function aiError(code,message,status=409){const error=new Error(message);error.code=code;error.status=status;return error;}

export async function createAiWorkforce({services,config={},businessTools={},authorization=null,tenantStorage=null,logger=console}){
  const providerRegistry=new AiProviderRegistry();
  providerRegistry.register("ollama",createOllamaProvider);
  for(const[id,factory]of Object.entries(config.providerFactories??{}))providerRegistry.register(id,factory);

  const providerConfig={provider:config.provider??"ollama",endpoint:config.endpoint??"http://127.0.0.1:11434",model:config.model??null,timeoutMs:Number(config.timeoutMs??60000),contextLimit:Number(config.contextLimit??8192),temperature:Number(config.temperature??0.2),toolSupport:config.toolSupport!==false};
  const embeddingDimensions=Number(config.embeddingDimensions??768),embeddingModel=config.embeddingModel??null;
  const embedder=embeddingModel?{async embed(text){const provider=providerRegistry.create(config.provider??"ollama",{...providerConfig,model:embeddingModel,toolSupport:false});return provider.embed(String(text??""));}}:null;
  const limits={...DEFAULT_LIMITS,...(config.limits??{})};

  const store=new AiWorkforceStore({database:services.database,embeddingDimensions,logger});
  const storeCapabilities=await store.ensureSchema();
  const approvals=new AiApprovalService({database:services.database,audit:services.audit});
  const tasks=new AiTaskService({database:services.database,queue:services.queue,audit:services.audit,limits});
  const renderer=tenantStorage?createLocalPdfRenderer({tenantStorage}):null;
  const documents=new AiDocumentEngine({database:services.database,audit:services.audit,renderer});
  const agents=new AiAgentService({database:services.database,audit:services.audit});
  const memory=new AiMemoryService({database:services.database,audit:services.audit});
  const knowledge=new AiKnowledgeService({database:services.database,audit:services.audit,embedder,embeddingDimensions,vectorEnabled:storeCapabilities.vectorSearch});
  const ingestion=new AiKnowledgeIngestionService({knowledge,storageForContext:(context)=>tenantStorage?.forOrganization(context.organizationId),audit:services.audit,maxBytes:Number(config.maxKnowledgeBytes??25*1024*1024),chunkChars:Number(config.chunkChars??3200),overlapChars:Number(config.chunkOverlapChars??400),maxChunks:Number(config.maxKnowledgeChunks??1000)});
  const schedules=new AiScheduleService({scheduler:services.scheduler,audit:services.audit});
  const academic=new AiAcademicService({database:services.database,tasks,documents,audit:services.audit});

  const internalTools={
    createLessonPlanDraft:async({input,context,agent,taskId})=>documents.createAiDraft({context,agent,taskId,type:"lesson_plan",title:input.title??"Lesson Plan Draft",content:input.content??input,reason:context.reason}),
    updateDocumentDraft:async({input,context,agent,taskId})=>documents.reviseAi({context,agent,taskId,documentId:input.documentId,content:input.content,reason:context.reason}),
    createTask:async({input,context,agent,taskId})=>{
      if(!taskId)throw aiError("AI_HANDOFF_PARENT_REQUIRED","AI-to-AI delegation requires a parent task",422);
      if(input.assignedAgent===agent.agentId)throw aiError("AI_HANDOFF_SELF_DENIED","An AI employee cannot delegate a task to itself",422);
      const parent=(await services.database.query(`SELECT * FROM ledgerly_ai.tasks WHERE task_id=$1 AND organization_id=$2`,[taskId,context.organizationId])).rows[0];
      if(!parent)throw aiError("AI_TASK_NOT_FOUND","Parent AI task was not found",404);
      const target=await agents.get({organizationId:context.organizationId},input.assignedAgent);
      if(!target)throw aiError("AI_AGENT_NOT_FOUND","Target AI employee was not found",404);
      if(target.status!=="active")throw aiError("AI_AGENT_NOT_ACTIVE",`Target AI employee is ${target.status}`);
      return tasks.handoff({context:{...context,userId:parent.requested_by||context.userId},task:parent,fromAgent:agent,toAgent:target.agentId,instruction:input.instruction});
    },
    recordAcademicReview:async({input,context,agent,taskId})=>academic.recordReview({context,agent,taskId,documentId:input.documentId,recommendation:input.recommendation,findings:input.findings??[],sourceReferences:input.sourceReferences??[]}),
    sendNotification:async({input,context,taskId})=>services.notifications.send({...input,organizationId:context.organizationId,deliveryId:input.deliveryId??`ai:${taskId??randomUUID()}`}),
  };
  const defaultBusinessTools=createLedgerlyBusinessTools({database:services.database,health:(ctx)=>health(ctx)});
  const gateway=registerCoreTools(new AiToolGateway({audit:services.audit,approvalService:approvals}),{...defaultBusinessTools,...internalTools,...businessTools});
  const worker=new AiWorker({database:services.database,queue:services.queue,agents,taskService:tasks,gateway,providerRegistry,providerConfig,knowledge,memory,audit:services.audit,authorization,limits,logger});
  if(config.workerEnabled!==false)worker.start(Number(config.pollIntervalMs??500));

  async function uploadKnowledge({context,name,bytes,contentType="application/octet-stream",sourceType="uploaded_document",metadata={}}){if(!tenantStorage?.forOrganization)throw new Error("Tenant storage is unavailable");const storage=tenantStorage.forOrganization(context.organizationId);const key=`ai/knowledge/${randomUUID()}-${safeName(name)}`;await storage.put(key,Buffer.from(bytes),{contentType,custom:{uploaded_by:String(context.userId),source_type:String(sourceType)}});return ingestion.ingestStored({context,name,sourceType,storageRef:key,contentType,metadata});}
  async function getRenderedDocumentUrl({context,documentId,expiresSeconds=900}){if(!tenantStorage?.forOrganization)throw new Error("Tenant storage is unavailable");const result=await services.database.query(`SELECT rendered_pdf_ref FROM ledgerly_ai.documents WHERE document_id=$1 AND organization_id=$2`,[documentId,context.organizationId]);const ref=result.rows[0]?.rendered_pdf_ref;if(!ref)throw new Error("Document has no rendered PDF");return {ref,url:await tenantStorage.forOrganization(context.organizationId).createDownloadUrl(ref,{expiresSeconds})};}

  async function health(context=null){
    const providerId=config.provider??"ollama";let runtime;
    try{runtime=await providerRegistry.create(providerId,providerConfig).health();}catch(error){runtime={ok:false,provider:providerId,state:"error",error:error instanceof Error?error.message:String(error),code:error?.code};}
    const org=context?.organizationId??null;
    const statsSql=`SELECT count(*) FILTER (WHERE status='failed')::int AS failed,count(*) FILTER (WHERE status='working')::int AS working,count(*) FILTER (WHERE status IN ('queued','working','waiting_for_approval'))::int AS pending,avg(EXTRACT(EPOCH FROM (completed_at-created_at))*1000) FILTER (WHERE completed_at IS NOT NULL) AS avg_ms,max(completed_at) AS last_success FROM ledgerly_ai.tasks${org?" WHERE organization_id=$1":""}`;
    const taskStats=await services.database.query(statsSql,org?[org]:[]).then((r)=>r.rows[0]??{}).catch(()=>({}));
    const workerStatus=worker.status();
    const tenantAverage=taskStats.avg_ms==null?null:Math.round(Number(taskStats.avg_ms));
    const tenantWorker={running:workerStatus.running,activeWorkers:Number(taskStats.working??0),maxConcurrentTasks:workerStatus.maxConcurrentTasks,averageExecutionDurationMs:tenantAverage,lastSuccessfulTask:taskStats.last_success??null};
    const visibleWorker=org?tenantWorker:workerStatus;
    const queueLength=org?Number(taskStats.pending??0):await services.queue.size().catch(()=>null);
    return {ok:runtime.ok===true,provider:providerId,runtime,queueLength,activeWorkers:visibleWorker.activeWorkers,failedTasks:Number(taskStats.failed??0),averageExecutionDurationMs:visibleWorker.averageExecutionDurationMs,lastSuccessfulTask:visibleWorker.lastSuccessfulTask,worker:visibleWorker,knowledge:{...storeCapabilities,embeddingModelConfigured:Boolean(embeddingModel),vectorActive:knowledge.vectorEnabled},limits};
  }

  async function close(){await worker.stop();}
  return Object.freeze({providerRegistry,store,storeCapabilities,agents,tasks,approvals,documents,academic,memory,knowledge,ingestion,schedules,gateway,worker,uploadKnowledge,getRenderedDocumentUrl,health,close,config:{providerConfig,embeddingModel,limits}});
}
