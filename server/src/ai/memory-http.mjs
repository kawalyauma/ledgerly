const MAX_BODY_BYTES=1_000_000;
const json=(status,body)=>({status,body});

async function readJson(request){
  let size=0;const chunks=[];
  for await(const chunk of request){size+=chunk.length;if(size>MAX_BODY_BYTES){const error=new Error("Request body too large");error.status=413;throw error;}chunks.push(chunk);}
  if(!chunks.length)return{};
  try{return JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{const error=new Error("Invalid JSON body");error.status=400;throw error;}
}
function parts(pathname){return pathname.replace(/^\/selfhost\/ai\/memory\/?/,"").split("/").filter(Boolean).map(decodeURIComponent);}
function context(principal){return{organizationId:principal.organizationId,userId:principal.userId,userName:principal.userName??principal.userId,permissions:principal.scopes??[]};}
async function principalFor(runtime,request){
  const authenticated=await runtime.auth.authenticateRequest({headers:request.headers});
  const live=await runtime.authorization.resolveCurrentActorAccess({organizationId:authenticated.organizationId,actorId:authenticated.userId});
  const principal={...authenticated,role:live.role,scopes:live.effectiveScopes};
  runtime.auth.requireScope(principal,"ai:approve");
  return principal;
}

export async function handleAiMemoryRequest({request,url,runtime}){
  if(!runtime.ai)return json(503,{error:{code:"AI_WORKFORCE_DISABLED",message:"AI Workforce is disabled on this Ledgerly server."}});
  const principal=await principalFor(runtime,request),ctx=context(principal),method=request.method??"GET",path=parts(url.pathname);
  if(!path[0])return json(400,{error:{code:"AI_MEMORY_AGENT_REQUIRED",message:"Agent id is required"}});
  const agent=await runtime.ai.agents.get(ctx,path[0]);
  if(!agent)return json(404,{error:{code:"AI_AGENT_NOT_FOUND",message:"AI employee not found"}});

  if(method==="GET"&&path.length===1)return json(200,{items:await runtime.ai.memory.list({context:ctx,agentId:path[0],type:url.searchParams.get("type"),includeDisabled:url.searchParams.get("includeDisabled")==="true"})});
  if(method==="POST"&&path.length===1){const input=await readJson(request);return json(200,await runtime.ai.memory.put({context:ctx,agentId:path[0],type:input.type,key:input.key,value:input.value,expiresAt:input.expiresAt,requiredPermissions:input.requiredPermissions??[]}));}
  if(method==="DELETE"&&path.length===1){const input=await readJson(request);return json(200,await runtime.ai.memory.clear({context:ctx,agentId:path[0],type:input.type??null}));}
  if(method==="POST"&&path.length===3&&path[2]==="disable"){const input=await readJson(request);return json(200,await runtime.ai.memory.disable({context:ctx,memoryId:path[1],disabled:input.disabled!==false}));}
  return json(404,{error:{code:"AI_MEMORY_ROUTE_NOT_FOUND",message:"AI memory route not found"}});
}
