import { AppError } from "../../../src/lib/errors";
import type { MobileSyncAuthorizationContext } from "../../mobile-sync/backend/contracts";
export async function requireHrRead(c:MobileSyncAuthorizationContext){const p=c.principal;if(p.role==='owner'||p.role==='admin'||p.scopes.includes('hr:read')||p.scopes.includes('hr:write'))return;throw new AppError(403,'FORBIDDEN','Missing Human Resources read permission')}
export async function requireHrWrite(c:MobileSyncAuthorizationContext){const p=c.principal;if(p.role==='owner'||p.role==='admin'||p.scopes.includes('hr:write'))return;throw new AppError(403,'FORBIDDEN','Missing Human Resources write permission')}
