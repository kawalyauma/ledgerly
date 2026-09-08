import { AppError } from "../../../src/lib/errors";
import type { MobileSyncAuthorizationContext } from "../../mobile-sync/backend/contracts";

function allowed(c: MobileSyncAuthorizationContext, level: "read" | "write") {
  const p=c.principal;
  return p.role==="owner"||p.role==="admin"||p.scopes.includes("contacts:write")||(level==="read"&&p.scopes.includes("contacts:read"));
}
export async function requireContactsRead(c:MobileSyncAuthorizationContext){if(!allowed(c,"read"))throw new AppError(403,"FORBIDDEN","Missing contacts:read permission")}
export async function requireContactsWrite(c:MobileSyncAuthorizationContext){if(!allowed(c,"write"))throw new AppError(403,"FORBIDDEN","Missing contacts:write permission")}
