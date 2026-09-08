import {Hono} from "hono";
import {z} from "zod";
import type {AppVariables,Env} from "../../../src/types";
import {requireScope} from "../../../src/lib/auth";
import {requireModuleEnabled} from "../../../src/lib/modules";
import {AppError} from "../../../src/lib/errors";
import {reverseJournal} from "../../../src/services/ledger";
import {auditStatement} from "../../../src/services/audit";

export const payrollRunReversalIntegrityRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
payrollRunReversalIntegrityRoutes.use("*",requireModuleEnabled("payroll-payments"));
const schema=z.object({postingDate:z.iso.date(),reason:z.string().trim().min(3).max(500)});
payrollRunReversalIntegrityRoutes.post("/runs/:id/reverse-safe",requireScope("payroll:write"),async c=>{
  const parsed=schema.safeParse(await c.req.json().catch(()=>({})));if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","A posting date and reason are required",parsed.error.flatten());
  const p=c.get("principal"),id=c.req.param("id"),db=c.env.FINANCE_DB;
  const run=await db.prepare("SELECT journal_entry_id AS journalId,status,number FROM payroll_runs WHERE id=? AND organization_id=?").bind(id,p.organizationId).first<any>();
  if(!run||run.status!=="posted"||!run.journalId)throw new AppError(409,"INVALID_STATE","Posted payroll run not found");
  const paid=await db.prepare("SELECT COALESCE(SUM(paid_minor),0) AS amount,COUNT(CASE WHEN paid_minor>0 THEN 1 END) AS lines FROM payroll_lines WHERE payroll_run_id=? AND organization_id=?").bind(id,p.organizationId).first<any>();
  if(Number(paid?.amount||0)>0)throw new AppError(409,"PAYROLL_HAS_SALARY_PAYMENTS","Reverse all salary payments for this payroll run before reversing the payroll itself.",{paidMinor:Number(paid.amount||0),paidLines:Number(paid.lines||0)});
  const reversed=await reverseJournal(db,p.organizationId,p.userId,run.journalId,parsed.data.postingDate,parsed.data.reason);
  await db.batch([db.prepare("UPDATE payroll_runs SET status='reversed',reversal_run_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND status='posted'").bind(reversed.id,id,p.organizationId),auditStatement(db,{organizationId:p.organizationId,actorId:p.userId,action:"payroll.reversed",entityType:"payroll_run",entityId:id,after:{reversalJournalId:reversed.id,reason:parsed.data.reason}})]);
  return c.json({data:{id,status:"reversed",reversalJournalId:reversed.id}});
});
