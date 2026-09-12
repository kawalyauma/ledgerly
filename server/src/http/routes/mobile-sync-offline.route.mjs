const PREFIX = "/api/v1/mobile-sync/offline";

function fail(status, code, message) { throw Object.assign(new Error(message), { status, code }); }
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

export default {
  name: "mobile-sync-offline",
  prefix: PREFIX,
  public: true,
  priority: 95,
  enabled(config) {
    const extension = config.extensions?.["mobile-sync"];
    return extension?.enabled === true && extension?.cutover === "node";
  },
  async handle({ request, url, runtime, config }) {
    if (url.pathname !== `${PREFIX}/exchange`) fail(404, "MOBILE_SYNC_ROUTE_NOT_FOUND", "Mobile sync offline route not found");
    if (request.method !== "POST") return { status: 405, headers: { allow: "POST" }, body: { error: { code: "METHOD_NOT_ALLOWED", message: "Only POST is allowed" } } };
    const api = runtime.extensions?.["mobile-sync"]?.api;
    if (!api) fail(503, "MOBILE_SYNC_NOT_READY", "Self-hosted mobile sync API is unavailable");
    const exchanged = await api.exchangeOfflineGrant(await body(request, config.http.maxRequestBodyBytes));
    const session = await runtime.auth.issueTokens({
      userId: exchanged.identity.userId,
      organizationId: exchanged.identity.organizationId,
      role: exchanged.identity.role,
      scopes: exchanged.identity.scopes,
      mobileDeviceId: exchanged.identity.mobileDeviceId,
    });
    return {
      status: 200,
      body: {
        data: {
          accessToken: session.accessToken,
          expiresIn: session.expiresIn,
          deviceId: exchanged.deviceId,
          organizationId: exchanged.organizationId,
          offlineGrantExpiresAt: exchanged.offlineGrantExpiresAt,
          protocolVersion: exchanged.protocolVersion,
          serverTime: exchanged.serverTime,
        },
      },
    };
  },
};
