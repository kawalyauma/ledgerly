import {Hono} from "hono";
import {z} from "zod";
import type {AppVariables,Env} from "../../../src/types";
import {requireScope} from "../../../src/lib/auth";
import {requireModuleEnabled} from "../../../src/lib/modules";
import {AppError} from "../../../src/lib/errors";
import {createId} from "../../../src/lib/ids";
import {auditStatement} from "../../../src/services/audit";
import {createPayment,postPayment} from "../../../src/services/payments";

export const payrollWorkflowRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
payrollWorkflowRoutes.use("*",requireModuleEnabled("payroll-payments"));

payrollWorkflowRoutes.get("/runs/:id/lines",requireScope("payroll:read"),async c=>{
  const p=c.get("principal"),id=c.req.param("id");
  const run=await c.env.FINANCE_DB.prepare(`SELECT id,number,period_start AS periodStart,period_end AS periodEnd,pay_date AS payDate,status,currency,gross_minor AS grossMinor,deductions_minor AS deductionsMinor,employer_costs_minor AS employerCostsMinor,net_minor AS netMinor,journal_entry_id AS journalEntryId,payment_batch_id AS paymentBatchId FROM payroll_runs WHERE id=? AND organization_id=?`).bind(id,p.organizationId).first<any>();
  if(!run)throw new AppError(404,"NOT_FOUND","Payroll run not found");
  const rows=await c.env.FINANCE_DB.prepare(`SELECT l.id,l.employee_id AS employeeId,e.employee_number AS employeeNumber,ct.name,ct.email,l.gross_minor AS grossMinor,l.deductions_minor AS deductionsMinor,l.employer_costs_minor AS employerCostsMinor,l.net_minor AS netMinor,l.paid_minor AS paidMinor,l.balance_minor AS balanceMinor,l.payment_status AS paymentStatus,l.components,sp.payable_account_id AS staffPayableAccountId,sp.id AS schoolStaffId FROM payroll_lines l JOIN employees e ON e.id=l.employee_id AND e.organization_id=l.organization_id JOIN contacts ct ON ct.id=e.contact_id AND ct.organization_id=e.organization_id LEFT JOIN school_staff_profiles sp ON sp.organization_id=l.organization_id AND sp.payroll_employee_id=l.employee_id AND sp.deleted_at IS NULL WHERE l.organization_id=? AND l.payroll_run_id=? ORDER BY e.employee_number`).bind(p.organizationId,id).all<any>();
  return c.json({data:{run,lines:rows.results.map(x=>({...x,components:JSON.parse(x.components||"[]")}))}});
});

payrollWorkflowRoutes.get("/payment-batches",requireScope("payroll:read"),async c=>{
  const p=c.get("principal"),runId=c.req.query("runId");
  const rows=await c.env.FINANCE_DB.prepare(`SELECT b.id,b.payroll_run_id AS payrollRunId,b.number,b.status,b.bank_account_id AS bankAccountId,b.payment_date AS paymentDate,b.total_minor AS totalMinor,b.items,b.approved_by AS approvedBy,b.processed_at AS processedAt,b.created_at AS createdAt,r.number AS payrollNumber,r.currency FROM payroll_payment_batches b JOIN payroll_runs r ON r.id=b.payroll_run_id AND r.organization_id=b.organization_id WHERE b.organization_id=? ${runId?"AND b.payroll_run_id=?":""} ORDER BY b.payment_date DESC,b.created_at DESC`).bind(p.organizationId,...(runId?[runId]:[])).all<any>();
  return c.json({data:rows.results.map(x=>({...x,items:JSON.parse(x.items||"[]")}))});
});

payrollWorkflowRoutes.post("/payment-batches/:id/approve",requireScope("payroll:write"),async c=>{
  const p=c.get("principal"),id=c.req.param("id");
  const result=await c.env.FINANCE_DB.prepare("UPDATE payroll_payment_batches SET status='approved',approved_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND status='draft'").bind(p.userId,id,p.organizationId).run();
  if(!result.meta.changes)throw new AppError(409,"INVALID_STATE","Draft salary payment batch not found");
  await auditStatement(c.env.FINANCE_DB,{organizationId:p.organizationId,actorId:p.userId,action:"payroll.payment_batch.approved",entityType:"payroll_payment_batch",entityId:id}).run();
  return c.json({data:{id,status:"approved"}});
});

const processBatchSchema=z.object({generalNetPayableAccountId:z.string().optional()});
payrollWorkflowRoutes.post("/payment-batches/:id/process",requireScope("payroll:write"),async c=>{
  const parsed=processBatchSchema.safeParse(await c.req.json().catch(()=>({})));if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid salary payment batch processing request",parsed.error.flatten());
  const p=c.get("principal"),batchId=c.req.param("id"),db=c.env.FINANCE_DB;
  const batch=await db.prepare(`SELECT b.id,b.number,b.status,b.bank_account_id AS bankAccountId,b.payment_date AS paymentDate,b.payroll_run_id AS payrollRunId,r.currency FROM payroll_payment_batches b JOIN payroll_runs r ON r.id=b.payroll_run_id AND r.organization_id=b.organization_id WHERE b.id=? AND b.organization_id=?`).bind(batchId,p.organizationId).first<any>();
  if(!batch)throw new AppError(404,"NOT_FOUND","Salary payment batch not found");
  if(batch.status==="processed")return c.json({data:{id:batchId,status:"processed",alreadyProcessed:true}});
  if(batch.status!=="approved")throw new AppError(409,"INVALID_STATE","Approve the salary payment batch before processing it");
  if(!batch.bankAccountId)throw new AppError(422,"BANK_ACCOUNT_REQUIRED","A cash/bank posting account is required on the salary payment batch");
  const lines=await db.prepare(`SELECT l.id AS payrollLineId,l.employee_id AS employeeId,l.net_minor AS netMinor,l.paid_minor AS paidMinor,l.balance_minor AS balanceMinor,e.employee_number AS employeeNumber,e.contact_id AS contactId,sp.id AS schoolStaffId,sp.payable_account_id AS staffPayableAccountId FROM payroll_lines l JOIN employees e ON e.id=l.employee_id AND e.organization_id=l.organization_id LEFT JOIN school_staff_profiles sp ON sp.organization_id=l.organization_id AND sp.payroll_employee_id=l.employee_id AND sp.deleted_at IS NULL WHERE l.organization_id=? AND l.payroll_run_id=? ORDER BY e.employee_number`).bind(p.organizationId,batch.payrollRunId).all<any>();
  const unpaid=lines.results.filter(x=>Number(x.balanceMinor??(Number(x.netMinor)-Number(x.paidMinor||0)))>0);
  if(unpaid.some(x=>!x.staffPayableAccountId)&&!parsed.data.generalNetPayableAccountId)throw new AppError(422,"NET_PAYABLE_ACCOUNT_REQUIRED","Choose a general salary payable account because one or more payroll employees do not have individual staff payable accounts");
  const processed:any[]=[];
  for(const line of unpaid){
    const amount=Number(line.balanceMinor??(Number(line.netMinor)-Number(line.paidMinor||0)));if(amount<=0)continue;
    const number=`${batch.number}-${line.employeeNumber}`.slice(0,60),controlAccountId=line.staffPayableAccountId||parsed.data.generalNetPayableAccountId!;
    const payment=await createPayment(db,p.organizationId,p.userId,{type:"payment",number,contactId:line.contactId,bankAccountId:batch.bankAccountId,controlAccountId,paymentDate:batch.paymentDate,currency:batch.currency,amountMinor:amount,reference:`Payroll ${batch.number}`},`payroll-batch:${batchId}:${line.payrollLineId}`) as any;
    const posted=await postPayment(db,p.organizationId,p.userId,String(payment.id),[]);
    await db.prepare("UPDATE payroll_lines SET paid_minor=MIN(net_minor,paid_minor+?),balance_minor=MAX(0,net_minor-(paid_minor+?)),payment_status=CASE WHEN paid_minor+?>=net_minor THEN 'paid' ELSE 'partially_paid' END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(amount,amount,amount,line.payrollLineId,p.organizationId).run();
    if(line.schoolStaffId)await db.prepare(`INSERT OR IGNORE INTO school_staff_salary_payments(id,organization_id,staff_id,payroll_line_id,payment_id,amount_minor,payment_date,status,created_by) VALUES (?,?,?,?,?,?,?,'posted',?)`).bind(createId("ssp"),p.organizationId,line.schoolStaffId,line.payrollLineId,payment.id,amount,batch.paymentDate,p.userId).run();
    processed.push({employeeId:line.employeeId,paymentId:payment.id,journalEntryId:(posted as any).journalEntryId,amountMinor:amount});
  }
  const remaining=await db.prepare("SELECT COALESCE(SUM(balance_minor),0) AS amount FROM payroll_lines WHERE organization_id=? AND payroll_run_id=?").bind(p.organizationId,batch.payrollRunId).first<any>();
  if(Number(remaining?.amount||0)===0)await db.prepare("UPDATE payroll_payment_batches SET status='processed',processed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(batchId,p.organizationId).run();
  await auditStatement(db,{organizationId:p.organizationId,actorId:p.userId,action:"payroll.payment_batch.processed",entityType:"payroll_payment_batch",entityId:batchId,after:{payments:processed.length,remainingMinor:Number(remaining?.amount||0)}}).run();
  return c.json({data:{id:batchId,status:Number(remaining?.amount||0)===0?"processed":"approved",payments:processed,remainingMinor:Number(remaining?.amount||0)}});
});

const componentPatch=z.object({code:z.string().min(1).max(40).optional(),name:z.string().min(1).max(100).optional(),type:z.enum(["earning","deduction","employer_cost"]).optional(),calculationType:z.enum(["fixed","percentage","input"]).optional(),rateMicros:z.number().int().nonnegative().nullable().optional(),amountMinor:z.number().int().nonnegative().nullable().optional(),taxable:z.boolean().optional(),pensionable:z.boolean().optional(),statutory:z.boolean().optional(),employerRateMicros:z.number().int().nonnegative().optional(),active:z.boolean().optional()});
payrollWorkflowRoutes.patch("/components/:id",requireScope("payroll:write"),async c=>{
  const s=componentPatch.safeParse(await c.req.json().catch(()=>({})));if(!s.success)throw new AppError(422,"VALIDATION_ERROR","Invalid payroll component changes",s.error.flatten());const entries=Object.entries(s.data);if(!entries.length)throw new AppError(422,"VALIDATION_ERROR","No payroll component changes supplied");const p=c.get("principal"),map:Record<string,string>={code:"code",name:"name",type:"type",calculationType:"calculation_type",rateMicros:"rate_micros",amountMinor:"amount_minor",taxable:"taxable",pensionable:"pensionable",statutory:"statutory",employerRateMicros:"employer_rate_micros",active:"active"};const vals=entries.map(([k,v])=>["taxable","pensionable","statutory","active"].includes(k)?(v?1:0):v??null);const r=await c.env.FINANCE_DB.prepare(`UPDATE payroll_components SET ${entries.map(([k])=>`${map[k]}=?`).join(",")},updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`).bind(...vals,c.req.param("id"),p.organizationId).run();if(!r.meta.changes)throw new AppError(404,"NOT_FOUND","Payroll component not found");return c.json({data:{id:c.req.param("id"),...s.data}});
});

const rulePatch=z.object({name:z.string().min(1).optional(),effectiveTo:z.string().nullable().optional(),status:z.enum(["draft","active","archived"]).optional()});
payrollWorkflowRoutes.patch("/rules/:id",requireScope("payroll:write"),async c=>{
  const s=rulePatch.safeParse(await c.req.json().catch(()=>({})));if(!s.success)throw new AppError(422,"VALIDATION_ERROR","Invalid statutory rule changes",s.error.flatten());const entries=Object.entries(s.data);if(!entries.length)throw new AppError(422,"VALIDATION_ERROR","No statutory rule changes supplied");const p=c.get("principal"),map:Record<string,string>={name:"name",effectiveTo:"effective_to",status:"status"};const r=await c.env.FINANCE_DB.prepare(`UPDATE payroll_rules SET ${entries.map(([k])=>`${map[k]}=?`).join(",")},updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`).bind(...entries.map(([,v])=>v??null),c.req.param("id"),p.organizationId).run();if(!r.meta.changes)throw new AppError(404,"NOT_FOUND","Payroll statutory rule not found");return c.json({data:{id:c.req.param("id"),...s.data}});
});

export const paymentsWorkflowRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
paymentsWorkflowRoutes.use("*",requireModuleEnabled("payroll-payments"));
paymentsWorkflowRoutes.get("/counterparties/:contactId/open-documents",requireScope("payments:read"),async c=>{
  const p=c.get("principal"),contactId=c.req.param("contactId"),type=c.req.query("paymentType")==="receipt"?"invoice":"bill";
  const rows=await c.env.FINANCE_DB.prepare(`SELECT id,type,number,issue_date AS issueDate,due_date AS dueDate,currency,total_minor AS totalMinor,paid_minor AS paidMinor,(total_minor-paid_minor) AS outstandingMinor,status FROM documents WHERE organization_id=? AND contact_id=? AND type=? AND status IN ('open','partially_paid') AND total_minor>paid_minor ORDER BY due_date,issue_date,number`).bind(p.organizationId,contactId,type).all();
  return c.json({data:rows.results});
});
