const PREFIX = "/selfhost/communications";

function fail(status, code, message) { throw Object.assign(new Error(message), { status, code }); }
async function readJson(request, maxBytes = 262144) {
  let size = 0; const chunks = [];
  for await (const chunk of request) { size += chunk.length; if (size > maxBytes) fail(413, "PAYLOAD_TOO_LARGE", "Request body is too large"); chunks.push(chunk); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { fail(400, "INVALID_JSON", "Request body must be valid JSON"); }
}
function actor(principal) { return { actorType: principal.role === "integration" ? "integration" : "human", actorId: principal.userId }; }
async function principal(runtime, request, scope) { const value = await runtime.auth.authenticateRequest({ headers: request.headers }); runtime.auth.requireScope(value, scope); return value; }
function target(pathname) { const match = pathname.match(/^\/selfhost\/communications\/campaigns\/([^/]+)(?:\/(queue|pause|resume|cancel))?$/); return match ? { campaignId: decodeURIComponent(match[1]), action: match[2] ?? null } : null; }

export default {
  name: "communications",
  prefix: PREFIX,
  enabled(config) { return config.extensions?.communications?.enabled === true; },
  async handle({ request, url, runtime }) {
    const extension = runtime.extensions.communications;
    if (!extension) fail(503, "COMMUNICATIONS_NOT_READY", "Self-hosted communications is not enabled");
    const item = target(url.pathname);
    if (request.method === "GET" && item && !item.action) {
      const who = await principal(runtime, request, "communications:read");
      const row = await extension.repository.getCampaign(who.organizationId, item.campaignId);
      if (!row) fail(404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
      return { status: 200, body: { campaign: row } };
    }
    if (request.method === "POST" && item?.action) {
      const who = await principal(runtime, request, "communications:write");
      await readJson(request);
      await extension.ensureOrganizationSchedule(who.organizationId);
      const args = { organizationId: who.organizationId, campaignId: item.campaignId, actor: actor(who) };
      let result;
      if (item.action === "queue") result = await extension.service.queueCampaign(args);
      else if (item.action === "pause") result = await extension.service.pauseCampaign(args);
      else if (item.action === "resume") result = await extension.service.resumeCampaign(args);
      else result = await extension.service.cancelCampaign(args);
      return { status: 200, body: { campaign: result } };
    }
    fail(404, "COMMUNICATIONS_ROUTE_NOT_FOUND", "Communications route not found");
  },
};
