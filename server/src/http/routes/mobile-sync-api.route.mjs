const PREFIX = "/api/v1/mobile-sync";

function fail(status, code, message, details = undefined) { throw Object.assign(new Error(message), { status, code, details }); }
async function body(request, maxBytes) {
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maxBytes) fail(413, "SELFHOST_REQUEST_TOO_LARGE", "Request body exceeds the configured limit.");
    chunks.push(bytes);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { fail(400, "INVALID_JSON", "Request body must be valid JSON"); }
}
async function principal(runtime, request) { return runtime.auth.authenticateRequest({ headers: request.headers }); }

export default {
  name: "mobile-sync-api",
  prefix: PREFIX,
  business: true,
  priority: 45,
  enabled(config) { return config.extensions?.["mobile-sync"]?.enabled === true; },
  async handle({ request, url, runtime, config, requestId }) {
    const api = runtime.extensions?.["mobile-sync"]?.api;
    if (!api) fail(503, "MOBILE_SYNC_NOT_READY", "Self-hosted mobile sync API is unavailable");
    const suffix = url.pathname.slice(PREFIX.length).replace(/^\/+|\/+$/g, "");
    const who = await principal(runtime, request);

    if (request.method === "GET" && suffix === "manifest") return { status: 200, body: { data: api.manifest() } };

    let match = suffix.match(/^eligible\/([^/]+)$/);
    if (request.method === "GET" && match) return { status: 200, body: { data: await api.eligible(who, decodeURIComponent(match[1])) } };

    if (request.method === "POST" && suffix === "devices") {
      return { status: 201, body: { data: await api.registerDevice(who, await body(request, config.http.maxRequestBodyBytes), { requestId }) } };
    }
    if (request.method === "GET" && suffix === "devices") return { status: 200, body: { data: await api.listDevices(who) } };

    match = suffix.match(/^devices\/([^/]+)\/revoke$/);
    if (request.method === "POST" && match) {
      const input = await body(request, config.http.maxRequestBodyBytes);
      return { status: 200, body: { data: await api.revokeDevice(who, decodeURIComponent(match[1]), input.reason, { requestId }) } };
    }

    if (request.method === "POST" && suffix === "schemas/ack") return { status: 200, body: { data: await api.acknowledgeSchemas(who, await body(request, config.http.maxRequestBodyBytes)) } };
    if (request.method === "POST" && suffix === "bootstrap") return { status: 200, body: { data: await api.bootstrap(who, await body(request, config.http.maxRequestBodyBytes)) } };
    if (request.method === "POST" && suffix === "bootstrap/ack") return { status: 200, body: { data: await api.acknowledgeBootstrap(who, await body(request, config.http.maxRequestBodyBytes)) } };
    if (request.method === "POST" && suffix === "push") return { status: 200, body: { data: await api.push(who, await body(request, config.http.maxRequestBodyBytes)) } };
    if (request.method === "POST" && suffix === "pull") return { status: 200, body: { data: await api.pull(who, await body(request, config.http.maxRequestBodyBytes)) } };
    if (request.method === "POST" && suffix === "pull/ack") return { status: 200, body: { data: await api.acknowledgePull(who, await body(request, config.http.maxRequestBodyBytes)) } };

    match = suffix.match(/^recovery\/([^/]+)$/);
    if (request.method === "GET" && match) {
      return { status: 200, body: { data: await api.recovery(who, decodeURIComponent(match[1]), url.searchParams.get("batchId")) } };
    }

    fail(404, "MOBILE_SYNC_ROUTE_NOT_FOUND", "Mobile sync route not found");
  },
};
