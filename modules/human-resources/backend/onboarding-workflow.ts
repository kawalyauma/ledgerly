import {Hono,type MiddlewareHandler} from "hono";
import {z} from "zod";
import type {AppVariables,Env} from "../../../src/types";
import {AppError} from "../../../src/lib/errors";
import {requireModuleEnabled} from "../../../src/lib/modules";
import {auditStatement} from "../../../src/services/audit";

const writeAccess:MiddlewareHandler<{Bindings:Env;Variables:AppVariables}>=async(c,next)=>{const p=c.get("principal");if(p.role==="owner"||p.role==="admin"||p.scopes.includes("hr:write")){await next();return}throw new AppError(403,"FORBIDDEN","Missing Human Resources write permission")};
const schema=z.object({status:z.enum(["pending","completed"])});

export const humanResourcesOnboardingWorkflowRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
humanResourcesOnboardingWorkflowRoutes.use("*",requireModuleEnabled("human-resources"));
humanResourcesOnboardingWorkflowRoutes.patch("/onboarding/:id/status",writeAccess,async c=>{
  const parsed=schema.safeParse(await c.req.json().catch(()=>({})));
  if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","status must be pending or completed",parsed.error.flatten());
  const p=c.get("principal"),status=parsed.data.status,id=c.req.param("id");
  const result=await c.env.FINANCE_DB.prepare(`UPDATE hr_onboarding_tasks SET status=?,completed_at=CASE WHEN ?='completed' THEN COALESCE(completed_at,CURRENT_TIMESTAMP) ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`).bind(status,status,id,p.organizationId).run();
  if(!result.meta.changes)throw new AppError(404,"NOT_FOUND","Onboarding task not found");
  const row=await c.env.FINANCE_DB.prepare("SELECT t.*,e.employee_number FROM hr_onboarding_tasks t JOIN hr_employees e ON e.id=t.employee_id WHERE t.id=? AND t.organization_id=?").bind(id,p.organizationId).first();
  await auditStatement(c.env.FINANCE_DB,{organizationId:p.organizationId,actorId:p.userId,action:status==="completed"?"hr.onboarding.completed":"hr.onboarding.reopened",entityType:"hr_onboarding_task",entityId:id,after:row}).run();
  return c.json({data:row});
});
