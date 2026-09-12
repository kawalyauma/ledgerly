const PREFIX = "/api/v1/school/setup";

function fail(status, code, message) { throw Object.assign(new Error(message), { status, code }); }
async function parseBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { fail(400, "INVALID_JSON", "Request body must be valid JSON"); }
}
function query(url) { return Object.fromEntries(url.searchParams.entries()); }
function writeEnabled(config) { return config.extensions?.["school-platform"]?.referenceWriteCutover === "node"; }

export default {
  name: "school-setup",
  prefix: PREFIX,
  business: true,
  priority: 40,
  enabled(config) { return config.extensions?.["school-platform"]?.enabled === true; },
  async handle({ request, url, runtime, config }) {
    const principal = await runtime.auth.authenticateRequest({ headers: request.headers });
    const service = runtime.extensions?.["school-platform"]?.setup;
    if (!service) fail(503, "SCHOOL_SETUP_NOT_READY", "School PostgreSQL setup service is not ready");

    const isWrite = request.method !== "GET" && request.method !== "HEAD";
    runtime.auth.requireScope(principal, isWrite ? "school:write" : "school:read");
    if (isWrite && !writeEnabled(config)) {
      fail(503, "SCHOOL_SETUP_WRITE_NOT_CUT_OVER", "School setup writes remain on Cloudflare until PostgreSQL write cutover validation passes");
    }

    const path = url.pathname.slice(PREFIX.length) || "/";

    if (request.method === "GET" && path === "/bootstrap/status") {
      return { status: 200, body: { data: await service.bootstrapStatus(principal.organizationId) } };
    }
    if (request.method === "GET" && path === "/profile") {
      return { status: 200, body: { data: await service.getProfile(principal.organizationId) } };
    }
    if (request.method === "PUT" && path === "/profile") {
      return { status: 200, body: { data: await service.saveProfile(principal.organizationId, await parseBody(request)) } };
    }
    if (request.method === "GET" && path === "/settings/all") {
      return { status: 200, body: { data: await service.getSettings(principal.organizationId) } };
    }
    if (request.method === "PUT" && path === "/settings/value") {
      return { status: 200, body: { data: await service.setSetting(principal.organizationId, await parseBody(request), principal.userId) } };
    }

    let match = path.match(/^\/terms\/([^/]+)\/close$/);
    if (match && request.method === "POST") {
      return { status: 200, body: { data: await service.closeTerm(principal.organizationId, decodeURIComponent(match[1])) } };
    }

    match = path.match(/^\/([A-Za-z][A-Za-z0-9]*)$/);
    if (match) {
      const resource = match[1];
      if (request.method === "GET") return { status: 200, body: { data: await service.list(resource, principal.organizationId, query(url)) } };
      if (request.method === "POST") return { status: 201, body: { data: await service.create(resource, principal.organizationId, await parseBody(request), principal.userId) } };
    }

    match = path.match(/^\/([A-Za-z][A-Za-z0-9]*)\/([^/]+)$/);
    if (match) {
      const resource = match[1], id = decodeURIComponent(match[2]);
      if (request.method === "PUT") return { status: 200, body: { data: await service.update(resource, principal.organizationId, id, await parseBody(request)) } };
      if (request.method === "DELETE") return { status: 200, body: { data: await service.remove(resource, principal.organizationId, id) } };
    }

    fail(404, "SCHOOL_SETUP_ROUTE_NOT_FOUND", "School setup route not found");
  },
};
