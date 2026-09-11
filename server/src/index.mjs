import http from "node:http";
import { randomUUID } from "node:crypto";
import { loadConfig } from "./config.mjs";
import { createRuntime } from "./runtime.mjs";
import { handleAiRequest } from "./ai/http-router.mjs";

const config = loadConfig();
const runtime = await createRuntime(config);
const startedAt = Date.now();

function writeJson(response, status, body, requestId) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "x-request-id": requestId,
  });
  response.end(payload);
}

const server = http.createServer(async (request, response) => {
  const requestId = request.headers["x-request-id"] || randomUUID();
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  try {
    if (url.pathname.startsWith("/selfhost/ai/")) {
      const result=await handleAiRequest({request,url,runtime});
      return writeJson(response,result.status,result.body,requestId);
    }

    if (request.method === "GET" && url.pathname === "/selfhost/health") {
      const ai=config.ai.enabled ? await runtime.ai?.health().catch((error)=>({ok:false,state:"error",error:error instanceof Error?error.message:String(error)})) : {ok:true,disabled:true};
      return writeJson(response, 200, {
        status: "ok",
        service: config.serviceName,
        environment: config.environment,
        runtimeMode: config.runtimeMode,
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        businessRoutesEnabled: false,
        ai,
      }, requestId);
    }

    if (request.method === "GET" && url.pathname === "/selfhost/ready") {
      const readiness = await runtime.readiness();
      return writeJson(response, readiness.ok ? 200 : 503, {status:readiness.ok?"ready":"not_ready",service:config.serviceName,...readiness}, requestId);
    }

    if (request.method === "GET" && url.pathname === "/selfhost/contracts") {
      return writeJson(response, 200, runtime.describeContracts(), requestId);
    }

    return writeJson(response, 404, {
      error: {code:"SELFHOST_ROUTE_NOT_FOUND",message:"Self-hosted route not found. Cloudflare business traffic remains active until its migration phase completes.",requestId},
    }, requestId);
  } catch (error) {
    const status=Number(error?.status??error?.statusCode??500);
    const safeStatus=Number.isInteger(status)&&status>=400&&status<=599?status:500;
    console.error(JSON.stringify({level:"error",requestId,status:safeStatus,message:error instanceof Error?error.message:String(error),stack:safeStatus>=500&&error instanceof Error?error.stack:undefined}));
    return writeJson(response,safeStatus,{
      error:{code:error?.code??(safeStatus===500?"SELFHOST_INTERNAL_ERROR":"AI_REQUEST_FAILED"),message:safeStatus===500?"The self-hosted request could not be completed.":error.message,requestId},
    },requestId);
  }
});

server.requestTimeout = 130_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 1000;

server.listen(config.port, config.host, () => {
  console.info(JSON.stringify({level:"info",message:"Ledgerly self-hosted foundation API listening",host:config.host,port:config.port,environment:config.environment,runtimeMode:config.runtimeMode,aiEnabled:config.ai.enabled}));
});

async function shutdown(signal) {
  console.info(JSON.stringify({ level: "info", message: "Stopping Ledgerly self-hosted API", signal }));
  const timer = setTimeout(() => process.exit(1), 10_000).unref();
  server.close(async () => {
    try { await runtime.close(); clearTimeout(timer); process.exit(0); }
    catch (error) { console.error(JSON.stringify({level:"error",message:"Self-hosted runtime shutdown failed",error:error instanceof Error?error.message:String(error)})); process.exit(1); }
  });
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
