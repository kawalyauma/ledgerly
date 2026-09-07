import { AppError } from "../lib/errors";
import { createId } from "../lib/ids";
import { auditStatement } from "./audit";
import { reverseDocument } from "./documents";
import { reverseJournal } from "./ledger";
import { reversePayment } from "./payments";

type Impact = { type: string; id: string; label: string; status?: string; action: string };
type Preview = {
  journal: { id: string; entryNumber?: string; description?: string; sourceType?: string | null; sourceId?: string | null; status: string };
  impacts: Impact[];
  blockers: string[];
  mode: "payroll" | "school_fee_receipt" | "school_fee_charge" | "payment" | "document" | "journal" | "unsupported";
};

async function journalInfo(db:D1Database,org:string,journalId:string){
  const row=await db.prepare(`SELECT id,entry_number AS entryNumber,description,source_type AS sourceType,source_id AS sourceId,status
    FROM journal_entries WHERE id=? AND organization_id=?`).bind(journalId,org).first<any>();
  if(!row)throw new AppError(404,"NOT_FOUND","Journal not found");
  return row;
}

async function payrollLink(db:D1Database,org:string,journalId:string){
  return db.prepare(`SELECT id,number,status,payment_batch_id AS paymentBatchId
    FROM payroll_runs WHERE organization_id=? AND journal_entry_id=?`).bind(org,journalId).first<any>();
}
async function paymentLink(db:D1Database,org:string,journalId:string){
  return db.prepare(`SELECT id,number,type,status FROM payments WHERE organization_id=? AND journal_entry_id=?`).bind(org,journalId).first<any>();
}
async function receiptLink(db:D1Database,org:string,paymentId:string){
  return db.prepare(`SELECT id,receipt_number AS receiptNumber,status,student_id AS studentId,amount_minor AS amountMinor
    FROM school_fee_receipts WHERE organization_id=? AND payment_id=?`).bind(org,paymentId).first<any>();
}
async function documentLink(db:D1Database,org:string,journalId:string){
  return db.prepare(`SELECT id,number,type,status,paid_minor AS paidMinor FROM documents
    WHERE organization_id=? AND journal_entry_id=?`).bind(org,journalId).first<any>();
}
async function chargeLink(db:D1Database,org:string,documentId:string){
  return db.prepare(`SELECT c.id,c.status,c.description,c.document_id AS documentId
    FROM school_student_fee_charges c WHERE c.organization_id=? AND c.document_id=?`).bind(org,documentId).first<any>();
}

export async function previewCrossModuleReversal(db:D1Database,org:string,journalId:string):Promise<Preview>{
  const journal=await journalInfo(db,org,journalId);
  const impacts:Impact[]=[{type:"journal",id:journal.id,label:`Journal ${journal.entryNumber||journal.id} · ${journal.description||"Accounting entry"}`,status:journal.status,action:"Create an equal-and-opposite reversal journal and mark the original reversed"}];
  const blockers:string[]=[];
  if(journal.status!=="posted")blockers.push(`The journal is ${journal.status}; only posted journals can be reversed.`);

  const payroll=await payrollLink(db,org,journalId);
  if(payroll){
    impacts.unshift({type:"payroll_run",id:payroll.id,label:`Payroll ${payroll.number}`,status:payroll.status,action:"Mark payroll run reversed and link it to the reversal journal"});
    if(payroll.status!=="posted")blockers.push(`Payroll ${payroll.number} is ${payroll.status}, not posted.`);
    if(payroll.paymentBatchId)blockers.push(`Payroll ${payroll.number} already has payment batch ${payroll.paymentBatchId}. Reverse/cancel the payroll payment batch first so paid salaries are not left inconsistent.`);
    return{journal,impacts,blockers,mode:"payroll"};
  }

  const payment=await paymentLink(db,org,journalId);
  if(payment){
    const receipt=await receiptLink(db,org,payment.id);
    if(receipt){
      impacts.unshift(
        {type:"school_fee_receipt",id:receipt.id,label:`School fee receipt ${receipt.receiptNumber}`,status:receipt.status,action:"Mark receipt reversed and roll back installment allocations"},
        {type:"payment",id:payment.id,label:`Ledgerly ${payment.type} ${payment.number}`,status:payment.status,action:"Reverse payment and all active document allocations"}
      );
      const allocation=await db.prepare("SELECT COUNT(*) AS n FROM payment_allocations WHERE organization_id=? AND payment_id=? AND reversed_at IS NULL").bind(org,payment.id).first<any>();
      const installments=await db.prepare("SELECT COUNT(*) AS n FROM school_fee_installment_allocations WHERE organization_id=? AND receipt_id=? AND reversed_at IS NULL").bind(org,receipt.id).first<any>();
      if(Number(allocation?.n||0))impacts.push({type:"payment_allocations",id:payment.id,label:`${Number(allocation.n)} active fee allocation(s)`,action:"Mark allocations reversed so invoice balances reopen"});
      if(Number(installments?.n||0))impacts.push({type:"fee_installments",id:receipt.id,label:`${Number(installments.n)} payment-plan allocation(s)`,action:"Reduce installment paid amounts and reopen affected payment plans"});
      if(receipt.status!=="posted")blockers.push(`School fee receipt ${receipt.receiptNumber} is ${receipt.status}, not posted.`);
      return{journal,impacts,blockers,mode:"school_fee_receipt"};
    }
    impacts.unshift({type:"payment",id:payment.id,label:`${payment.type==="receipt"?"Receipt":"Payment"} ${payment.number}`,status:payment.status,action:"Reverse payment and all active document allocations"});
    if(payment.status!=="posted")blockers.push(`Payment ${payment.number} is ${payment.status}, not posted.`);
    return{journal,impacts,blockers,mode:"payment"};
  }

  const document=await documentLink(db,org,journalId);
  if(document){
    const charge=await chargeLink(db,org,document.id);
    if(charge){
      impacts.unshift(
        {type:"school_fee_charge",id:charge.id,label:`School fee charge · ${charge.description||document.number}`,status:charge.status,action:"Cancel the fee charge, release its billing guard and create a fee-reversal record"},
        {type:"document",id:document.id,label:`School fee invoice ${document.number}`,status:document.status,action:"Void the Ledgerly invoice"}
      );
      const settlements=await db.prepare(`SELECT
        (SELECT COALESCE(SUM(pa.amount_minor),0) FROM payment_allocations pa WHERE pa.organization_id=? AND pa.document_id=? AND pa.reversed_at IS NULL) AS paymentMinor,
        (SELECT COALESCE(SUM(amount_minor),0) FROM school_fee_credits WHERE organization_id=? AND charge_id=? AND status='posted') AS creditMinor,
        (SELECT COALESCE(SUM(amount_minor),0) FROM school_fee_writeoffs WHERE organization_id=? AND charge_id=? AND status='posted') AS writeoffMinor`).bind(org,document.id,org,charge.id,org,charge.id).first<any>();
      if(Number(settlements?.paymentMinor||0)>0)blockers.push("This school-fee invoice has allocated payments. Reverse those receipts first.");
      if(Number(settlements?.creditMinor||0)>0)blockers.push("This school-fee charge has posted credits. Reverse the credits first.");
      if(Number(settlements?.writeoffMinor||0)>0)blockers.push("This school-fee charge has posted write-offs. Reverse the write-offs first.");
      const adjustments=await db.prepare("SELECT COUNT(*) AS n FROM school_fee_charge_adjustments WHERE organization_id=? AND charge_id=? AND journal_entry_id IS NOT NULL").bind(org,charge.id).first<any>();
      if(Number(adjustments?.n||0))impacts.push({type:"fee_adjustments",id:charge.id,label:`${Number(adjustments.n)} fee-adjustment journal(s)`,action:"Reverse any still-posted adjustment journals"});
      return{journal,impacts,blockers,mode:"school_fee_charge"};
    }
    impacts.unshift({type:"document",id:document.id,label:`${String(document.type).replaceAll("_"," ")} ${document.number}`,status:document.status,action:"Void the source document"});
    if(Number(document.paidMinor||0)!==0)blockers.push(`Document ${document.number} has payments. Reverse allocated payments first.`);
    return{journal,impacts,blockers,mode:"document"};
  }

  const safeDirect=new Set(["","manual","journal","general_journal","opening_balance"]);
  const sourceType=String(journal.sourceType||"");
  if(!safeDirect.has(sourceType)){
    blockers.push(`This entry was created by “${sourceType}”. Ledgerly will not reverse only the accounting journal because that could leave the source module inconsistent. Reverse the source transaction until an orchestrator is registered for this source type.`);
    return{journal,impacts,blockers,mode:"unsupported"};
  }
  return{journal,impacts,blockers,mode:"journal"};
}

async function reverseInstallmentReceipt(db:D1Database,org:string,receiptId:string){
  const rows=await db.prepare("SELECT id,installment_id AS installmentId,amount_minor AS amountMinor FROM school_fee_installment_allocations WHERE organization_id=? AND receipt_id=? AND reversed_at IS NULL").bind(org,receiptId).all<any>();
  for(const r of rows.results)await db.batch([
    db.prepare("UPDATE school_fee_installment_allocations SET reversed_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND reversed_at IS NULL").bind(r.id,org),
    db.prepare("UPDATE school_fee_payment_plan_installments SET paid_minor=MAX(0,paid_minor-?),status=CASE WHEN paid_minor-?<=0 THEN 'pending' WHEN paid_minor-?<amount_minor THEN 'partially_paid' ELSE 'paid' END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(r.amountMinor,r.amountMinor,r.amountMinor,r.installmentId,org)
  ]);
  const plans=await db.prepare(`SELECT DISTINCT p.id FROM school_fee_payment_plans p JOIN school_fee_payment_plan_installments i ON i.plan_id=p.id JOIN school_fee_installment_allocations a ON a.installment_id=i.id WHERE a.organization_id=? AND a.receipt_id=?`).bind(org,receiptId).all<any>();
  for(const p of plans.results)await db.prepare("UPDATE school_fee_payment_plans SET status='active',updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND status='completed'").bind(p.id,org).run();
}

async function reverseSchoolFeeCharge(db:D1Database,org:string,actor:string,chargeId:string,postingDate:string,reason:string){
  const existing=await db.prepare("SELECT id,reversal_journal_id AS reversalJournalId FROM school_fee_charge_reversals WHERE organization_id=? AND charge_id=?").bind(org,chargeId).first<any>();
  if(existing)return{status:"reversed",reversalJournalId:existing.reversalJournalId};
  const charge=await db.prepare(`SELECT c.*,d.status AS documentStatus,d.paid_minor AS documentPaidMinor,d.journal_entry_id AS journalEntryId
    FROM school_student_fee_charges c LEFT JOIN documents d ON d.id=c.document_id AND d.organization_id=c.organization_id
    WHERE c.id=? AND c.organization_id=?`).bind(chargeId,org).first<any>();
  if(!charge)throw new AppError(404,"FEE_CHARGE_NOT_FOUND","School fee charge not found");
  const settlements=await db.prepare(`SELECT
    (SELECT COALESCE(SUM(pa.amount_minor),0) FROM payment_allocations pa WHERE pa.organization_id=? AND pa.document_id=? AND pa.reversed_at IS NULL) AS paymentMinor,
    (SELECT COALESCE(SUM(amount_minor),0) FROM school_fee_credits WHERE organization_id=? AND charge_id=? AND status='posted') AS creditMinor,
    (SELECT COALESCE(SUM(amount_minor),0) FROM school_fee_writeoffs WHERE organization_id=? AND charge_id=? AND status='posted') AS writeoffMinor`).bind(org,charge.document_id,org,chargeId,org,chargeId).first<any>();
  if(Number(settlements?.paymentMinor||0)>0||Number(settlements?.creditMinor||0)>0||Number(settlements?.writeoffMinor||0)>0)throw new AppError(409,"CHARGE_HAS_SETTLEMENTS","Reverse payments, credits and write-offs before reversing this fee billing",settlements);

  const reversedAdjustmentJournals:string[]=[];
  const adjustments=await db.prepare(`SELECT a.journal_entry_id AS journalEntryId,j.status FROM school_fee_charge_adjustments a LEFT JOIN journal_entries j ON j.id=a.journal_entry_id AND j.organization_id=a.organization_id WHERE a.organization_id=? AND a.charge_id=? AND a.journal_entry_id IS NOT NULL`).bind(org,chargeId).all<any>();
  for(const a of adjustments.results)if(a.status==="posted"){const rr=await reverseJournal(db,org,actor,a.journalEntryId,postingDate,reason);reversedAdjustmentJournals.push(rr.id)}

  let reversalJournalId:string|null=null;
  if(charge.document_id&&["open","partially_paid","paid"].includes(charge.documentStatus)){
    const rr=await reverseDocument(db,org,actor,charge.document_id,postingDate,reason);
    reversalJournalId=rr.reversalJournalId;
  }
  const reversalId=createId("frr");
  await db.batch([
    db.prepare(`INSERT INTO school_fee_charge_reversals (id,organization_id,charge_id,reversal_batch_id,posting_date,reason,reversal_kind,reversal_journal_id,reversed_by,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(reversalId,org,chargeId,null,postingDate,reason,"posted_reversal",reversalJournalId,actor,JSON.stringify({reversedAdjustmentJournals,origin:"accounts"})),
    db.prepare("UPDATE school_student_fee_charges SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(chargeId,org),
    db.prepare("DELETE FROM school_fee_billing_guards WHERE organization_id=? AND charge_id=?").bind(org,chargeId),
    auditStatement(db,{organizationId:org,actorId:actor,action:"school.fees.charge.reversed_from_accounts",entityType:"school_fee_charge",entityId:chargeId,after:{postingDate,reason,reversalJournalId}})
  ]);
  return{status:"reversed",reversalJournalId};
}

export async function reverseCrossModuleJournal(db:D1Database,org:string,actor:string,journalId:string,postingDate:string,reason:string){
  const preview=await previewCrossModuleReversal(db,org,journalId);
  if(preview.blockers.length)throw new AppError(409,"REVERSAL_BLOCKED",preview.blockers.join(" "),{preview});
  if(reason.trim().length<3)throw new AppError(422,"REVERSAL_REASON_REQUIRED","Provide a clear reversal reason.");

  if(preview.mode==="payroll"){
    const payroll=await payrollLink(db,org,journalId);
    const reversal=await reverseJournal(db,org,actor,journalId,postingDate,reason);
    await db.batch([
      db.prepare("UPDATE payroll_runs SET status='reversed',reversal_run_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND status='posted'").bind(reversal.id,payroll.id,org),
      auditStatement(db,{organizationId:org,actorId:actor,action:"payroll.reversed_from_accounts",entityType:"payroll_run",entityId:payroll.id,after:{reversalJournalId:reversal.id,reason}})
    ]);
    return{originalId:journalId,status:"reversed",reversal,source:{type:"payroll",id:payroll.id,status:"reversed"},preview};
  }

  if(preview.mode==="school_fee_receipt"){
    const payment=await paymentLink(db,org,journalId),receipt=await receiptLink(db,org,payment.id);
    const result=await reversePayment(db,org,actor,payment.id,postingDate,reason);
    await reverseInstallmentReceipt(db,org,receipt.id);
    await db.batch([
      db.prepare("UPDATE school_fee_receipts SET status='reversed',reversed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND status='posted'").bind(receipt.id,org),
      auditStatement(db,{organizationId:org,actorId:actor,action:"school.fees.receipt.reversed_from_accounts",entityType:"school_fee_receipt",entityId:receipt.id,after:{reason,reversalJournalId:result.reversalJournalId}})
    ]);
    return{originalId:journalId,status:"reversed",reversal:{id:result.reversalJournalId},source:{type:"school_fee_receipt",id:receipt.id,status:"reversed"},preview};
  }

  if(preview.mode==="payment"){
    const payment=await paymentLink(db,org,journalId),result=await reversePayment(db,org,actor,payment.id,postingDate,reason);
    return{originalId:journalId,status:"reversed",reversal:{id:result.reversalJournalId},source:{type:"payment",id:payment.id,status:"reversed"},preview};
  }

  if(preview.mode==="school_fee_charge"){
    const doc=await documentLink(db,org,journalId),charge=await chargeLink(db,org,doc.id);
    const result=await reverseSchoolFeeCharge(db,org,actor,charge.id,postingDate,reason);
    return{originalId:journalId,status:"reversed",reversal:{id:result.reversalJournalId},source:{type:"school_fee_charge",id:charge.id,status:"reversed"},preview};
  }

  if(preview.mode==="document"){
    const doc=await documentLink(db,org,journalId),result=await reverseDocument(db,org,actor,doc.id,postingDate,reason);
    return{originalId:journalId,status:"reversed",reversal:{id:result.reversalJournalId},source:{type:"document",id:doc.id,status:"void"},preview};
  }

  const reversal=await reverseJournal(db,org,actor,journalId,postingDate,reason);
  return{originalId:journalId,status:"reversed",reversal,source:null,preview};
}
