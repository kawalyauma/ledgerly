import{AppError}from'../../../src/lib/errors';import type{MobileSyncAuthorizationContext}from'../../mobile-sync/backend/contracts';
function allowed(c:MobileSyncAuthorizationContext,scope:string){const p=c.principal;return p.role==='owner'||p.role==='admin'||p.scopes.includes(scope)||(scope.endsWith(':read')&&p.scopes.includes(scope.replace(':read',':write')))}
export async function requirePaymentsRead(c:MobileSyncAuthorizationContext){if(!allowed(c,'payments:read'))throw new AppError(403,'FORBIDDEN','Missing payments:read permission')}
export async function requirePaymentsWrite(c:MobileSyncAuthorizationContext){if(!allowed(c,'payments:write'))throw new AppError(403,'FORBIDDEN','Missing payments:write permission')}
export async function requirePayrollRead(c:MobileSyncAuthorizationContext){if(!allowed(c,'payroll:read'))throw new AppError(403,'FORBIDDEN','Missing payroll:read permission')}
