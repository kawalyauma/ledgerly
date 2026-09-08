import { SignJWT } from "jose";
import { AppError } from "../../../src/lib/errors";
import { randomToken, sha256 } from "../../../src/lib/crypto";
import { createId } from "../../../src/lib/ids";
import { auditStatement } from "../../../src/services/audit";
import type { AuthPrincipal, Env } from "../../../src/types";
import { MOBILE_SYNC_PROTOCOL_VERSION } from "./contracts";

const OFFLINE_GRANT_DAYS = 400;
const ACCESS_TOKEN_SECONDS = 900;

export type DeviceRegistrationInput = {
  installationId: string;
  deviceName: string;
  platform: "android" | "ios";
  appVersion: string;
  clientSchemaVersion: number;
  deviceModel?: string | null;
  osVersion?: string | null;
};

type DeviceRow = {
  id: string;
  organizationId: string;
  userId: string;
  installationId: string;
  deviceName: string;
  platform: string;
  status: string;
  lastPushSequence: number;
  clientSchemaVersion: number;
};

async function newGrant(db: D1Database, deviceId: string) {
  const token = randomToken(48), id = createId("mog"), tokenHash = await sha256(token);
  return {
    token,
    id,
    insert: db.prepare(`INSERT INTO mobile_offline_grants
      (id,device_id,token_hash,expires_at) VALUES (?,?,?,datetime('now',?))`)
      .bind(id, deviceId, tokenHash, `+${OFFLINE_GRANT_DAYS} days`),
  };
}

async function loadDevice(db: D1Database, organizationId: string, deviceId: string) {
  return db.prepare(`SELECT id,organization_id AS organizationId,user_id AS userId,installation_id AS installationId,
    device_name AS deviceName,platform,status,last_push_sequence AS lastPushSequence,client_schema_version AS clientSchemaVersion
    FROM mobile_sync_devices WHERE id=? AND organization_id=?`).bind(deviceId, organizationId).first<DeviceRow>();
}

export async function registerDevice(db: D1Database, principal: AuthPrincipal, input: DeviceRegistrationInput) {
  const existing = await db.prepare(`SELECT id,status FROM mobile_sync_devices
    WHERE organization_id=? AND user_id=? AND installation_id=?`)
    .bind(principal.organizationId, principal.userId, input.installationId).first<{ id: string; status: string }>();
  if (existing?.status === "revoked") {
    throw new AppError(403, "DEVICE_REVOKED", "This mobile installation was revoked. Reset the app installation before registering it again.");
  }
  const deviceId = existing?.id ?? createId("msd"), grant = await newGrant(db, deviceId);
  const statements: D1PreparedStatement[] = [];
  if (existing) {
    statements.push(db.prepare(`UPDATE mobile_sync_devices SET device_name=?,platform=?,app_version=?,client_schema_version=?,
      device_model=?,os_version=?,status='active',last_seen_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(input.deviceName, input.platform, input.appVersion, input.clientSchemaVersion, input.deviceModel ?? null, input.osVersion ?? null, deviceId));
  } else {
    statements.push(db.prepare(`INSERT INTO mobile_sync_devices
      (id,organization_id,user_id,installation_id,device_name,platform,app_version,client_schema_version,device_model,os_version,status,last_seen_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,'active',CURRENT_TIMESTAMP)`)
      .bind(deviceId, principal.organizationId, principal.userId, input.installationId, input.deviceName, input.platform,
        input.appVersion, input.clientSchemaVersion, input.deviceModel ?? null, input.osVersion ?? null));
  }
  statements.push(
    db.prepare("UPDATE mobile_offline_grants SET revoked_at=CURRENT_TIMESTAMP,rotated_at=CURRENT_TIMESTAMP WHERE device_id=? AND revoked_at IS NULL").bind(deviceId),
    grant.insert,
    auditStatement(db, { organizationId: principal.organizationId, actorId: principal.userId, action: existing ? "mobile.device_refreshed" : "mobile.device_registered", entityType: "mobile_sync_device", entityId: deviceId, after: { installationId: input.installationId, platform: input.platform } }),
  );
  await db.batch(statements);
  const grantRow = await db.prepare("SELECT expires_at AS expiresAt FROM mobile_offline_grants WHERE id=?").bind(grant.id).first<{ expiresAt: string }>();
  return {
    deviceId,
    installationId: input.installationId,
    protocolVersion: MOBILE_SYNC_PROTOCOL_VERSION,
    offlineGrant: grant.token,
    offlineGrantExpiresAt: grantRow?.expiresAt,
    offlineGrantDays: OFFLINE_GRANT_DAYS,
  };
}

export async function listDevices(db: D1Database, principal: AuthPrincipal) {
  const allUsers = principal.role === "owner" || principal.role === "admin";
  const result = await db.prepare(`SELECT id,user_id AS userId,installation_id AS installationId,device_name AS deviceName,platform,
    device_model AS deviceModel,os_version AS osVersion,app_version AS appVersion,client_schema_version AS clientSchemaVersion,
    status,last_push_sequence AS lastPushSequence,last_seen_at AS lastSeenAt,revoked_at AS revokedAt,created_at AS createdAt
    FROM mobile_sync_devices WHERE organization_id=? ${allUsers ? "" : "AND user_id=?"} ORDER BY last_seen_at DESC,created_at DESC`)
    .bind(principal.organizationId, ...(allUsers ? [] : [principal.userId])).all();
  return result.results;
}

export async function revokeDevice(db: D1Database, principal: AuthPrincipal, deviceId: string, reason?: string) {
  const device = await loadDevice(db, principal.organizationId, deviceId);
  if (!device) throw new AppError(404, "DEVICE_NOT_FOUND", "Mobile device not found");
  const admin = principal.role === "owner" || principal.role === "admin";
  if (!admin && device.userId !== principal.userId) throw new AppError(403, "FORBIDDEN", "You cannot revoke another user's device");
  await db.batch([
    db.prepare("UPDATE mobile_sync_devices SET status='revoked',revoked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(deviceId, principal.organizationId),
    db.prepare("UPDATE mobile_offline_grants SET revoked_at=CURRENT_TIMESTAMP WHERE device_id=? AND revoked_at IS NULL").bind(deviceId),
    auditStatement(db, { organizationId: principal.organizationId, actorId: principal.userId, action: "mobile.device_revoked", entityType: "mobile_sync_device", entityId: deviceId, after: { reason: reason ?? null } }),
  ]);
  return { deviceId, status: "revoked" as const };
}

export async function assertOwnedActiveDevice(db: D1Database, principal: AuthPrincipal, deviceId: string) {
  const device = await loadDevice(db, principal.organizationId, deviceId);
  if (!device) throw new AppError(404, "DEVICE_NOT_FOUND", "Mobile device not found");
  if (device.status !== "active") throw new AppError(403, "DEVICE_NOT_ACTIVE", "This mobile device is revoked or inactive");
  if (device.userId !== principal.userId) throw new AppError(403, "DEVICE_USER_MISMATCH", "This device belongs to a different user");
  return device;
}

export async function exchangeOfflineGrant(env: Env, input: { deviceId: string; offlineGrant: string; appVersion?: string; clientSchemaVersion?: number }) {
  const tokenHash = await sha256(input.offlineGrant);
  const row = await env.FINANCE_DB.prepare(`SELECT g.id AS grantId,g.device_id AS deviceId,d.organization_id AS organizationId,d.user_id AS userId,
      d.status AS deviceStatus,u.status AS userStatus
    FROM mobile_offline_grants g
    JOIN mobile_sync_devices d ON d.id=g.device_id
    JOIN users u ON u.id=d.user_id
    WHERE g.device_id=? AND g.token_hash=? AND g.revoked_at IS NULL AND g.expires_at>CURRENT_TIMESTAMP`)
    .bind(input.deviceId, tokenHash).first<{ grantId: string; deviceId: string; organizationId: string; userId: string; deviceStatus: string; userStatus: string }>();
  if (!row || row.deviceStatus !== "active" || row.userStatus !== "active") {
    throw new AppError(401, "INVALID_OFFLINE_GRANT", "Offline device grant is invalid, expired or revoked. Sign in online again.");
  }
  const membership = await env.FINANCE_DB.prepare("SELECT role,scopes FROM memberships WHERE organization_id=? AND user_id=?")
    .bind(row.organizationId, row.userId).first<{ role: string; scopes: string }>();
  if (!membership) throw new AppError(403, "NO_MEMBERSHIP", "This user no longer belongs to the organization");
  const schoolProfile = await env.FINANCE_DB.prepare("SELECT status,locked_until AS lockedUntil FROM school_user_profiles WHERE organization_id=? AND user_id=?")
    .bind(row.organizationId, row.userId).first<{ status: string; lockedUntil: string | null }>().catch(() => null);
  if (schoolProfile && (schoolProfile.status === "suspended" || schoolProfile.status === "inactive" ||
      (schoolProfile.status === "locked" && (!schoolProfile.lockedUntil || new Date(schoolProfile.lockedUntil) > new Date())))) {
    throw new AppError(403, "ACCOUNT_LOCKED", "This account is suspended or locked");
  }

  // Exchange renews the same revocable opaque secret. Rotating here could strand a year-offline client if the HTTP response is lost.
  await env.FINANCE_DB.batch([
    env.FINANCE_DB.prepare("UPDATE mobile_offline_grants SET last_used_at=CURRENT_TIMESTAMP,expires_at=datetime('now',?) WHERE id=? AND revoked_at IS NULL")
      .bind(`+${OFFLINE_GRANT_DAYS} days`, row.grantId),
    env.FINANCE_DB.prepare(`UPDATE mobile_sync_devices SET last_seen_at=CURRENT_TIMESTAMP,app_version=COALESCE(?,app_version),
      client_schema_version=COALESCE(?,client_schema_version),updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(input.appVersion ?? null, input.clientSchemaVersion ?? null, row.deviceId),
    auditStatement(env.FINANCE_DB, { organizationId: row.organizationId, actorId: row.userId, action: "mobile.offline_grant_exchanged", entityType: "mobile_sync_device", entityId: row.deviceId }),
  ]);

  const scopes = JSON.parse(membership.scopes || "[]") as string[];
  const now = Math.floor(Date.now() / 1000);
  const accessToken = await new SignJWT({ org: row.organizationId, role: membership.role, scopes, mobileDeviceId: row.deviceId, amr: ["offline_device_grant"] })
    .setProtectedHeader({ alg: "HS256" }).setSubject(row.userId).setIssuer(env.JWT_ISSUER).setAudience(env.JWT_AUDIENCE)
    .setIssuedAt(now).setExpirationTime(now + ACCESS_TOKEN_SECONDS).sign(new TextEncoder().encode(env.JWT_SECRET));
  const grantRow = await env.FINANCE_DB.prepare("SELECT expires_at AS expiresAt FROM mobile_offline_grants WHERE id=?").bind(row.grantId).first<{ expiresAt: string }>();
  return {
    accessToken,
    expiresIn: ACCESS_TOKEN_SECONDS,
    deviceId: row.deviceId,
    organizationId: row.organizationId,
    offlineGrantExpiresAt: grantRow?.expiresAt,
    protocolVersion: MOBILE_SYNC_PROTOCOL_VERSION,
    serverTime: new Date().toISOString(),
  };
}
