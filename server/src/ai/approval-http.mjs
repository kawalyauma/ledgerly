const MAX_BODY_BYTES=1_000_000;
const json=(status,body)=>({status,body});

async function readJson(request){
  let size=0;const chunks=[];
  for await(const chunk of request){size+=chunk.length;if(size>MAX_BODY_BYTES){const error=new Error("Request body too large");error.status=413;throw error;}chunks.push(chunk);}
  if(!chunks.length)return{};
  try{return JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{const error=new Error("Invalid JSON body");error.status=400;throw error;}
}
function parts(pathname){return pathname.replace(/^\/selfhost\/ai\/approvals\/?/,"").split("/").filter(Boolean).map(decodeURIComponent);}
function context(principal){return{organizationId:principal.organizationId,userId:principal.userId,userName:principal.userName??principal.userId,permissions:principal.scopes??[]};}

async function principalFor(runtime,request){
  const authenticated=await runtime.auth.authenticateRequest({headers:request.headers});
  const live=await runtime.authorization.resolveCurrentActorAccess({organizationId:authenticated.organizationId,actorId:authenticated.userId});
  const principal={...authenticated,role:live.role,scopes:live.effectiveScopes};
  runtime.auth.requireScope(principal,"ai:approve");
  return principal;
}

async function delegatedExecutionContext(runtime,approverContext,approval,agent){
  let requesterScopes=approverContext.permissions;
  if(approval.task_id){
    const task=(await runtime.services.database.query(`SELECT requested_by FROM ledgerly_ai.tasks WHERE task_id=$1 AND organization_id=$2`,[approval.task_id,approverContext.organizationId])).rows[0];
    if(!task?.requested_by){const error=new Error("approval task has no attributable requester");error.code="BACKGROUND_ACTOR_REVOKED";throw error;}
    const requester=await runtime.authorization.resolveCurrentActorAccess({organizationId:approverContext.organizationId,actorId:task.requested_by});
    requesterScopes=requester.effectiveScopes;
  }
  return {...approverContext,permissions:runtime.authorization.intersectPermissions(approverContext.permissions,requesterScopes,agent.permissions??[])};
}

export async function handleAiApprovalRequest({request,url,runtime}){
  if(!runtime.ai)return json(503,{error:{code:"AI_WORKFORCE_DISABLED",message:"AI Workforce is disabled on this Ledgerly server."}});
  const principal=await principalFor(runtime,request),ctx=context(principal),method=request.method??"GET",path=parts(url.pathname),db=runtime.services.database;

  if(method==="GET"&&path.length===0){
    const result=await db.query(`SELECT * FROM ledgerly_ai.approvals WHERE organization_id=$1 ORDER BY requested_at DESC LIMIT 200`,[ctx.organizationId]);
    return json(200,{items:result.rows});
  }

  if(method==="POST"&&path.length===2&&path[1]==="decision"){
    const input=await readJson(request);
    return json(200,await runtime.ai.approvals.decide({context:ctx,approvalId:path[0],approve:Boolean(input.approve),reason:input.reason??null}));
  }

  if(method==="POST"&&path.length===2&&path[1]==="execute"){
    const claimed=await runtime.ai.approvals.claimExecution({context:ctx,approvalId:path[0]});
    try{
      const agent=await runtime.ai.agents.get(ctx,claimed.agent_id);
      if(!agent){const error=new Error("Approval agent no longer exists");error.status=409;error.code="AI_APPROVAL_AGENT_MISSING";throw error;}
      const executionContext=await delegatedExecutionContext(runtime,ctx,claimed,agent);
      const execution=await runtime.ai.gateway.executeApproved({approval:claimed,agent,context:executionContext});
      const saved=await runtime.ai.approvals.markExecuted({context:ctx,approvalId:path[0],result:execution.output});
      if(claimed.task_id)await runtime.ai.tasks.setStatus({organizationId:ctx.organizationId,taskId:claimed.task_id,status:"completed",agent,outputReferences:[{type:"approved_action",approvalId:claimed.approval_id,result:execution.output}]});
      return json(200,{approval:saved,execution});
    }catch(error){
      await runtime.ai.approvals.markExecutionFailed({context:ctx,approvalId:path[0],error}).catch(()=>undefined);
      throw error;
    }
  }

  return json(404,{error:{code:"AI_APPROVAL_ROUTE_NOT_FOUND",message:"AI approval route not found"}});
}
