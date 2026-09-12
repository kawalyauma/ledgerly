const PREFIX = "/api/v1/modules";

function fail(status, code, message) { throw Object.assign(new Error(message), { status, code }); }

async function readJson(request, maxBytes) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBytes) fail(413, "SELFHOST_REQUEST_TOO_LARGE", "Request body exceeds the configured limit.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { fail(400, "INVALID_JSON", "Request body must be valid JSON"); }
}

function requireAdmin(runtime, principal, write = false) {
  runtime.auth.requireScope(principal, write ? "admin:write" : "admin:read");
}

export default {
  name: "platform-modules",
  prefix: PREFIX,
  business: true,
  enabled: (config) => config.extensions?.["platform-modules"]?.enabled === true,
  async handle({ request, url, requestId, runtime, config }) {
    const principal = await runtime.auth.authenticateRequest({ headers: request.headers });
    const service = runtime.extensions?.["platform-modules"];
    if (!service) fail(503, "PLATFORM_MODULES_UNAVAILABLE", "Self-hosted module registry is unavailable");

    const suffix = url.pathname.slice(PREFIX.length).replace(/^\/+|\/+$/g, "");
    if (request.method === "GET" && suffix === "enabled") {
      return { status: 200, body: { data: await service.enabled(principal.organizationId) } };
    }
    if (request.method === "GET" && suffix === "") {
      requireAdmin(runtime, principal, false);
      return { status: 200, body: { data: await service.list(principal.organizationId) } };
    }

    let match = suffix.match(/^([^/]+)\/(enable|disable)$/);
    if (request.method === "POST" && match) {
      requireAdmin(runtime, principal, true);
      const key = decodeURIComponent(match[1]);
      if (match[2] === "enable") {
        const payload = await readJson(request, config.http.maxRequestBodyBytes);
        const configuration = payload?.configuration && typeof payload.configuration === "object" && !Array.isArray(payload.configuration)
          ? payload.configuration
          : {};
        return {
          status: 200,
          body: { data: await service.enable({ organizationId: principal.organizationId, userId: principal.userId, key, configuration, requestId }) },
        };
      }
      return {
        status: 200,
        body: { data: await service.disable({ organizationId: principal.organizationId, userId: principal.userId, key, requestId }) },
      };
    }

    fail(404, "PLATFORM_MODULE_ROUTE_NOT_FOUND", "Module registry route not found");
  },
};
