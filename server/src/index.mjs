import http from "node:http";
import { randomUUID } from "node:crypto";
import { loadConfig } from "./config.mjs";
import { createRuntime } from "./runtime.mjs";
import { createHttpRouteRegistry } from "./http/routes.mjs";

const config=loadConfig();const runtime=await createRuntime(config);const routes=await createHttpRouteRegistry({runtime,config});const startedAt=Date.now();
const securityHeaders=requestId=>({"cache-control":"no-store","x-content-type-options":"nosniff","x-frame-options":"DENY","referrer-policy":"no-referrer","x-request-id":requestId});
function writeJson(response,status,body,requestId,extraHeaders={}){const payload=JSON.stringify(body);response.writeHead(status,{...securityHeaders(requestId),...extraHeaders,"content-type":"application/json; charset=utf-8","content-length":Buffer.byteLength(payload)});response.end(payload);}
function writeRaw(response,status,rawBody,requestId,headers={}){const payload=Buffer.from(rawBody);response.writeHead(status,{...securityHeaders(requestId),...headers,"content-length":headers['content-length']??payload.length});response.end(payload);}

const rateBuckets=new Map();
function requestClientKey(request){const direct=String(request.socket?.remoteAddress??"unknown");if(!config.http.trustProxyHeaders)return direct;const real=String(request.headers["x-real-ip"]??"").trim();const forwarded=String(request.headers["x-forwarded-for"]??"").split(",")[0].trim();return real||forwarded||direct;}
function consumeRateLimit(request){const now=Date.now();const key=requestClientKey(request);let bucket=rateBuckets.get(key);if(!bucket||bucket.resetAt<=now){bucket={count:0,resetAt:now+config.http.rateLimitWindowMs};rateBuckets.set(key,bucket);}bucket.count+=1;if(rateBuckets.size>10000){for(const [candidate,item] of rateBuckets){if(item.resetAt<=now)rateBuckets.delete(candidate);}}return {allowed:bucket.count<=config.http.rateLimitMaxRequests,retryAfterSeconds:Math.max(1,Math.ceil((bucket.resetAt-now)/1000))};}
function declaredBodyTooLarge(request){const raw=request.headers["content-length"];if(raw==null)return false;const value=Number.parseInt(String(raw),10);return Number.isFinite(value)&&value>config.http.maxRequestBodyBytes;}

const server=http.createServer(async(request,response)=>{const requestId=request.headers["x-request-id"]||randomUUID();const url=new URL(request.url??"/",`http://${request.headers.host??"localhost"}`);try{
  if(declaredBodyTooLarge(request))return writeJson(response,413,{error:{code:"SELFHOST_REQUEST_TOO_LARGE",message:"Request body exceeds the configured limit.",requestId}},requestId,{connection:"close"});
  const privateProbe=url.pathname==="/selfhost/health"||url.pathname==="/selfhost/ready"||url.pathname==="/selfhost/contracts";
  if(!privateProbe){const rate=consumeRateLimit(request);if(!rate.allowed)return writeJson(response,429,{error:{code:"SELFHOST_RATE_LIMITED",message:"Too many requests. Retry later.",requestId}},requestId,{"retry-after":String(rate.retryAfterSeconds)});}
  if(request.method==="GET"&&url.pathname==="/selfhost/health")return writeJson(response,200,{status:"ok",service:config.serviceName,environment:config.environment,runtimeMode:config.runtimeMode,uptimeSeconds:Math.floor((Date.now()-startedAt)/1000),businessRoutesEnabled:routes.describe().some(r=>r.business)},requestId);
  if(request.method==="GET"&&url.pathname==="/selfhost/ready"){const readiness=await runtime.readiness();return writeJson(response,readiness.ok?200:503,{status:readiness.ok?"ready":"not_ready",service:config.serviceName,...readiness},requestId);}
  if(request.method==="GET"&&url.pathname==="/selfhost/contracts")return writeJson(response,200,{...runtime.describeContracts(),httpRoutes:routes.describe()},requestId);
  const routed=await routes.dispatch({request,url,requestId});if(routed)return routed.rawBody!=null?writeRaw(response,routed.status,routed.rawBody,requestId,routed.headers):writeJson(response,routed.status,routed.body,requestId,routed.headers);
  return writeJson(response,404,{error:{code:"SELFHOST_ROUTE_NOT_FOUND",message:"The requested self-hosted route is not enabled. Ledgerly business traffic remains on Cloudflare until the corresponding migration and cutover checks complete.",requestId}},requestId);
}catch(error){const requestedStatus=Number(error?.status??error?.statusCode??500);const status=Number.isInteger(requestedStatus)&&requestedStatus>=400&&requestedStatus<=599?requestedStatus:500;console.error(JSON.stringify({level:"error",requestId,status,message:error instanceof Error?error.message:String(error),stack:status>=500&&error instanceof Error?error.stack:undefined}));return writeJson(response,status,{error:{code:error?.code??(status===500?"SELFHOST_INTERNAL_ERROR":"SELFHOST_REQUEST_FAILED"),message:status===500?"The self-hosted request could not be completed.":String(error?.message??"Request failed"),requestId}},requestId);}});
server.requestTimeout=15_000;server.headersTimeout=10_000;server.keepAliveTimeout=5_000;server.maxRequestsPerSocket=1000;
server.listen(config.port,config.host,()=>console.info(JSON.stringify({level:"info",message:"Ledgerly self-hosted foundation API listening",host:config.host,port:config.port,environment:config.environment,runtimeMode:config.runtimeMode,domainRoutes:routes.describe().map(route=>route.name)})));
async function shutdown(signal){console.info(JSON.stringify({level:"info",message:"Stopping Ledgerly self-hosted API",signal}));const forceTimer=setTimeout(()=>{server.closeAllConnections?.();process.exit(1)},10_000).unref();server.close(async()=>{try{await runtime.close();clearTimeout(forceTimer);process.exit(0)}catch(error){console.error(JSON.stringify({level:"error",message:"Self-hosted runtime shutdown failed",error:error instanceof Error?error.message:String(error)}));process.exit(1)}});server.closeIdleConnections?.();}
process.once("SIGTERM",()=>void shutdown("SIGTERM"));process.once("SIGINT",()=>void shutdown("SIGINT"));
