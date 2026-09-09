// @ts-nocheck
import {AppError} from "../../../src/lib/errors";

export function requireSecurityScope(scope:string,...legacy:string[]){
  return async(c:any,next:any)=>{
    const p=c.get("principal");
    if(p?.role==="owner"||p?.role==="admin"||p?.scopes?.includes(scope)||legacy.some(x=>p?.scopes?.includes(x))){await next();return}
    throw new AppError(403,"FORBIDDEN",`Missing required security scope: ${scope}`)
  }
}

export const securityRead=requireSecurityScope("security:read","school:read","school:write");
export const securityLive=requireSecurityScope("security:live","security:manage","school:write");
export const securityExport=requireSecurityScope("security:export","security:manage","school:write");
export const securityReview=requireSecurityScope("security:review","security:manage","school:write");
export const securityManage=requireSecurityScope("security:manage","school:write");
