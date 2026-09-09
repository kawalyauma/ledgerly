// @ts-nocheck
function uid(prefix="camaudit"){return `${prefix}_${crypto.randomUUID().replace(/-/g,"")}`}
function clean(v:any,max=500){return String(v??"").trim().slice(0,max)}
export async function cameraAudit(db:D1Database,input:any){
 const details=input?.details&&typeof input.details==="object"?input.details:{};
 await db.prepare(`INSERT INTO security_camera_audit_events(id,organization_id,actor_id,action,resource_type,resource_id,camera_id,server_id,ip_address,user_agent,details_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(uid(),clean(input.organizationId,120),clean(input.actorId,180)||"system",clean(input.action,120),clean(input.resourceType,80)||"camera-system",clean(input.resourceId,180)||null,clean(input.cameraId,180)||null,clean(input.serverId,180)||null,clean(input.ipAddress,100)||null,clean(input.userAgent,300)||null,JSON.stringify(details)).run();
 return{ok:true}
}
export function auditFromContext(c:any,action:string,resourceType:string,resourceId?:string,details?:any){const p=c.get("principal");return cameraAudit(c.env.FINANCE_DB,{organizationId:p.organizationId,actorId:p.userId,action,resourceType,resourceId,cameraId:resourceType==="camera"?resourceId:null,serverId:resourceType==="server"?resourceId:null,ipAddress:c.req.header("CF-Connecting-IP")||c.req.header("X-Forwarded-For")||null,userAgent:c.req.header("User-Agent")||null,details})}
