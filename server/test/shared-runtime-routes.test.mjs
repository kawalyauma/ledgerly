import test from "node:test";
import assert from "node:assert/strict";
import communicationsRoute from "../src/http/routes/communications.route.mjs";
import mobileSyncRoute from "../src/http/routes/mobile-sync.route.mjs";

function request(method, body = null, headers = {}) {
  const chunks = body == null ? [] : [Buffer.from(JSON.stringify(body))];
  return { method, headers, async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk; } };
}
function auth(principal, required = []) {
  return {
    async authenticateRequest() { return principal; },
    requireScope(value, scope) { required.push(scope); if (!value.scopes?.includes(scope)) throw Object.assign(new Error("forbidden"), { status: 403, code: "FORBIDDEN" }); },
  };
}

test("communications route tenant-scopes campaign actions and preserves actor attribution", async () => {
  const calls = []; const required = [];
  const principal = { organizationId: "org_a", userId: "usr_a", role: "member", scopes: ["communications:write"] };
  const runtime = { auth: auth(principal, required), extensions: { communications: { repository: {}, async ensureOrganizationSchedule(org) { calls.push(["schedule", org]); }, service: { async queueCampaign(input) { calls.push(["queue", input]); return { id: input.campaignId, status: "queued" }; } } } } };
  const result = await communicationsRoute.handle({ request: request("POST", {}), url: new URL("http://local/selfhost/communications/campaigns/cmp_1/queue"), runtime });
  assert.equal(result.status, 200); assert.deepEqual(required, ["communications:write"]); assert.equal(calls[0][1], "org_a"); assert.equal(calls[1][1].organizationId, "org_a"); assert.deepEqual(calls[1][1].actor, { actorType: "human", actorId: "usr_a" });
});

test("communications read is constrained to authenticated organization", async () => {
  let seenOrg;
  const principal = { organizationId: "org_a", userId: "usr_a", role: "member", scopes: ["communications:read"] };
  const runtime = { auth: auth(principal), extensions: { communications: { repository: { async getCampaign(org) { seenOrg = org; return null; } } } } };
  await assert.rejects(communicationsRoute.handle({ request: request("GET"), url: new URL("http://local/selfhost/communications/campaigns/cmp_foreign"), runtime }), (error) => error.status === 404);
  assert.equal(seenOrg, "org_a");
});

test("mobile sync registration binds client device id to authenticated organization and user", async () => {
  let input;
  const principal = { organizationId: "org_a", userId: "usr_a", role: "member", scopes: [] };
  const runtime = { auth: auth(principal), extensions: { "mobile-sync": { async registerDevice(value) { input = value; return { id: value.deviceId }; } } } };
  const result = await mobileSyncRoute.handle({ request: request("POST", { deviceId: "device_client_1", platform: "android" }), url: new URL("http://local/selfhost/mobile-sync/devices/register"), runtime, requestId: "req_1" });
  assert.equal(result.status, 200); assert.equal(input.organizationId, "org_a"); assert.equal(input.userId, "usr_a"); assert.equal(input.deviceId, "device_client_1");
});

test("mobile sync pull ignores caller tenant/user values and uses authenticated principal", async () => {
  let input;
  const principal = { organizationId: "org_real", userId: "usr_real", role: "member", scopes: [] };
  const runtime = { auth: auth(principal), extensions: { "mobile-sync": { service: { async pull(value) { input = value; return { items: [], cursor: 0 }; } } } } };
  await mobileSyncRoute.handle({ request: request("GET", null, { "x-device-id": "dev_1" }), url: new URL("http://local/selfhost/mobile-sync/pull?organizationId=org_fake&userId=usr_fake&moduleKey=contacts&collectionKey=contacts"), runtime, requestId: "req_2" });
  assert.equal(input.organizationId, "org_real"); assert.equal(input.userId, "usr_real"); assert.equal(input.deviceId, "dev_1");
});
