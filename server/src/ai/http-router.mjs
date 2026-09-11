import { createHash } from "node:crypto";

const MAX_BODY_BYTES=1_000_000;
const OFFICIAL_DOCUMENT_STATUSES=new Set(["approved","published"]);
const json=(status,body)=>({status,body});
const agentIdFor=(org,key)=>`ai_${createHash("sha256").update(`${org}:${key}`).digest("hex").slice(0,24)}`;

async function body(request){
 let size=0;const chunks=[];
 for await(const chunk of request){size+=chunk.length;if(size>MAX_BODY_BYTES){const e=new Error("Request body too large");e.status=413;throw e;}chunks.push(chunk);}
 if(!chunks.length)return{};
 try{return JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{const e=new Error("Invalid JSON body");e.status=400;throw e;}
}
const context=(principal)=>({organizationId:principal.organizationId,userId:principal.userId,userName:principal.userName??principal.userId,permissions:principal.scopes??[]});
const pathParts=(pathname)=>pathname.replace(/^\/selfhost\/ai\/?/,"").split("/").filter(Boolean).map(decodeURIComponent);

async function principalFor(runtime,request,scope){
 const authenticated=await runtime.auth.authenticateRequest({headers:request.headers});
 const live=await runtime.authorization.resolveCurrentActorAccess({organizationId:authenticated.organizationId,actorId:authenticated.userId});
 const principal={...authenticated,role:live.role,scopes:live.effectiveScopes};
 runtime.auth.requireScope(principal,scope);
 return principal;
}

async function ensureInitialAgents(runtime,organizationId){
 const count=await runtime.services.database.query(`SELECT count(*)::int AS count FROM ledgerly_ai.agents WHERE organization_id=$1`,[organizationId]);
 if(Number(count.rows[0]?.count??0)===0)await runtime.ai.store.seedTemplates(organizationId,(key)=>agentIdFor(organizationId,key));
}

async function delegatedApprovalContext(runtime,ctx,approval,agent){
 let requesterScopes=ctx.permissions;
 if(approval.task_id){
  const task=(await runtime.services.database.query(`SELECT requested_by FROM ledgerly_ai.tasks WHERE task_id=$1 AND organization_id=$2`,[approval.task_id,ctx.organizationId])).rows[0];
  if(!task?.requested_by){const error=new Error("approval task has no attributable requester");error.code="BACKGROUND_ACTOR_REVOKED";throw error;}
  const requester=await runtime.authorization.resolveCurrentActorAccess({organizationId:ctx.organizationId,actorId:task.requested_by});
  requesterScopes=requester.effectiveScopes;
 }
 return {...ctx,permissions:runtime.authorization.intersectPermissions(ctx.permissions,requesterScopes,agent.permissions??[])};
}

export async function handleAiRequest({request,url,runtime}){
 if(!runtime.ai)return json(503,{error:{code:"AI_WORKFORCE_DISABLED",message:"AI Workforce is disabled on this Ledgerly server."}});
 const parts=pathParts(url.pathname),method=request.method??"GET";
 if(method==="GET"&&parts[0]==="health"){
  const principal=await principalFor(runtime,request,"ai:read");
  return json(200,{organizationId:principal.organizationId,...await runtime.ai.health()});
 }
 const principal=await principalFor(runtime,request,method==="GET"?"ai:read":"ai:write"),ctx=context(principal),db=runtime.services.database;

 if(parts[0]==="employees"){
  await ensureInitialAgents(runtime,ctx.organizationId);
  if(method==="GET"&&parts.length===1)return json(200,{items:await runtime.ai.agents.list(ctx)});
  if(method==="GET"&&parts.length===2){const item=await runtime.ai.agents.get(ctx,parts[1]);return item?json(200,item):json(404,{error:{code:"AI_AGENT_NOT_FOUND",message:"AI employee not found"}});}
  if(method==="POST"&&parts.length===1)return json(201,await runtime.ai.agents.create(ctx,await body(request)));
  if((method==="PATCH"||method==="PUT")&&parts.length===2)return json(200,await runtime.ai.agents.update(ctx,parts[1],await body(request)));
  if(method==="POST"&&parts[2]==="disable")return json(200,await runtime.ai.agents.disable(ctx,parts[1],(await body(request)).reason??null));
 }

 if(parts[0]==="tasks"){
  if(method==="GET"&&parts.length===1){const status=url.searchParams.get("status"),values=[ctx.organizationId];let filter="organization_id=$1";if(status){values.push(status);filter+=` AND status=$${values.length}`;}const result=await db.query(`SELECT * FROM ledgerly_ai.tasks WHERE ${filter} ORDER BY priority DESC,created_at DESC LIMIT 200`,values);return json(200,{items:result.rows});}
  if(method==="GET"&&parts.length===2){const result=await db.query(`SELECT * FROM ledgerly_ai.tasks WHERE task_id=$1 AND organization_id=$2`,[parts[1],ctx.organizationId]);return result.rows[0]?json(200,result.rows[0]):json(404,{error:{code:"AI_TASK_NOT_FOUND",message:"AI task not found"}});}
  if(method==="POST"&&parts.length===1){const input=await body(request);return json(201,await runtime.ai.tasks.create({context:ctx,assignedAgent:input.assignedAgent,instruction:input.instruction,priority:input.priority,dueTime:input.dueTime,inputReferences:input.inputReferences,idempotencyKey:input.idempotencyKey}));}
  if(method==="POST"&&parts[2]==="handoff"){
   const task=(await db.query(`SELECT * FROM ledgerly_ai.tasks WHERE task_id=$1 AND organization_id=$2`,[parts[1],ctx.organizationId])).rows[0];if(!task)return json(404,{error:{code:"AI_TASK_NOT_FOUND",message:"AI task not found"}});
   const fromAgent=await runtime.ai.agents.get(ctx,task.assigned_agent);if(!fromAgent)return json(409,{error:{code:"AI_HANDOFF_SOURCE_MISSING",message:"Source AI employee no longer exists"}});
   const input=await body(request);return json(201,await runtime.ai.tasks.handoff({context:ctx,task,fromAgent,toAgent:input.toAgent,instruction:input.instruction}));
  }
  if(method==="POST"&&parts[2]==="cancel")return json(200,await runtime.ai.tasks.setStatus({organizationId:ctx.organizationId,taskId:parts[1],status:"cancelled"}));
 }

 if(parts[0]==="approvals"){
  if(method==="GET"&&parts.length===1){const result=await db.query(`SELECT * FROM ledgerly_ai.approvals WHERE organization_id=$1 ORDER BY requested_at DESC LIMIT 200`,[ctx.organizationId]);return json(200,{items:result.rows});}
  if(method==="POST"&&parts[2]==="decision"){
   runtime.auth.requireScope(principal,"ai:approve");const input=await body(request);
   return json(200,await runtime.ai.approvals.decide({context:ctx,approvalId:parts[1],approve:Boolean(input.approve),reason:input.reason??null}));
  }
  if(method==="POST"&&parts[2]==="execute"){
   runtime.auth.requireScope(principal,"ai:approve");
   const claimed=await runtime.ai.approvals.claimExecution({context:ctx,approvalId:parts[1]});
   try{
    const agent=await runtime.ai.agents.get(ctx,claimed.agent_id);if(!agent){const error=new Error("Approval agent no longer exists");error.status=409;error.code="AI_APPROVAL_AGENT_MISSING";throw error;}
    const executionContext=await delegatedApprovalContext(runtime,ctx,claimed,agent);
    const execution=await runtime.ai.gateway.executeApproved({approval:claimed,agent,context:executionContext});
    const saved=await runtime.ai.approvals.markExecuted({context:ctx,approvalId:parts[1],result:execution.output});
    if(claimed.task_id)await runtime.ai.tasks.setStatus({organizationId:ctx.organizationId,taskId:claimed.task_id,status:"completed",agent,outputReferences:[{type:"approved_action",approvalId:claimed.approval_id,result:execution.output}]});
    return json(200,{approval:saved,execution});
   }catch(error){
    await runtime.ai.approvals.markExecutionFailed({context:ctx,approvalId:parts[1],error}).catch(()=>undefined);
    throw error;
   }
  }
 }

 if(parts[0]==="documents"){
  if(method==="GET"&&parts.length===1){const result=await db.query(`SELECT * FROM ledgerly_ai.documents WHERE organization_id=$1 ORDER BY updated_at DESC LIMIT 200`,[ctx.organizationId]);return json(200,{items:result.rows});}
  if(method==="GET"&&parts.length===2){const result=await db.query(`SELECT * FROM ledgerly_ai.documents WHERE document_id=$1 AND organization_id=$2`,[parts[1],ctx.organizationId]);return result.rows[0]?json(200,result.rows[0]):json(404,{error:{code:"AI_DOCUMENT_NOT_FOUND",message:"Document not found"}});}
  if(method==="PATCH"&&parts.length===2){const input=await body(request);return json(200,await runtime.ai.documents.reviseHuman({context:ctx,documentId:parts[1],content:input.content,reason:input.reason??null}));}
  if(method==="POST"&&parts[2]==="status"){
   const input=await body(request),status=String(input.status??"");
   if(OFFICIAL_DOCUMENT_STATUSES.has(status))runtime.auth.requireScope(principal,"ai:approve");
   return json(200,await runtime.ai.documents.setStatus({context:ctx,documentId:parts[1],status,reason:input.reason??null,officialApproval:OFFICIAL_DOCUMENT_STATUSES.has(status)}));
  }
  if(method==="POST"&&parts[2]==="render")return json(200,await runtime.ai.documents.renderPdf({context:ctx,documentId:parts[1]}));
  if(method==="GET"&&parts[2]==="history"){const result=await db.query(`SELECT * FROM ledgerly_ai.document_versions WHERE document_id=$1 AND organization_id=$2 ORDER BY version DESC`,[parts[1],ctx.organizationId]);return json(200,{items:result.rows});}
 }

 if(parts[0]==="academics"){
  if(method==="POST"&&parts[1]==="lesson-plan-tasks"){const input=await body(request);return json(201,await runtime.ai.academic.createLessonPlanTask({context:ctx,agentId:input.agentId,instruction:input.instruction,academicContext:input.academicContext??{}}));}
  if(method==="POST"&&parts[1]==="review-tasks"){const input=await body(request);return json(201,await runtime.ai.academic.createReviewTask({context:ctx,reviewerAgentId:input.reviewerAgentId,documentId:input.documentId,instruction:input.instruction}));}
  if(method==="GET"&&parts[1]==="reviews"&&parts[2])return json(200,{items:await runtime.ai.academic.listReviews({context:ctx,documentId:parts[2]})});
 }

 if(parts[0]==="knowledge"){
  if(method==="GET"&&parts[1]==="sources"){const result=await db.query(`SELECT * FROM ledgerly_ai.knowledge_sources WHERE organization_id=$1 ORDER BY created_at DESC`,[ctx.organizationId]);return json(200,{items:result.rows,capabilities:runtime.ai.storeCapabilities});}
  if(method==="POST"&&parts[1]==="ingest"){const input=await body(request);return json(201,await runtime.ai.ingestion.ingestStored({context:ctx,name:input.name,sourceType:input.sourceType,storageRef:input.storageRef,contentType:input.contentType,metadata:input.metadata??{}}));}
  if(method==="POST"&&parts[1]==="sources"&&parts.length===2){const input=await body(request);return json(201,await runtime.ai.knowledge.createSource({context:ctx,name:input.name,sourceType:input.sourceType,storageRef:input.storageRef,metadata:input.metadata}));}
  if(method==="POST"&&parts[1]==="sources"&&parts[3]==="chunks"){const input=await body(request);return json(200,await runtime.ai.knowledge.indexChunks({context:ctx,sourceId:parts[2],chunks:input.chunks??[]}));}
  if(method==="POST"&&parts[1]==="retrieve"){const input=await body(request);return json(200,{items:await runtime.ai.knowledge.retrieve({context:ctx,query:input.query,sourceIds:input.sourceIds,limit:input.limit})});}
 }

 if(parts[0]==="memory"&&parts[1]){
  const agentId=parts[1];
  if(method==="GET")return json(200,{items:await runtime.ai.memory.list({context:ctx,agentId,type:url.searchParams.get("type"),includeDisabled:url.searchParams.get("includeDisabled")==="true"})});
  if(method==="POST"&&parts.length===2){const input=await body(request);return json(200,await runtime.ai.memory.put({context:ctx,agentId,type:input.type,key:input.key,value:input.value,expiresAt:input.expiresAt}));}
  if(method==="DELETE"&&parts.length===2){const input=await body(request);return json(200,await runtime.ai.memory.clear({context:ctx,agentId,type:input.type??null}));}
  if(method==="POST"&&parts[2]&&parts[3]==="disable"){const input=await body(request);return json(200,await runtime.ai.memory.disable({context:ctx,memoryId:parts[2],disabled:input.disabled!==false}));}
 }
 if(parts[0]==="schedules"){
  if(method==="GET"){const items=await runtime.services.scheduler.list({organizationId:ctx.organizationId,limit:200});return json(200,{items:items.filter((item)=>item.kind==="ai.task")});}
  if(method==="POST"&&parts.length===1){const input=await body(request);return json(201,await runtime.ai.schedules.register({context:ctx,name:input.name,agentId:input.agentId,instruction:input.instruction,cron:input.cron,timezone:input.timezone,priority:input.priority,enabled:input.enabled}));}
  if(method==="DELETE"&&parts.length===2)return json(200,await runtime.ai.schedules.cancel({context:ctx,scheduleId:parts[1]}));
 }
 if(parts[0]==="activity"&&method==="GET"){const result=await db.query(`SELECT * FROM ledgerly_ai.activity WHERE organization_id=$1 ORDER BY occurred_at DESC LIMIT 300`,[ctx.organizationId]);return json(200,{items:result.rows});}
 if(parts[0]==="audit"&&method==="GET"){const result=await db.query(`SELECT * FROM ledgerly_meta.audit_events WHERE organization_id=$1 AND (action LIKE 'ai.%' OR actor_type='ai_agent') ORDER BY occurred_at DESC LIMIT 300`,[ctx.organizationId]);return json(200,{items:result.rows});}
 if(parts[0]==="settings"&&method==="GET")return json(200,{provider:{provider:runtime.ai.config.provider,endpoint:runtime.ai.config.providerConfig?.endpoint,model:runtime.ai.config.providerConfig?.model},limits:runtime.ai.config.limits,knowledge:runtime.ai.storeCapabilities});
 return json(404,{error:{code:"AI_ROUTE_NOT_FOUND",message:"AI Workforce route not found"}});
}
