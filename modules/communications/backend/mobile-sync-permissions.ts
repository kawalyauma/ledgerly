import { AppError } from "../../../src/lib/errors";
import type { MobileSyncAuthorizationContext } from "../../mobile-sync/backend/contracts";

async function allowed(c: MobileSyncAuthorizationContext, level: "read" | "send") {
  const p = c.principal;
  if (p.role === "owner" || p.role === "admin") return true;
  if (p.scopes.includes("communications:write") || (level === "read" && p.scopes.includes("communications:read"))) return true;
  const permission = `school.communications:${level}`;
  const row = await c.db.prepare(`SELECT 1 FROM school_user_roles ur
    JOIN school_role_permissions rp ON rp.organization_id=ur.organization_id AND rp.role_id=ur.role_id
    WHERE ur.organization_id=? AND ur.user_id=? AND rp.permission=? AND rp.effect='allow'
      AND (ur.starts_at IS NULL OR ur.starts_at<=CURRENT_TIMESTAMP)
      AND (ur.ends_at IS NULL OR ur.ends_at>=CURRENT_TIMESTAMP)
    UNION ALL
    SELECT 1 FROM school_temporary_permissions tp
    WHERE tp.organization_id=? AND tp.user_id=? AND tp.permission=? AND tp.revoked_at IS NULL
      AND tp.starts_at<=CURRENT_TIMESTAMP AND tp.ends_at>=CURRENT_TIMESTAMP
    LIMIT 1`).bind(c.organizationId,p.userId,permission,c.organizationId,p.userId,permission).first();
  return Boolean(row);
}
export async function requireCommunicationsRead(c: MobileSyncAuthorizationContext) {
  if (!await allowed(c,"read")) throw new AppError(403,"FORBIDDEN","Missing communications read permission");
}
export async function requireCommunicationsSend(c: MobileSyncAuthorizationContext) {
  if (!await allowed(c,"send")) throw new AppError(403,"FORBIDDEN","Missing communications send permission");
}
