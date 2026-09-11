const MAX_BODY_BYTES=1_000_000;
const json=(status,body)=>({status,body});

async function readJson(request){
  let size=0;const chunks=[];
  for await(const chunk of request){size+=chunk.length;if(size>MAX_BODY_BYTES){const error=new Error("Request body too large");error.status=413;throw error;}chunks.push(chunk);}
  if(!chunks.length)return{};
  try{return JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{const error=new Error("Invalid JSON body");error.status=400;throw error;}
}
function parts(pathname){return pathname.replace(/^\/selfhost\/ai\/documents\/?/,"").split("/").filter(Boolean).map(decodeURIComponent);}
function context(principal){return{organizationId:principal.organizationId,userId:principal.userId,userName:principal.userName??principal.userId,permissions:principal.scopes??[]};}
function wildcard(principal){return(principal.scopes??[]).includes("*");}

async function principalFor(runtime,request,method){
  const authenticated=await runtime.auth.authenticateRequest({headers:request.headers});
  const live=await runtime.authorization.resolveCurrentActorAccess({organizationId:authenticated.organizationId,actorId:authenticated.userId});
  const principal={...authenticated,role:live.role,scopes:live.effectiveScopes};
  runtime.auth.requireScope(principal,method==="GET"?"ai:read":"ai:write");
  runtime.auth.requireScope(principal,method==="GET"?"documents:read":"documents:write");
  return principal;
}

async function visibleDocument(db,principal,documentId){
  const values=[documentId,principal.organizationId];
  let filter="document_id=$1 AND organization_id=$2";
  if(!wildcard(principal)){values.push(JSON.stringify(principal.scopes??[]));filter+=` AND required_permissions <@ $3::jsonb`;}
  return (await db.query(`SELECT * FROM ledgerly_ai.documents WHERE ${filter}`,values)).rows[0]??null;
}

export async function handleAiDocumentRequest({request,url,runtime}){
  if(!runtime.ai)return json(503,{error:{code:"AI_WORKFORCE_DISABLED",message:"AI Workforce is disabled on this Ledgerly server."}});
  const method=request.method??"GET",path=parts(url.pathname),principal=await principalFor(runtime,request,method),ctx=context(principal),db=runtime.services.database;

  if(method==="GET"&&path.length===0){
    const values=[ctx.organizationId];let filter="organization_id=$1";
    if(!wildcard(principal)){values.push(JSON.stringify(principal.scopes??[]));filter+=` AND required_permissions <@ $2::jsonb`;}
    const result=await db.query(`SELECT * FROM ledgerly_ai.documents WHERE ${filter} ORDER BY updated_at DESC LIMIT 200`,values);
    return json(200,{items:result.rows});
  }

  if(path.length>=1){
    const document=await visibleDocument(db,principal,path[0]);
    if(!document)return json(404,{error:{code:"AI_DOCUMENT_NOT_FOUND",message:"Document not found or not visible to current authority"}});
    if(method==="GET"&&path.length===1)return json(200,document);
    if(method==="PATCH"&&path.length===1){const input=await readJson(request);return json(200,await runtime.ai.documents.reviseHuman({context:ctx,documentId:path[0],content:input.content,reason:input.reason??null}));}
    if(method==="POST"&&path[1]==="status"){const input=await readJson(request);return json(200,await runtime.ai.documents.setStatus({context:ctx,documentId:path[0],status:String(input.status??""),reason:input.reason??null}));}
    if(method==="POST"&&path[1]==="render")return json(200,await runtime.ai.documents.renderPdf({context:ctx,documentId:path[0]}));
    if(method==="GET"&&path[1]==="history"){
      const result=await db.query(`SELECT * FROM ledgerly_ai.document_versions WHERE document_id=$1 AND organization_id=$2 ORDER BY version DESC`,[path[0],ctx.organizationId]);
      return json(200,{items:result.rows});
    }
  }
  return json(404,{error:{code:"AI_DOCUMENT_ROUTE_NOT_FOUND",message:"AI document route not found"}});
}
