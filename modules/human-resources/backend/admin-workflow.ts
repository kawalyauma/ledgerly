import {Hono,type MiddlewareHandler} from "hono";
import {z} from "zod";
import type {AppVariables,Env} from "../../../src/types";
import {AppError} from "../../../src/lib/errors";
import {requireModuleEnabled} from "../../../src/lib/modules";
import {auditStatement} from "../../../src/services/audit";

const writeAccess:MiddlewareHandler<{Bindings:Env;Variables:AppVariables}>=async(c,next)=>{const p=c.get("principal");if(p.role==="owner"||p.role==="admin"||p.scopes.includes("hr:write")){await next();return}throw new AppError(403,"FORBIDDEN","Missing Human Resources write permission")};
const departmentPatch=z.object({code:z.string().trim().min(1).max(40).optional(),name:z.string().trim().min(1).max(120).optional(),managerEmployeeId:z.string().nullable().optional(),active:z.boolean().optional()});
const leaveTypePatch=z.object({code:z.string().trim().min(1).max(40).optional(),name:z.string().trim().min(1).max(120).optional(),paid:z.boolean().optional(),annualDays:z.number().min(0).max(366).optional(),active:z.boolean().optional()});

export const humanResourcesAdminWorkflowRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
humanResourcesAdminWorkflowRoutes.use("*",requireModuleEnabled("human-resources"));
humanResourcesAdminWorkflowRoutes.use("*",writeAccess);

async function ensureManager(db:D1Database,organizationId:string,id:string|null|undefined){if(!id)return;const row=await db.prepare("SELECT id FROM hr_employees WHERE id=? AND organization_id=?").bind(id,organizationId).first();if(!row)throw new AppError(422,"INVALID_MANAGER","Manager must be an HR employee in this organization")}

humanResourcesAdminWorkflowRoutes.patch("/departments/:id",async c=>{
  const parsed=departmentPatch.safeParse(await c.req.json().catch(()=>({})));
  if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid department changes",parsed.error.flatten());
  const data=parsed.data,entries=Object.entries(data);if(!entries.length)throw new AppError(422,"VALIDATION_ERROR","No department changes supplied");
  const p=c.get("principal"),id=c.req.param("id");await ensureManager(c.env.FINANCE_DB,p.organizationId,data.managerEmployeeId);
  const map:Record<string,string>={code:"code",name:"name",managerEmployeeId:"manager_employee_id",active:"active"};
  const values=entries.map(([key,value])=>key==="active"?(value?1:0):value??null);
  try{const result=await c.env.FINANCE_DB.prepare(`UPDATE hr_departments SET ${entries.map(([key])=>`${map[key]}=?`).join(",")},updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`).bind(...values,id,p.organizationId).run();if(!result.meta.changes)throw new AppError(404,"NOT_FOUND","HR department not found")}catch(e:any){if(String(e?.message||"").toLowerCase().includes("unique"))throw new AppError(409,"DUPLICATE_DEPARTMENT_CODE","Department code already exists");throw e}
  const row=await c.env.FINANCE_DB.prepare("SELECT id,code,name,manager_employee_id AS managerEmployeeId,active FROM hr_departments WHERE id=? AND organization_id=?").bind(id,p.organizationId).first();
  await auditStatement(c.env.FINANCE_DB,{organizationId:p.organizationId,actorId:p.userId,action:"hr.department.updated",entityType:"hr_department",entityId:id,after:row}).run();
  return c.json({data:row});
});

humanResourcesAdminWorkflowRoutes.patch("/leave-types/:id",async c=>{
  const parsed=leaveTypePatch.safeParse(await c.req.json().catch(()=>({})));
  if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid leave type changes",parsed.error.flatten());
  const data=parsed.data,entries=Object.entries(data);if(!entries.length)throw new AppError(422,"VALIDATION_ERROR","No leave type changes supplied");
  const p=c.get("principal"),id=c.req.param("id"),map:Record<string,string>={code:"code",name:"name",paid:"paid",annualDays:"annual_days_micros",active:"active"};
  const values=entries.map(([key,value])=>key==="paid"||key==="active"?(value?1:0):key==="annualDays"?Math.round(Number(value)*1e6):value);
  try{const result=await c.env.FINANCE_DB.prepare(`UPDATE hr_leave_types SET ${entries.map(([key])=>`${map[key]}=?`).join(",")},updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`).bind(...values,id,p.organizationId).run();if(!result.meta.changes)throw new AppError(404,"NOT_FOUND","Leave type not found")}catch(e:any){if(String(e?.message||"").toLowerCase().includes("unique"))throw new AppError(409,"DUPLICATE_LEAVE_TYPE_CODE","Leave type code already exists");throw e}
  const row=await c.env.FINANCE_DB.prepare("SELECT id,code,name,paid,annual_days_micros/1000000.0 AS annualDays,active FROM hr_leave_types WHERE id=? AND organization_id=?").bind(id,p.organizationId).first();
  await auditStatement(c.env.FINANCE_DB,{organizationId:p.organizationId,actorId:p.userId,action:"hr.leave_type.updated",entityType:"hr_leave_type",entityId:id,after:row}).run();
  return c.json({data:row});
});
