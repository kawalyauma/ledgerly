const MAX_BODY_BYTES=1_000_000;
const json=(status,body)=>({status,body});

async function readJson(request){
  let size=0;const chunks=[];
  for await(const chunk of request){size+=chunk.length;if(size>MAX_BODY_BYTES){const error=new Error("Request body too large");error.status=413;throw error;}chunks.push(chunk);}
  if(!chunks.length)return{};
  try{return JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{const error=new Error("Invalid JSON body");error.status=400;throw error;}
}
function parts(pathname){return pathname.replace(/^\/selfhost\/ai\/tasks\/?/,"").split("/").filter(Boolean).map(decodeURIComponent);}
function isApprover(principal){const scopes=new Set(principal.scopes??[]);return scopes.has("*")||scopes.has("ai:approve");}
function ctx(principal){return{organizationId:principal.organizationId,userId:principal.userId,userName:principal.userName??principal.userId,permissions:principal.scopes??[]};}

async function principalFor(runtime,request,scope){
  const authenticated=await runtime.auth.authenticateRequest({headers:request.headers});
  const live=await runtime.authorization.resolveCurrentActorAccess({organizationId:authenticated.organizationId,actorId:authenticated.userId});
  const principal={...authenticated,role:live.role,scopes:live.effectiveScopes};
  runtime.auth.requireScope(principal,scope);
  return principal;
}

function ownershipError(){const error=new Error("AI task is not owned by the current requester");error.status=403;error.code="AI_TASK_ACCESS_DENIED";return error;}

export async function handleAiTaskRequest({request,url,runtime}){
  if(!runtime.ai)return json(503,{error:{code:"AI_WORKFORCE_DISABLED",message:"AI Workforce is disabled on this Ledgerly server."}});
  const method=request.method??"GET",path=parts(url.pathname);
  const principal=await principalFor(runtime,request,method==="GET"?"ai:read":"ai:write");
  const context=ctx(principal),db=runtime.services.database,approver=isApprover(principal);

  if(method==="GET"&&path.length===0){
    const status=url.searchParams.get("status"),values=[context.organizationId];
    let filter="organization_id=$1";
    if(!approver){values.push(context.userId);filter+=` AND requested_by=$${values.length}`;}
    if(status){values.push(status);filter+=` AND status=$${values.length}`;}
    const result=await db.query(`SELECT * FROM ledgerly_ai.tasks WHERE ${filter} ORDER BY priority DESC,created_at DESC LIMIT 200`,values);
    return json(200,{items:result.rows});
  }

  if(method==="POST"&&path.length===0){
    const input=await readJson(request);
    return json(201,await runtime.ai.tasks.create({context,assignedAgent:input.assignedAgent,instruction:input.instruction,priority:input.priority,dueTime:input.dueTime,inputReferences:input.inputReferences,idempotencyKey:input.idempotencyKey}));
  }

  if(path.length>=1){
    const task=(await db.query(`SELECT * FROM ledgerly_ai.tasks WHERE task_id=$1 AND organization_id=$2`,[path[0],context.organizationId])).rows[0];
    if(!task)return json(404,{error:{code:"AI_TASK_NOT_FOUND",message:"AI task not found"}});
    if(!approver&&task.requested_by!==context.userId)throw ownershipError();

    if(method==="GET"&&path.length===1)return json(200,task);
    if(method==="POST"&&path[1]==="handoff"){
      const fromAgent=await runtime.ai.agents.get(context,task.assigned_agent);
      if(!fromAgent)return json(409,{error:{code:"AI_HANDOFF_SOURCE_MISSING",message:"Source AI employee no longer exists"}});
      const input=await readJson(request);
      return json(201,await runtime.ai.tasks.handoff({context,task,fromAgent,toAgent:input.toAgent,instruction:input.instruction}));
    }
    if(method==="POST"&&path[1]==="cancel")return json(200,await runtime.ai.tasks.setStatus({organizationId:context.organizationId,taskId:task.task_id,status:"cancelled"}));
  }

  return json(404,{error:{code:"AI_TASK_ROUTE_NOT_FOUND",message:"AI task route not found"}});
}
