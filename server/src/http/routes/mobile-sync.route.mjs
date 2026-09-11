const PREFIX = "/selfhost/mobile-sync";

function fail(status, code, message) { throw Object.assign(new Error(message), { status, code }); }
async function readJson(request, maxBytes = 1048576) {
  let size = 0; const chunks = [];
  for await (const chunk of request) { size += chunk.length; if (size > maxBytes) fail(413, "PAYLOAD_TOO_LARGE", "Request body is too large"); chunks.push(chunk); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { fail(400, "INVALID_JSON", "Request body must be valid JSON"); }
}
async function authenticate(runtime, request) { return runtime.auth.authenticateRequest({ headers: request.headers }); }
function deviceId(principal, body, request) {
  const header = typeof request.headers?.get === "function" ? request.headers.get("x-device-id") : request.headers?.["x-device-id"];
  const value = principal.mobileDeviceId ?? body.deviceId ?? header;
  if (typeof value !== "string" || value.trim() === "") fail(422, "SYNC_DEVICE_REQUIRED", "deviceId is required");
  return value.trim();
}

export default {
  name: "mobile-sync",
  prefix: PREFIX,
  enabled(config) { return config.extensions?.["mobile-sync"]?.enabled === true; },
  async handle({ request, url, runtime, requestId }) {
    const extension = runtime.extensions["mobile-sync"];
    if (!extension) fail(503, "MOBILE_SYNC_NOT_READY", "Self-hosted mobile sync is not enabled");
    const who = await authenticate(runtime, request);
    if (request.method === "POST" && url.pathname === `${PREFIX}/devices/register`) {
      const body = await readJson(request); const id = deviceId(who, body, request);
      const row = await extension.registerDevice({ organizationId: who.organizationId, userId: who.userId, deviceId: id, platform: body.platform, appVersion: body.appVersion, deviceName: body.deviceName });
      return { status: 200, body: { device: row } };
    }
    if (request.method === "POST" && url.pathname === `${PREFIX}/push`) {
      const body = await readJson(request);
      const result = await extension.service.push({ organizationId: who.organizationId, userId: who.userId, deviceId: deviceId(who, body, request), batchUuid: body.batchUuid, operations: body.operations });
      return { status: 200, body: result };
    }
    if (request.method === "GET" && url.pathname === `${PREFIX}/pull`) {
      const result = await extension.service.pull({ organizationId: who.organizationId, userId: who.userId, deviceId: deviceId(who, {}, request), moduleKey: url.searchParams.get("moduleKey"), collectionKey: url.searchParams.get("collectionKey"), cursor: Number(url.searchParams.get("cursor") ?? 0), limit: Number(url.searchParams.get("limit") ?? undefined), requestId });
      return { status: 200, body: result };
    }
    if (request.method === "POST" && url.pathname === `${PREFIX}/ack`) {
      const body = await readJson(request); if (!body.deliveryId) fail(422, "SYNC_DELIVERY_REQUIRED", "deliveryId is required");
      const result = await extension.service.acknowledgePull({ organizationId: who.organizationId, userId: who.userId, deviceId: deviceId(who, body, request), deliveryId: body.deliveryId });
      return { status: 200, body: result };
    }
    fail(404, "MOBILE_SYNC_ROUTE_NOT_FOUND", "Mobile sync route not found");
  },
};
