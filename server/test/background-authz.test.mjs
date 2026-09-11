import test from "node:test";
import assert from "node:assert/strict";
import { resolveCurrentActorAccess, intersectPermissions } from "../src/auth/access-resolver.mjs";
import { effectiveScopes } from "../src/auth/permissions.mjs";

test("owner/admin effective scopes remain future-proof through wildcard authority", () => {
  assert.deepEqual(effectiveScopes({ role: "owner", scopes: [] }), ["*"]);
  assert.deepEqual(effectiveScopes({ role: "admin", scopes: ["school:read"] }), ["*"]);
  assert.deepEqual(effectiveScopes({ role: "member", scopes: '["school:read","school:write"]' }), ["school:read", "school:write"]);
});

test("background user authority is resolved from current membership and account state", async () => {
  const database = {
    async query(sql, values) {
      assert.match(sql, /FROM memberships/);
      assert.deepEqual(values, ["org_1", "usr_1"]);
      return { rows: [{ role: "member", scopes: '["school:read","academics:read"]', user_status: "active", school_status: "active", locked_until: null }] };
    },
  };
  const access = await resolveCurrentActorAccess({ database, organizationId: "org_1", actorId: "usr_1" });
  assert.deepEqual(access.effectiveScopes, ["school:read", "academics:read"]);
});

test("background owner authority resolves to wildcard while blocked users fail closed", async () => {
  const ownerDb = { async query() { return { rows: [{ role: "owner", scopes: "[]", user_status: "active", school_status: "active" }] }; } };
  const owner = await resolveCurrentActorAccess({ database: ownerDb, organizationId: "org_1", actorId: "owner_1" });
  assert.deepEqual(owner.effectiveScopes, ["*"]);

  const blockedDb = { async query() { return { rows: [{ role: "member", scopes: '["school:read"]', user_status: "active", school_status: "suspended" }] }; } };
  await assert.rejects(
    () => resolveCurrentActorAccess({ database: blockedDb, organizationId: "org_1", actorId: "usr_blocked" }),
    (error) => error?.code === "BACKGROUND_ACTOR_BLOCKED",
  );
});

test("revoked or expired API-key authority fails closed", async () => {
  const revoked = { async query(sql, values) { assert.match(sql, /FROM api_keys/); assert.deepEqual(values, ["key_1", "org_1"]); return { rows: [] }; } };
  await assert.rejects(
    () => resolveCurrentActorAccess({ database: revoked, organizationId: "org_1", actorId: "apikey:key_1" }),
    (error) => error?.code === "BACKGROUND_ACTOR_REVOKED",
  );

  const active = { async query() { return { rows: [{ id: "key_2", scopes: '["communications:read"]' }] }; } };
  const access = await resolveCurrentActorAccess({ database: active, organizationId: "org_1", actorId: "apikey:key_2" });
  assert.deepEqual(access.effectiveScopes, ["communications:read"]);
});

test("delegated permissions are the intersection of requester and worker authority", () => {
  assert.deepEqual(intersectPermissions(["*"], ["finance:read", "fees:read"]), ["fees:read", "finance:read"]);
  assert.deepEqual(intersectPermissions(["finance:read", "school:read"], ["finance:read", "fees:read"]), ["finance:read"]);
  assert.deepEqual(intersectPermissions(["*"], ["*"]), ["*"]);
  assert.deepEqual(intersectPermissions([], ["finance:read"]), []);
});
