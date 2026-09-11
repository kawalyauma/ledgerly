import test from "node:test";
import assert from "node:assert/strict";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { hashPassword, passwordNeedsRehash, sha256, verifyPassword } from "../src/auth/crypto.mjs";
import { ALL_SCOPES, hasScope, parseScopes } from "../src/auth/permissions.mjs";
import { AuthCompatibilityService } from "../src/auth/service.mjs";

class FakeDatabase {
  constructor(handler) { this.handler = handler; this.queries = []; }
  async query(text, values = []) { this.queries.push({ text, values }); return this.handler(text, values, false); }
  async transaction(work) {
    this.queries.push({ text: "BEGIN", values: [] });
    const tx = { query: async (text, values = []) => { this.queries.push({ text, values }); return this.handler(text, values, true); } };
    try { const result = await work(tx); this.queries.push({ text: "COMMIT", values: [] }); return result; }
    catch (error) { this.queries.push({ text: "ROLLBACK", values: [] }); throw error; }
  }
}

const fakeJwt = {
  async signAccessToken(input) { return `signed:${input.userId}:${input.organizationId}:${input.role}`; },
  async verifyAccessToken(token) {
    if (token === "bad") throw new Error("bad");
    return { sub: "usr_1", org: "org_1", role: "manager", scopes: ["reports:read"], mobileDeviceId: "mob_1" };
  },
};

test("password format remains compatible with scrypt-v1 and legacy pbkdf2", async () => {
  const encoded = await hashPassword("correct horse battery staple");
  assert.match(encoded, /^scrypt-v1:16384:8:1:/);
  assert.equal(await verifyPassword("correct horse battery staple", encoded), true);
  assert.equal(await verifyPassword("wrong", encoded), false);
  assert.equal(passwordNeedsRehash(encoded), false);

  const salt = randomBytes(16);
  const legacy = pbkdf2Sync("legacy-pass", salt, 120000, 32, "sha256");
  const legacyEncoded = `pbkdf2-sha256:120000:${salt.toString("hex")}:${legacy.toString("hex")}`;
  assert.equal(await verifyPassword("legacy-pass", legacyEncoded), true);
  assert.equal(passwordNeedsRehash(legacyEncoded), true);
});

test("permission compatibility preserves owner/admin bypass and explicit staff scopes", () => {
  assert.equal(hasScope({ role: "owner", scopes: [] }, "journals:write"), true);
  assert.equal(hasScope({ role: "admin", scopes: [] }, "admin:write"), true);
  assert.equal(hasScope({ role: "manager", scopes: ["reports:read"] }, "reports:read"), true);
  assert.equal(hasScope({ role: "manager", scopes: ["reports:read"] }, "reports:write"), false);
  assert.deepEqual(parseScopes('["school:read",3,"school:write"]'), ["school:read", "school:write"]);
  assert.ok(ALL_SCOPES.includes("communications:write"));
});

test("request authentication preserves development headers, API keys and bearer principals", async () => {
  const db = new FakeDatabase((text, values) => {
    if (text.includes("FROM api_keys")) {
      assert.equal(values[0], sha256("api-secret"));
      return { rows: [{ id: "key_1", organizationId: "org_api", scopes: '["reports:read"]' }] };
    }
    if (text.startsWith("UPDATE api_keys")) return { rows: [], rowCount: 1 };
    return { rows: [] };
  });
  const dev = new AuthCompatibilityService({ database: db, jwt: fakeJwt, appSecret: "secret", environment: "development" });
  const devPrincipal = await dev.authenticateRequest({ headers: { "X-Organization-Id": "org_dev", "X-User-Id": "usr_dev" } });
  assert.equal(devPrincipal.role, "owner");
  assert.equal(devPrincipal.organizationId, "org_dev");

  const prod = new AuthCompatibilityService({ database: db, jwt: fakeJwt, appSecret: "secret", environment: "production" });
  const apiPrincipal = await prod.authenticateRequest({ headers: { "X-API-Key": "api-secret" } });
  assert.deepEqual(apiPrincipal, { userId: "apikey:key_1", organizationId: "org_api", role: "integration", scopes: ["reports:read"] });

  const bearer = await prod.authenticateRequest({ headers: { Authorization: "Bearer valid" } });
  assert.equal(bearer.userId, "usr_1");
  assert.equal(bearer.mobileDeviceId, "mob_1");
  assert.throws(() => prod.requireScope(bearer, "reports:write"), /Missing required scope/);
});

test("refresh token rotation revokes and recreates session in one transaction", async () => {
  const oldRefresh = "old-refresh";
  const db = new FakeDatabase((text, values, inTx) => {
    if (text.includes("FROM sessions s")) {
      assert.equal(inTx, true);
      assert.equal(values[0], sha256(oldRefresh));
      return { rows: [{ id: "ses_old", userId: "usr_1", organizationId: "org_1", role: "manager", scopes: '["school:read"]' }] };
    }
    if (text.startsWith("UPDATE sessions SET revoked_at")) return { rows: [], rowCount: 1 };
    if (text.startsWith("INSERT INTO sessions")) return { rows: [], rowCount: 1 };
    return { rows: [] };
  });
  const auth = new AuthCompatibilityService({ database: db, jwt: fakeJwt, appSecret: "secret", environment: "production" });
  const result = await auth.refresh({ refreshToken: oldRefresh, ip: "127.0.0.1", userAgent: "test" });
  assert.equal(result.expiresIn, 900);
  assert.match(result.sessionId, /^ses_[0-9a-z]{16}$/);
  assert.equal(db.queries[0].text, "BEGIN");
  assert.equal(db.queries.at(-1).text, "COMMIT");
  assert.equal(db.queries.some((q) => q.text.includes("FOR UPDATE OF s")), true);
});
