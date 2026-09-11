import { AuthError } from "./errors.mjs";
import { effectiveScopes, parseScopes } from "./permissions.mjs";

function requireText(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} is required`);
  return value.trim();
}

function accountBlocked(row) {
  if (!row) return true;
  if (row.user_status && row.user_status !== "active") return true;
  if (!row.school_status) return false;
  if (row.school_status === "suspended" || row.school_status === "inactive") return true;
  if (row.school_status !== "locked") return false;
  if (!row.locked_until) return true;
  const lockedUntil = Date.parse(row.locked_until);
  if (!Number.isFinite(lockedUntil)) return true;
  return lockedUntil > Date.now();
}

export async function resolveCurrentActorAccess({ database, organizationId, actorId }) {
  if (!database?.query) throw new TypeError("resolveCurrentActorAccess requires database.query()");
  const org = requireText(organizationId, "organizationId");
  const actor = requireText(actorId, "actorId");

  if (actor.startsWith("apikey:")) {
    const keyId = actor.slice("apikey:".length);
    if (!keyId) throw new AuthError(403, "BACKGROUND_ACTOR_REVOKED", "Background API-key authority is no longer valid");
    const result = await database.query(
      `SELECT id, scopes
       FROM api_keys
       WHERE id=$1 AND organization_id=$2
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP)`,
      [keyId, org],
    );
    const key = result.rows[0];
    if (!key) throw new AuthError(403, "BACKGROUND_ACTOR_REVOKED", "Background API-key authority is no longer valid");
    const principal = { userId: actor, organizationId: org, role: "integration", scopes: parseScopes(key.scopes) };
    return Object.freeze({ ...principal, effectiveScopes: Object.freeze(effectiveScopes(principal)) });
  }

  const result = await database.query(
    `SELECT m.role,m.scopes,u.status AS user_status,
            p.status AS school_status,p.locked_until
     FROM memberships m
     JOIN users u ON u.id=m.user_id
     LEFT JOIN school_user_profiles p
       ON p.organization_id=m.organization_id AND p.user_id=m.user_id
     WHERE m.organization_id=$1 AND m.user_id=$2
     LIMIT 1`,
    [org, actor],
  );
  const access = result.rows[0];
  if (!access) throw new AuthError(403, "BACKGROUND_ACTOR_REVOKED", "Background actor no longer has organization access");
  if (accountBlocked(access)) throw new AuthError(403, "BACKGROUND_ACTOR_BLOCKED", "Background actor account is inactive, suspended, or locked");

  const principal = {
    userId: actor,
    organizationId: org,
    role: access.role,
    scopes: parseScopes(access.scopes),
  };
  return Object.freeze({ ...principal, effectiveScopes: Object.freeze(effectiveScopes(principal)) });
}

export function intersectPermissions(...collections) {
  if (collections.length === 0) return [];
  const normalized = collections.map((items) => new Set(parseScopes(items)));
  const concrete = normalized.filter((items) => !items.has("*"));
  if (concrete.length === 0) return ["*"];
  const [first, ...rest] = concrete;
  return [...first].filter((permission) => rest.every((items) => items.has(permission))).sort();
}
