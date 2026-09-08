import {Hono} from "hono";
import {z} from "zod";
import type {AppVariables,Env} from "../../../src/types";
import {requireScope} from "../../../src/lib/auth";
import {requireModuleEnabled} from "../../../src/lib/modules";
import {AppError} from "../../../src/lib/errors";
import {createId} from "../../../src/lib/ids";
import {auditStatement} from "../../../src/services/audit";
import {createPayment,postPayment,reversePayment} from "../../../src/services/payments";

export const payrollSalaryIntegrityRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
payrollSalaryIntegrityRoutes.use("*",requireModuleEnabled("payroll-payments"));
const processSchema=z.object({generalNetPayableAccountId:z.string().optional()});
payrollSalaryIntegrityRoutes.post("/payment-batches/:id/process-safe",requireScope("payroll:write"),async c=>{
  const parsed=processSchema.safeParse(await c.req.json().catch(()=>({})));if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid salary payment batch processing request",parsed.error.flatten());
  const p=c.get("principal"),db=c.env.FINANCE_DB,batchId=c.req.param("id");
  const batch=await db.prepare(`SELECT b.id,b.number,b.status,b.bank_account_id AS bankAccountId,b.payment_date AS paymentDate,b.payroll_run_id AS payrollRunId,b.items,r.currency FROM payroll_payment_batches b JOIN payroll_runs r ON r.id=b.payroll_run_id AND r.organization_id=b.organization_id WHERE b.id=? AND b.organization_id=?`).bind(batchId,p.organizationId).first<any>();
  if(!batch)throw new AppError(404,"NOT_FOUND","Salary payment batch not found");
  if(batch.status==="processed")return c.json({data:{id:batchId,status:"processed",alreadyProcessed:true}});
  if(batch.status!=="approved")throw new AppError(409,"INVALID_STATE","Approve the salary payment batch before processing it");
  if(!batch.bankAccountId)throw new AppError(422,"BANK_ACCOUNT_REQUIRED","A cash/bank posting account is required on the salary payment batch");
  const lines=await db.prepare(`SELECT l.id AS payrollLineId,l.employee_id AS employeeId,l.net_minor AS netMinor,l.paid_minor AS paidMinor,l.balance_minor AS balanceMinor,e.employee_number AS employeeNumber,e.contact_id AS contactId,sp.id AS schoolStaffId,sp.payable_account_id AS staffPayableAccountId FROM payroll_lines l JOIN employees e ON e.id=l.employee_id AND e.organization_id=l.organization_id LEFT JOIN school_staff_profiles sp ON sp.organization_id=l.organization_id AND sp.payroll_employee_id=l.employee_id AND sp.deleted_at IS NULL WHERE l.organization_id=? AND l.payroll_run_id=? ORDER BY e.employee_number`).bind(p.organizationId,batch.payrollRunId).all<any>();
  const unpaid=lines.results.filter(x=>Number(x.balanceMinor??(Number(x.netMinor)-Number(x.paidMinor||0)))>0);
  if(unpaid.some(x=>!x.staffPayableAccountId)&&!parsed.data.generalNetPayableAccountId)throw new AppError(422,"NET_PAYABLE_ACCOUNT_REQUIRED","Choose a general salary payable account because one or more payroll employees do not have individual staff payable accounts");
  let items:any[]=[];try{items=JSON.parse(batch.items||"[]");if(!Array.isArray(items))items=[]}catch{items=[]}
  const processed:any[]=[];
  for(const line of unpaid){
    const amount=Number(line.balanceMinor??(Number(line.netMinor)-Number(line.paidMinor||0)));if(amount<=0)continue;
    const number=`${batch.number}-${line.employeeNumber}`.slice(0,60),controlAccountId=line.staffPayableAccountId||parsed.data.generalNetPayableAccountId!;
    const payment=await createPayment(db,p.organizationId,p.userId,{type:"payment",number,contactId:line.contactId,bankAccountId:batch.bankAccountId,controlAccountId,paymentDate:batch.paymentDate,currency:batch.currency,amountMinor:amount,reference:`Payroll ${batch.number}`},`payroll-batch:${batchId}:${line.payrollLineId}`) as any;
    const posted=await postPayment(db,p.organizationId,p.userId,String(payment.id),[]);
    await db.prepare("UPDATE payroll_lines SET paid_minor=MIN(net_minor,paid_minor+?),balance_minor=MAX(0,net_minor-(paid_minor+?)),payment_status=CASE WHEN paid_minor+?>=net_minor THEN 'paid' ELSE 'partially_paid' END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(amount,amount,amount,line.payrollLineId,p.organizationId).run();
    if(line.schoolStaffId)await db.prepare(`INSERT OR IGNORE INTO school_staff_salary_payments(id,organization_id,staff_id,payroll_line_id,payment_id,amount_minor,payment_date,status,created_by) VALUES (?,?,?,?,?,?,?,'posted',?)`).bind(createId("ssp"),p.organizationId,line.schoolStaffId,line.payrollLineId,payment.id,amount,batch.paymentDate,p.userId).run();
    const mapped={employeeId:line.employeeId,payrollLineId:line.payrollLineId,amountMinor:amount,paymentId:String(payment.id),journalEntryId:(posted as any).journalEntryId,paymentStatus:"posted"};
    const index=items.findIndex(x=>x?.employeeId===line.employeeId);if(index>=0)items[index]={...items[index],...mapped,reversedAt:null};else items.push(mapped);processed.push(mapped);
  }
  const remaining=await db.prepare("SELECT COALESCE(SUM(balance_minor),0) AS amount FROM payroll_lines WHERE organization_id=? AND payroll_run_id=?").bind(p.organizationId,batch.payrollRunId).first<any>(),done=Number(remaining?.amount||0)===0;
  await db.prepare("UPDATE payroll_payment_batches SET items=?,status=?,processed_at=CASE WHEN ?='processed' THEN COALESCE(processed_at,CURRENT_TIMESTAMP) ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(JSON.stringify(items),done?"processed":"approved",done?"processed":"approved",batchId,p.organizationId).run();
  await auditStatement(db,{organizationId:p.organizationId,actorId:p.userId,action:"payroll.payment_batch.processed",entityType:"payroll_payment_batch",entityId:batchId,after:{payments:processed.length,remainingMinor:Number(remaining?.amount||0)}}).run();
  return c.json({data:{id:batchId,status:done?"processed":"approved",payments:processed,remainingMinor:Number(remaining?.amount||0)}});
});

export const paymentsSalaryIntegrityRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
paymentsSalaryIntegrityRoutes.use("*",requireModuleEnabled("payroll-payments"));
const reverseSchema=z.object({postingDate:z.iso.date(),reason:z.string().trim().min(3).max(500)});
paymentsSalaryIntegrityRoutes.post("/:id/reverse-safe",requireScope("payments:write"),async c=>{
  const parsed=reverseSchema.safeParse(await c.req.json().catch(()=>({})));if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","A posting date and reason are required",parsed.error.flatten());
  const p=c.get("principal"),db=c.env.FINANCE_DB,paymentId=c.req.param("id");
  const schoolRecord=await db.prepare("SELECT id,payroll_line_id AS lineId,amount_minor AS amountMinor,status FROM school_staff_salary_payments WHERE organization_id=? AND payment_id=? LIMIT 1").bind(p.organizationId,paymentId).first<any>();
  let batchId:string|undefined,lineId:string|undefined,amountMinor:number|undefined,batchItems:any[]|undefined;
  const candidates=await db.prepare("SELECT id,items FROM payroll_payment_batches WHERE organization_id=? AND items LIKE ? ORDER BY created_at DESC LIMIT 20").bind(p.organizationId,`%${paymentId}%`).all<any>();
  for(const row of candidates.results){let items:any[]=[];try{items=JSON.parse(row.items||"[]")}catch{}const item=Array.isArray(items)?items.find(x=>String(x?.paymentId||"")===paymentId):undefined;if(item){batchId=row.id;lineId=String(item.payrollLineId||"")||undefined;amountMinor=Number(item.amountMinor||0)||undefined;batchItems=items;break}}
  if(schoolRecord?.lineId){lineId=String(schoolRecord.lineId);amountMinor=Number(schoolRecord.amountMinor||0)}
  const reversed=await reversePayment(db,p.organizationId,p.userId,paymentId,parsed.data.postingDate,parsed.data.reason);
  let paidMinor:number|undefined,balanceMinor:number|undefined,paymentStatus:string|undefined;
  if(lineId&&amountMinor){const line=await db.prepare("SELECT net_minor AS netMinor,paid_minor AS paidMinor FROM payroll_lines WHERE id=? AND organization_id=?").bind(lineId,p.organizationId).first<any>();if(line){paidMinor=Math.max(0,Number(line.paidMinor||0)-amountMinor);balanceMinor=Math.max(0,Number(line.netMinor||0)-paidMinor);paymentStatus=paidMinor===0?"unpaid":balanceMinor===0?"paid":"partially_paid";await db.prepare("UPDATE payroll_lines SET paid_minor=?,balance_minor=?,payment_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(paidMinor,balanceMinor,paymentStatus,lineId,p.organizationId).run()}}
  if(schoolRecord?.id&&schoolRecord.status==="posted")await db.prepare("UPDATE school_staff_salary_payments SET status='reversed',reversed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(schoolRecord.id,p.organizationId).run();
  if(batchId&&batchItems){const now=new Date().toISOString(),items=batchItems.map(x=>String(x?.paymentId||"")===paymentId?{...x,paymentStatus:"reversed",reversedAt:now}:x);await db.prepare("UPDATE payroll_payment_batches SET items=?,status='approved',processed_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(JSON.stringify(items),batchId,p.organizationId).run()}
  if(lineId)await auditStatement(db,{organizationId:p.organizationId,actorId:p.userId,action:"payroll.salary_payment.reversed",entityType:"payroll_line",entityId:lineId,after:{paymentId,amountMinor,batchId,reason:parsed.data.reason}}).run();
  return c.json({data:{...reversed,payrollLineId:lineId,paidMinor,balanceMinor,paymentStatus,batchId}});
});
