import http from "node:http";
import { randomUUID } from "node:crypto";
import { loadConfig } from "./config.mjs";
import { createRuntime } from "./runtime.mjs";

const config = loadConfig();
const runtime = createRuntime(config);
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
    if (request.method === "GET" && url.pathname === "/selfhost/health") {
      return writeJson(response, 200, {
        status: "ok",
        service: config.serviceName,
        environment: config.environment,
        runtimeMode: config.runtimeMode,
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        businessRoutesEnabled: false,
      }, requestId);
    }

    if (request.method === "GET" && url.pathname === "/selfhost/ready") {
      const readiness = await runtime.readiness();
      return writeJson(response, readiness.ok ? 200 : 503, {
        status: readiness.ok ? "ready" : "not_ready",
        service: config.serviceName,
        ...readiness,
      }, requestId);
    }

    if (request.method === "GET" && url.pathname === "/selfhost/contracts") {
      return writeJson(response, 200, runtime.describeContracts(), requestId);
    }

    return writeJson(response, 404, {
      error: {
        code: "SELFHOST_ROUTE_NOT_FOUND",
        message: "The self-hosted foundation exposes only health, readiness, and contract inspection. Ledgerly business traffic still uses the Cloudflare runtime.",
        requestId,
      },
    }, requestId);
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      requestId,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }));
    return writeJson(response, 500, {
      error: {
        code: "SELFHOST_INTERNAL_ERROR",
        message: "The self-hosted foundation request could not be completed.",
        requestId,
      },
    }, requestId);
  }
});

server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 1000;

server.listen(config.port, config.host, () => {
  console.info(JSON.stringify({
    level: "info",
    message: "Ledgerly self-hosted foundation API listening",
    host: config.host,
    port: config.port,
    environment: config.environment,
    runtimeMode: config.runtimeMode,
  }));
});

async function shutdown(signal) {
  console.info(JSON.stringify({ level: "info", message: "Stopping Ledgerly self-hosted API", signal }));
  const timer = setTimeout(() => process.exit(1), 10_000).unref();
  server.close(() => {
    clearTimeout(timer);
    process.exit(0);
  });
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
