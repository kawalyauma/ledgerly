import {Hono} from "hono";
import {z} from "zod";
import type {AppVariables,Env} from "../../../src/types";
import {requireScope} from "../../../src/lib/auth";
import {requireModuleEnabled} from "../../../src/lib/modules";
import {AppError} from "../../../src/lib/errors";
import {auditStatement} from "../../../src/services/audit";

export const payrollStatutoryRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
payrollStatutoryRoutes.use("*",requireModuleEnabled("payroll-payments"));
payrollStatutoryRoutes.get("/statutory-returns",requireScope("payroll:read"),async c=>{
  const p=c.get("principal"),year=c.req.query("year"),rows=await c.env.FINANCE_DB.prepare(`SELECT s.id,s.payroll_run_id AS payrollRunId,s.year,s.period,s.authority,s.type,s.status,s.amount_minor AS amountMinor,s.payload,s.filed_at AS filedAt,s.created_at AS createdAt,r.number AS payrollNumber,r.currency FROM payroll_statutory_returns s LEFT JOIN payroll_runs r ON r.id=s.payroll_run_id AND r.organization_id=s.organization_id WHERE s.organization_id=? ${year?"AND s.year=?":""} ORDER BY s.year DESC,s.period DESC,s.created_at DESC`).bind(p.organizationId,...(year?[Number(year)]:[])).all<any>();
  return c.json({data:rows.results.map(x=>({...x,payload:JSON.parse(x.payload||"{}")}))});
});
const statusSchema=z.object({status:z.enum(["draft","filed"])});
payrollStatutoryRoutes.patch("/statutory-returns/:id/status",requireScope("payroll:write"),async c=>{
  const s=statusSchema.safeParse(await c.req.json().catch(()=>({})));if(!s.success)throw new AppError(422,"VALIDATION_ERROR","Status must be draft or filed",s.error.flatten());const p=c.get("principal"),id=c.req.param("id");
  const r=await c.env.FINANCE_DB.prepare("UPDATE payroll_statutory_returns SET status=?,filed_at=CASE WHEN ?='filed' THEN COALESCE(filed_at,CURRENT_TIMESTAMP) ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(s.data.status,s.data.status,id,p.organizationId).run();if(!r.meta.changes)throw new AppError(404,"NOT_FOUND","Statutory return not found");
  await auditStatement(c.env.FINANCE_DB,{organizationId:p.organizationId,actorId:p.userId,action:`payroll.statutory_return.${s.data.status}`,entityType:"payroll_statutory_return",entityId:id}).run();return c.json({data:{id,status:s.data.status}});
});
