import { createSchoolSetupService } from "../../school-platform/setup-service.mjs";

const PREFIX="/api/v1/school/setup";

function fail(status,code,message){throw Object.assign(new Error(message),{status,code});}
async function json(request){const chunks=[];let size=0;for await(const chunk of request){size+=chunk.length;if(size>1048576)fail(413,"PAYLOAD_TOO_LARGE","Request body is too large");chunks.push(chunk);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{fail(400,"INVALID_JSON","Invalid JSON request body");}}
async function principal(runtime,request,scope){const p=await runtime.auth.authenticateRequest({headers:request.headers});runtime.auth.requireScope(p,scope);return p;}
function service(runtime){return createSchoolSetupService({database:runtime.services.database,auditService:runtime.services.audit});}

export default {
  name:"school-setup",
  prefix:PREFIX,
  business:true,
  priority:80,
  enabled(config){return config.extensions?.["school-platform"]?.enabled===true;},
  async handle({request,url,runtime,requestId}){
    const svc=service(runtime),path=url.pathname;
    if(request.method==="GET"&&path===`${PREFIX}/profile`){const p=await principal(runtime,request,"school:read");return{status:200,body:{data:await svc.profile(p.organizationId)}};}
    if(request.method==="PUT"&&path===`${PREFIX}/profile`){const p=await principal(runtime,request,"school:write");return{status:200,body:{data:await svc.saveProfile({principal:p,requestId,value:await json(request)})}};}
    if(request.method==="GET"&&path===`${PREFIX}/bootstrap/status`){const p=await principal(runtime,request,"school:read");return{status:200,body:{data:await svc.bootstrapStatus(p.organizationId)}};}
    if(request.method==="POST"&&path===`${PREFIX}/bootstrap/defaults`){const p=await principal(runtime,request,"school:write");return{status:200,body:{data:await svc.ensureDefaults({principal:p,requestId})}};}
    if(request.method==="GET"&&path===`${PREFIX}/settings/all`){const p=await principal(runtime,request,"school:read");return{status:200,body:{data:await svc.settings(p.organizationId)}};}
    if(request.method==="PUT"&&path===`${PREFIX}/settings/value`){const p=await principal(runtime,request,"school:write");return{status:200,body:{data:await svc.saveSetting({principal:p,requestId,value:await json(request)})}};}
    const close=path.match(/^\/api\/v1\/school\/setup\/terms\/([^/]+)\/close$/);if(request.method==="POST"&&close){const p=await principal(runtime,request,"school:write");return{status:200,body:{data:await svc.closeTerm({principal:p,requestId,termId:decodeURIComponent(close[1])})}};}
    const item=path.match(/^\/api\/v1\/school\/setup\/([^/]+)\/([^/]+)$/);if(item){const key=decodeURIComponent(item[1]),recordId=decodeURIComponent(item[2]);if(request.method==="GET"){const p=await principal(runtime,request,"school:read");return{status:200,body:{data:await svc.get({organizationId:p.organizationId,key,recordId})}};}if(request.method==="PUT"){const p=await principal(runtime,request,"school:write");return{status:200,body:{data:await svc.update({principal:p,requestId,key,recordId,record:await json(request)})}};}if(request.method==="DELETE"){const p=await principal(runtime,request,"school:write");await svc.remove({principal:p,requestId,key,recordId});return{status:200,body:{data:{deleted:true}}};}}
    const collection=path.match(/^\/api\/v1\/school\/setup\/([^/]+)$/);if(collection){const key=decodeURIComponent(collection[1]);if(request.method==="GET"){const p=await principal(runtime,request,"school:read");return{status:200,body:{data:await svc.list({organizationId:p.organizationId,key,limit:url.searchParams.get("limit"),offset:url.searchParams.get("offset")})}};}if(request.method==="POST"){const p=await principal(runtime,request,"school:write");return{status:201,body:{data:await svc.create({principal:p,requestId,key,record:await json(request)})}};}}
    fail(404,"SCHOOL_SETUP_ROUTE_NOT_FOUND","School setup route not found");
  }
};
