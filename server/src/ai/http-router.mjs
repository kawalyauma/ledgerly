import { createHash } from "node:crypto";

const MAX_JSON_BYTES=1_000_000;
const MAX_UPLOAD_BYTES=25*1024*1024;

function json(status,body){return {status,body};}
function fail(status,code,message){const error=new Error(message);error.status=status;error.code=code;throw error;}
function agentIdFor(org,key){return `ai_${createHash("sha256").update(`${org}:${key}`).digest("hex").slice(0,24)}`;}
async function readRaw(request,maxBytes){let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>maxBytes){const e=new Error("Request body too large");e.status=413;throw e;}chunks.push(Buffer.from(chunk));}return Buffer.concat(chunks);}
async function body(request){const raw=await readRaw(request,MAX_JSON_BYTES);if(!raw.length)return {};try{return JSON.parse(raw.toString("utf8"));}catch{const e=new Error("Invalid JSON body");e.status=400;throw e;}}
function context(principal){return {organizationId:principal.organizationId,userId:principal.userId,userName:principal.userName??principal.userId,permissions:principal.effectiveScopes??principal.scopes??[]};}
function pathParts(pathname){return pathname.replace(/^\/selfhost\/ai\/?/,"").split("/").filter(Boolean).map(decodeURIComponent);}
function cleanFilename(value){const name=String(value||"document").split(/[\\/]/).pop()||"document";return name.replace(/[^a-zA-Z0-9._ -]+/g,"-").slice(0,180);}
function header(request,name){const headers=request.headers;if(headers?.get)return headers.get(name);return headers?.[String(name).toLowerCase()]??headers?.[name]??null;}
function idempotencyKey(request,input){const value=String(input?.idempotencyKey??header(request,"idempotency-key")??"").trim();if(!value)return null;if(value.length>200)fail(422,"AI_IDEMPOTENCY_KEY_INVALID","Idempotency key is too long");return value;}

async function principalFor(runtime,request,scope){const principal=await runtime.auth.authenticateRequest({headers:request.headers});runtime.auth.requireScope(principal,scope);return principal;}
async function ensureInitialAgents(runtime,organizationId){const count=await runtime.services.database.query(`SELECT count(*)::int AS count FROM ledgerly_ai.agents WHERE organization_id=$1`,[organizationId]);if(Number(count.rows[0]?.count??0)===0)await runtime.ai.store.seedTemplates(organizationId,(key)=>agentIdFor(organizationId,key));}
async function getAgent(runtime,ctx,agentId){if(!agentId)fail(422,"AI_AGENT_REQUIRED","AI employee is required");const agent=await runtime.ai.agents.get(ctx,agentId);if(!agent)fail(404,"AI_AGENT_NOT_FOUND","AI employee not found");return agent;}
async function requireActiveAgent(runtime,ctx,agentId){const agent=await getAgent(runtime,ctx,agentId);if(agent.status!=="active")fail(409,"AI_AGENT_NOT_ACTIVE",`AI employee is ${agent.status}`);return agent;}
function validateAllowedTools(runtime,input){if(!Object.prototype.hasOwnProperty.call(input??{},"allowedTools"))return;const known=new Set(runtime.ai.gateway.describeAll().map((tool)=>tool.name));const unknown=(Array.isArray(input.allowedTools)?input.allowedTools:[]).filter((name)=>!known.has(name));if(unknown.length)fail(422,"AI_TOOL_UNKNOWN",`Unknown AI tool(s): ${unknown.join(", ")}`);}
async function approvalExecutionContext(runtime,principal,approval,agent){let actorScopes=principal.effectiveScopes??principal.scopes??[];if(approval.task_id){const task=(await runtime.services.database.query(`SELECT requested_by FROM ledgerly_ai.tasks WHERE task_id=$1 AND organization_id=$2`,[approval.task_id,principal.organizationId])).rows[0];if(task?.requested_by){const access=await runtime.authorization.resolveCurrentActorAccess({organizationId:principal.organizationId,actorId:task.requested_by});actorScopes=access.effectiveScopes??access.scopes??[];}}const permissions=runtime.authorization?.intersectPermissions?runtime.authorization.intersectPermissions(actorScopes,agent.permissions??[]):agent.permissions??[];return {...context(principal),permissions};}

export async function handleAiRequest({request,url,runtime}){
  if(!runtime.ai)return json(503,{error:{code:"AI_WORKFORCE_DISABLED",message:"AI Workforce is disabled on this Ledgerly server."}});
  const parts=pathParts(url.pathname),method=request.method??"GET";
  if(method==="GET"&&parts[0]==="health"){const principal=await principalFor(runtime,request,"ai:read");const ctx=context(principal);return json(200,{organizationId:principal.organizationId,...await runtime.ai.health(ctx)});}

  const principal=await principalFor(runtime,request,method==="GET"?"ai:read":"ai:write"),ctx=context(principal),db=runtime.services.database;

  if(parts[0]==="employees"){
    await ensureInitialAgents(runtime,ctx.organizationId);
    if(method==="GET"&&parts.length===1)return json(200,{items:await runtime.ai.agents.list(ctx)});
    if(method==="GET"&&parts.length===2){const item=await runtime.ai.agents.get(ctx,parts[1]);return item?json(200,item):json(404,{error:{code:"AI_AGENT_NOT_FOUND",message:"AI employee not found"}});}
    if(method==="POST"&&parts.length===1){const input=await body(request);validateAllowedTools(runtime,input);return json(201,await runtime.ai.agents.create(ctx,input));}
    if((method==="PATCH"||method==="PUT")&&parts.length===2){const input=await body(request);validateAllowedTools(runtime,input);return json(200,await runtime.ai.agents.update(ctx,parts[1],input));}
    if(method==="POST"&&parts[2]==="disable")return json(200,await runtime.ai.agents.disable(ctx,parts[1],(await body(request)).reason??null));
  }

  if(parts[0]==="tools"&&method==="GET")return json(200,{items:runtime.ai.gateway.describeAll()});

  if(parts[0]==="tasks"){
    if(method==="GET"&&parts.length===1){const status=url.searchParams.get("status"),values=[ctx.organizationId];let filter="organization_id=$1";if(status){values.push(status);filter+=` AND status=$${values.length}`;}const result=await db.query(`SELECT * FROM ledgerly_ai.tasks WHERE ${filter} ORDER BY priority DESC,created_at DESC LIMIT 200`,values);return json(200,{items:result.rows});}
    if(method==="GET"&&parts.length===2){const result=await db.query(`SELECT * FROM ledgerly_ai.tasks WHERE task_id=$1 AND organization_id=$2`,[parts[1],ctx.organizationId]);return result.rows[0]?json(200,result.rows[0]):json(404,{error:{code:"AI_TASK_NOT_FOUND",message:"AI task not found"}});}
    if(method==="POST"&&parts.length===1){const input=await body(request);await requireActiveAgent(runtime,ctx,input.assignedAgent);return json(201,await runtime.ai.tasks.create({context:ctx,assignedAgent:input.assignedAgent,instruction:input.instruction,priority:input.priority,dueTime:input.dueTime,inputReferences:input.inputReferences,idempotencyKey:idempotencyKey(request,input)}));}
    if(method==="POST"&&parts[2]==="handoff"){const task=(await db.query(`SELECT * FROM ledgerly_ai.tasks WHERE task_id=$1 AND organization_id=$2`,[parts[1],ctx.organizationId])).rows[0];if(!task)return json(404,{error:{code:"AI_TASK_NOT_FOUND",message:"AI task not found"}});const fromAgent=await runtime.ai.agents.get(ctx,task.assigned_agent);if(!fromAgent)return json(404,{error:{code:"AI_AGENT_NOT_FOUND",message:"Source AI employee not found"}});const input=await body(request);await requireActiveAgent(runtime,ctx,input.toAgent);return json(201,await runtime.ai.tasks.handoff({context:ctx,task,fromAgent,toAgent:input.toAgent,instruction:input.instruction}));}
    if(method==="POST"&&parts[2]==="cancel"){const input=await body(request);return json(200,await runtime.ai.tasks.cancel({context:ctx,taskId:parts[1],reason:input.reason??null}));}
    if(method==="POST"&&parts[2]==="retry"){const task=(await db.query(`SELECT assigned_agent FROM ledgerly_ai.tasks WHERE task_id=$1 AND organization_id=$2`,[parts[1],ctx.organizationId])).rows[0];if(!task)return json(404,{error:{code:"AI_TASK_NOT_FOUND",message:"AI task not found"}});await requireActiveAgent(runtime,ctx,task.assigned_agent);const input=await body(request);return json(200,await runtime.ai.tasks.retry({context:ctx,taskId:parts[1],reason:input.reason??null}));}
  }

  if(parts[0]==="approvals"){
    if(method==="GET"&&parts.length===1){const result=await db.query(`SELECT * FROM ledgerly_ai.approvals WHERE organization_id=$1 ORDER BY requested_at DESC LIMIT 200`,[ctx.organizationId]);return json(200,{items:result.rows});}
    if(method==="POST"&&parts[2]==="decision"){runtime.auth.requireScope(principal,"ai:approve");const input=await body(request);return json(200,await runtime.ai.approvals.decide({context:ctx,approvalId:parts[1],approve:Boolean(input.approve),reason:input.reason??null}));}
    if(method==="POST"&&parts[2]==="execute"){
      runtime.auth.requireScope(principal,"ai:approve");
      const approval=await runtime.ai.approvals.get({context:ctx,approvalId:parts[1]});if(!approval)return json(404,{error:{code:"AI_APPROVAL_NOT_FOUND",message:"Approval not found"}});
      if(approval.status==="executed"){const resumed=approval.task_id?await runtime.ai.tasks.resumeAfterApproval({context:ctx,taskId:approval.task_id,approvalId:approval.approval_id,result:approval.executed_result}):{resumed:false,reason:"approval_has_no_task"};return json(200,{status:"executed",output:approval.executed_result,resumed,recovered:true});}
      if(approval.status!=="approved")return json(409,{error:{code:"AI_APPROVAL_NOT_EXECUTABLE",message:`Approval is ${approval.status}, not approved`}});
      const agent=await runtime.ai.agents.get(ctx,approval.agent_id);if(!agent)return json(404,{error:{code:"AI_AGENT_NOT_FOUND",message:"AI employee not found"}});
      const executionContext=await approvalExecutionContext(runtime,principal,approval,agent);
      const result=await runtime.ai.gateway.executeApproved({approval,agent:{...agent,permissions:executionContext.permissions},context:executionContext});
      const executed=await runtime.ai.approvals.markExecuted({context:ctx,approvalId:parts[1],result});
      const resumed=approval.task_id?await runtime.ai.tasks.resumeAfterApproval({context:ctx,taskId:approval.task_id,approvalId:approval.approval_id,result}):{resumed:false,reason:"approval_has_no_task"};
      return json(200,{...result,approval:executed,resumed});
    }
  }

  if(parts[0]==="documents"){
    if(method==="GET"&&parts.length===1){const result=await db.query(`SELECT * FROM ledgerly_ai.documents WHERE organization_id=$1 ORDER BY updated_at DESC LIMIT 200`,[ctx.organizationId]);return json(200,{items:result.rows});}
    if(method==="GET"&&parts.length===2){const result=await db.query(`SELECT * FROM ledgerly_ai.documents WHERE document_id=$1 AND organization_id=$2`,[parts[1],ctx.organizationId]);return result.rows[0]?json(200,result.rows[0]):json(404,{error:{code:"AI_DOCUMENT_NOT_FOUND",message:"Document not found"}});}
    if(method==="PATCH"&&parts.length===2){const input=await body(request);return json(200,await runtime.ai.documents.reviseHuman({context:ctx,documentId:parts[1],content:input.content,reason:input.reason??null}));}
    if(method==="POST"&&parts[2]==="status"){const input=await body(request);return json(200,await runtime.ai.documents.setStatus({context:ctx,documentId:parts[1],status:input.status,reason:input.reason??null}));}
    if(method==="GET"&&parts[2]==="history"){const result=await db.query(`SELECT * FROM ledgerly_ai.document_versions WHERE document_id=$1 AND organization_id=$2 ORDER BY version DESC`,[parts[1],ctx.organizationId]);return json(200,{items:result.rows});}
    if(method==="POST"&&parts[2]==="render-pdf")return json(200,await runtime.ai.documents.renderPdf({context:ctx,documentId:parts[1]}));
    if(method==="GET"&&parts[2]==="pdf"){const expires=Math.max(60,Math.min(Number(url.searchParams.get("expires"))||900,3600));return json(200,await runtime.ai.getRenderedDocumentUrl({context:ctx,documentId:parts[1],expiresSeconds:expires}));}
  }

  if(parts[0]==="knowledge"){
    if(method==="GET"&&parts[1]==="sources"){const result=await db.query(`SELECT * FROM ledgerly_ai.knowledge_sources WHERE organization_id=$1 ORDER BY created_at DESC`,[ctx.organizationId]);return json(200,{items:result.rows,capabilities:runtime.ai.storeCapabilities});}
    if(method==="POST"&&parts[1]==="upload"){const bytes=await readRaw(request,MAX_UPLOAD_BYTES);if(!bytes.length){const e=new Error("Knowledge upload is empty");e.status=422;throw e;}const name=cleanFilename(header(request,"x-file-name")||url.searchParams.get("name")||"knowledge-document"),contentType=String(header(request,"content-type")||"application/octet-stream").split(";")[0].trim(),sourceType=String(header(request,"x-source-type")||"uploaded_document");return json(201,await runtime.ai.uploadKnowledge({context:ctx,name,bytes,contentType,sourceType}));}
    if(method==="POST"&&parts[1]==="sources"&&parts.length===2){const input=await body(request);return json(201,await runtime.ai.knowledge.createSource({context:ctx,name:input.name,sourceType:input.sourceType,storageRef:input.storageRef,metadata:input.metadata}));}
    if(method==="POST"&&parts[1]==="sources"&&parts[3]==="chunks"){const input=await body(request);return json(200,await runtime.ai.knowledge.indexChunks({context:ctx,sourceId:parts[2],chunks:input.chunks??[]}));}
    if(method==="POST"&&parts[1]==="retrieve"){const input=await body(request);return json(200,{items:await runtime.ai.knowledge.retrieve({context:ctx,query:input.query,sourceIds:input.sourceIds,limit:input.limit})});}
  }

  if(parts[0]==="memory"&&parts[1]){const agentId=parts[1];if(method==="GET")return json(200,{items:await runtime.ai.memory.list({context:ctx,agentId,type:url.searchParams.get("type"),includeDisabled:url.searchParams.get("includeDisabled")==="true"})});if(method==="POST"&&parts.length===2){await getAgent(runtime,ctx,agentId);const input=await body(request);return json(200,await runtime.ai.memory.put({context:ctx,agentId,type:input.type,key:input.key,value:input.value,expiresAt:input.expiresAt}));}if(method==="DELETE"&&parts.length===2){await getAgent(runtime,ctx,agentId);const input=await body(request);return json(200,await runtime.ai.memory.clear({context:ctx,agentId,type:input.type??null}));}if(method==="POST"&&parts[2]&&parts[3]==="disable"){await getAgent(runtime,ctx,agentId);const input=await body(request);return json(200,await runtime.ai.memory.disable({context:ctx,memoryId:parts[2],disabled:input.disabled!==false}));}}

  if(parts[0]==="schedules"){if(method==="GET"){const items=await runtime.services.scheduler.list({organizationId:ctx.organizationId,limit:200});return json(200,{items:items.filter((item)=>item.kind==="ai.task")});}if(method==="POST"&&parts.length===1){const input=await body(request);await requireActiveAgent(runtime,ctx,input.agentId);return json(201,await runtime.ai.schedules.register({context:ctx,name:input.name,agentId:input.agentId,instruction:input.instruction,cron:input.cron,timezone:input.timezone,priority:input.priority,enabled:input.enabled}));}if(method==="DELETE"&&parts.length===2)return json(200,await runtime.ai.schedules.cancel({context:ctx,scheduleId:parts[1]}));}

  if(parts[0]==="academic"){if(method==="POST"&&parts[1]==="draft"){const input=await body(request);await requireActiveAgent(runtime,ctx,input.agentId);return json(201,await runtime.ai.academic.requestDraft({context:ctx,...input}));}if(method==="POST"&&parts[1]==="review"){const input=await body(request);await requireActiveAgent(runtime,ctx,input.reviewerAgentId);return json(201,await runtime.ai.academic.requestReview({context:ctx,...input}));}if(method==="GET"&&parts[1]==="reviews"&&parts[2])return json(200,{items:await runtime.ai.academic.listReviews({context:ctx,documentId:parts[2]})});}

  if(parts[0]==="activity"&&method==="GET"){const rows=await runtime.services.audit.list({organizationId:ctx.organizationId,limit:300});return json(200,{items:rows.filter((row)=>row.actor_type==="ai_agent"||String(row.action||"").startsWith("ai.")).map((row)=>({activity_id:row.id,organization_id:row.organization_id,agent_id:row.agent_id,task_id:row.metadata?.task_id??null,activity_type:row.action,summary:row.reason||row.action,data:row.metadata,occurred_at:row.occurred_at}))});}
  if(parts[0]==="audit"&&method==="GET"){const rows=await runtime.services.audit.list({organizationId:ctx.organizationId,limit:300});return json(200,{items:rows.filter((row)=>row.actor_type==="ai_agent"||String(row.action||"").startsWith("ai."))});}
  if(parts[0]==="settings"&&method==="GET")return json(200,{provider:runtime.ai.config.providerConfig,embeddingModel:runtime.ai.config.embeddingModel,limits:runtime.ai.config.limits,knowledge:runtime.ai.storeCapabilities});

  return json(404,{error:{code:"AI_ROUTE_NOT_FOUND",message:"AI Workforce route not found"}});
}
