import { AppError } from "../../../src/lib/errors";
import type { MobileSyncAuthorizationContext } from "../../mobile-sync/backend/contracts";

async function hasPermission(c: MobileSyncAuthorizationContext, permission: string) {
  const p=c.principal;
  if(p.role==="owner"||p.role==="admin") return true;
  if(p.scopes.includes(permission)||p.scopes.includes("school:*")||(p.scopes.includes("school:write")&&permission.endsWith(":write"))) return true;
  return Boolean(await c.db.prepare(`SELECT 1 FROM school_user_roles ur
    JOIN school_role_permissions rp ON rp.organization_id=ur.organization_id AND rp.role_id=ur.role_id
    WHERE ur.organization_id=? AND ur.user_id=? AND rp.permission=? AND rp.effect='allow'
      AND (ur.starts_at IS NULL OR ur.starts_at<=CURRENT_TIMESTAMP) AND (ur.ends_at IS NULL OR ur.ends_at>=CURRENT_TIMESTAMP)
    UNION ALL SELECT 1 FROM school_temporary_permissions tp WHERE tp.organization_id=? AND tp.user_id=? AND tp.permission=?
      AND tp.revoked_at IS NULL AND tp.starts_at<=CURRENT_TIMESTAMP AND tp.ends_at>=CURRENT_TIMESTAMP LIMIT 1`)
    .bind(c.organizationId,p.userId,permission,c.organizationId,p.userId,permission).first());
}
export async function requireAcademicsRead(c:MobileSyncAuthorizationContext){if(!await hasPermission(c,"school.academics:read"))throw new AppError(403,"FORBIDDEN","Missing school permission: school.academics:read");}
export async function requireAcademicsWrite(c:MobileSyncAuthorizationContext){if(!await hasPermission(c,"school.academics:write"))throw new AppError(403,"FORBIDDEN","Missing school permission: school.academics:write");}
export async function canManageTeacher(c:MobileSyncAuthorizationContext,teacherUserId:string){
  if(c.principal.role==="owner"||c.principal.role==="admin"||teacherUserId===c.userId)return true;
  return await hasPermission(c,"school.academics:approve")||await hasPermission(c,"school.academics:supervise");
}
