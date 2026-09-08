import {Hono,type MiddlewareHandler} from "hono";
import {z} from "zod";
import type {AppVariables,Env} from "../../../src/types";
import {AppError} from "../../../src/lib/errors";
import {requireModuleEnabled} from "../../../src/lib/modules";
import {auditStatement} from "../../../src/services/audit";

const readAccess:MiddlewareHandler<{Bindings:Env;Variables:AppVariables}>=async(c,next)=>{const p=c.get("principal");if(p.role==="owner"||p.role==="admin"||p.scopes.includes("hr:read")||p.scopes.includes("hr:write")){await next();return}throw new AppError(403,"FORBIDDEN","Missing Human Resources read permission")};
const writeAccess:MiddlewareHandler<{Bindings:Env;Variables:AppVariables}>=async(c,next)=>{const p=c.get("principal");if(p.role==="owner"||p.role==="admin"||p.scopes.includes("hr:write")){await next();return}throw new AppError(403,"FORBIDDEN","Missing Human Resources write permission")};
const reviewSchema=z.object({decision:z.enum(["approve","reject"]),notes:z.string().max(1000).optional().nullable()});

export const humanResourcesAuditWorkflowRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
humanResourcesAuditWorkflowRoutes.use("*",requireModuleEnabled("human-resources"));
humanResourcesAuditWorkflowRoutes.get("/audit",readAccess,async c=>{
  const p=c.get("principal"),limit=Math.min(200,Math.max(1,Number(c.req.query("limit"))||50));
  const rows=await c.env.FINANCE_DB.prepare(`SELECT a.id,a.action,a.entity_type AS entityType,a.entity_id AS entityId,a.after,a.created_at AS createdAt,COALESCE(u.display_name,u.email,a.actor_id) AS actorName FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id WHERE a.organization_id=? AND (a.action LIKE 'hr.%' OR a.entity_type LIKE 'hr_%') ORDER BY a.created_at DESC LIMIT ?`).bind(p.organizationId,limit).all<any>();
  return c.json({data:rows.results.map(x=>({...x,after:x.after?JSON.parse(x.after):null}))});
});
humanResourcesAuditWorkflowRoutes.post("/leave-requests/:id/review",writeAccess,async c=>{
  const parsed=reviewSchema.safeParse(await c.req.json().catch(()=>({})));
  if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid leave review",parsed.error.flatten());
  const p=c.get("principal"),id=c.req.param("id"),status=parsed.data.decision==="approve"?"approved":"rejected";
  const before=await c.env.FINANCE_DB.prepare("SELECT id,employee_id AS employeeId,leave_type_id AS leaveTypeId,starts_on AS startsOn,ends_on AS endsOn,days_micros/1000000.0 AS days,reason,status FROM hr_leave_requests WHERE id=? AND organization_id=?").bind(id,p.organizationId).first<any>();
  if(!before)throw new AppError(404,"NOT_FOUND","Leave request not found");
  if(before.status!=="pending")throw new AppError(409,"INVALID_STATE","Only pending leave requests can be reviewed");
  const result=await c.env.FINANCE_DB.prepare("UPDATE hr_leave_requests SET status=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,review_notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND status='pending'").bind(status,p.userId,parsed.data.notes??null,id,p.organizationId).run();
  if(!result.meta.changes)throw new AppError(409,"INVALID_STATE","Leave request is no longer pending");
  const after={...before,status,reviewNotes:parsed.data.notes??null};
  await auditStatement(c.env.FINANCE_DB,{organizationId:p.organizationId,actorId:p.userId,action:status==="approved"?"hr.leave.approved":"hr.leave.rejected",entityType:"hr_leave_request",entityId:id,after}).run();
  return c.json({data:{id,status}});
});
