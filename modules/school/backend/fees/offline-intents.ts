import { AppError } from "../../../../src/lib/errors";
import { createId } from "../../../../src/lib/ids";
import { createPayment, postPayment, type AllocationInput } from "../../../../src/services/payments";
import { ensureFeeAccounting, nextNumber, oldestOpenAllocations, requirePayer, requireStudent, studentBalance } from "./common";
import { captureDraftReceiptSnapshot, finalizeReceiptSnapshot } from "./receipt-printing";

type R=Record<string,any>;
function parseAllocations(value:string):AllocationInput[]{try{const x=JSON.parse(value);return Array.isArray(x)?x:[]}catch{return[]}}

async function method(db:D1Database,org:string,id:string){
  const row=await db.prepare(`SELECT pm.id,pm.name,pm.account_id AS accountId,a.subtype,a.active AS accountActive
    FROM school_payment_methods pm LEFT JOIN accounts a ON a.id=pm.account_id AND a.organization_id=pm.organization_id
    WHERE pm.id=? AND pm.organization_id=? AND pm.active=1`).bind(id,org).first<R>();
  if(!row||!row.accountId||row.subtype!=="cash"||!row.accountActive)throw new AppError(422,"INVALID_PAYMENT_METHOD","The captured payment method is no longer available for posting");
  return row;
}
async function feeDocuments(db:D1Database,org:string,payer:string,currency:string,items:AllocationInput[]){
  for(const a of items){
    const d=await db.prepare(`SELECT d.id,d.contact_id AS contactId,d.currency,d.total_minor AS totalMinor,d.paid_minor AS paidMinor
      FROM documents d JOIN school_student_fee_charges c ON c.document_id=d.id AND c.organization_id=d.organization_id
      WHERE d.id=? AND d.organization_id=? AND d.type='invoice' AND d.status IN ('open','partially_paid')
        AND c.status IN ('invoiced','partially_settled') LIMIT 1`).bind(a.documentId,org).first<R>();
    if(!d||d.contactId!==payer||d.currency!==currency||a.amountMinor>Number(d.totalMinor)-Number(d.paidMinor))
      throw new AppError(422,"INVALID_FEE_ALLOCATION","An offline allocation no longer matches an open fee invoice");
  }
}
async function recomputeInstallment(db:D1Database,org:string,installmentId:string){
  await db.prepare(`UPDATE school_fee_payment_plan_installments SET
    paid_minor=MIN(amount_minor,COALESCE((SELECT SUM(a.amount_minor) FROM school_fee_installment_allocations a WHERE a.organization_id=? AND a.installment_id=school_fee_payment_plan_installments.id AND a.reversed_at IS NULL),0)),
    status=CASE WHEN COALESCE((SELECT SUM(a.amount_minor) FROM school_fee_installment_allocations a WHERE a.organization_id=? AND a.installment_id=school_fee_payment_plan_installments.id AND a.reversed_at IS NULL),0)>=amount_minor THEN 'paid' WHEN COALESCE((SELECT SUM(a.amount_minor) FROM school_fee_installment_allocations a WHERE a.organization_id=? AND a.installment_id=school_fee_payment_plan_installments.id AND a.reversed_at IS NULL),0)>0 THEN 'partially_paid' ELSE 'pending' END,
    updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`).bind(org,org,org,installmentId,org).run();
}
async function applyInstallments(db:D1Database,org:string,receiptId:string,studentId:string|undefined,amountMinor:number){
  if(!studentId||amountMinor<=0)return;
  const existing=await db.prepare("SELECT installment_id AS installmentId,amount_minor AS amountMinor FROM school_fee_installment_allocations WHERE organization_id=? AND receipt_id=? AND reversed_at IS NULL").bind(org,receiptId).all<{installmentId:string;amountMinor:number}>();
  for(const row of existing.results)await recomputeInstallment(db,org,row.installmentId);
  let remaining=Math.max(0,amountMinor-existing.results.reduce((n,r)=>n+Number(r.amountMinor||0),0));
  const plans=await db.prepare(`SELECT i.id,i.amount_minor AS amountMinor,i.paid_minor AS paidMinor FROM school_fee_payment_plan_installments i
    JOIN school_fee_payment_plans p ON p.id=i.plan_id AND p.organization_id=i.organization_id WHERE i.organization_id=? AND p.student_id=?
      AND p.status='active' AND i.status IN ('pending','partially_paid','overdue') ORDER BY i.due_date,i.sequence_no`).bind(org,studentId).all<R>();
  const already=new Set(existing.results.map(r=>r.installmentId));
  for(const i of plans.results){if(remaining<=0)break;if(already.has(String(i.id)))continue;const due=Math.max(0,Number(i.amountMinor)-Number(i.paidMinor)),amount=Math.min(due,remaining);if(!amount)continue;
    await db.prepare("INSERT OR IGNORE INTO school_fee_installment_allocations(id,organization_id,installment_id,receipt_id,amount_minor) VALUES (?,?,?,?,?)").bind(createId("fia"),org,i.id,receiptId,amount).run();
    await recomputeInstallment(db,org,String(i.id));remaining-=amount;}
  await db.prepare(`UPDATE school_fee_payment_plans SET status=CASE WHEN NOT EXISTS(SELECT 1 FROM school_fee_payment_plan_installments i
    WHERE i.plan_id=school_fee_payment_plans.id AND i.organization_id=school_fee_payment_plans.organization_id AND i.status<>'paid') THEN 'completed' ELSE status END,
    updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND student_id=? AND status='active'`).bind(org,studentId).run();
}

export async function processOfflineFeeReceiptIntent(db:D1Database,org:string,intentId:string,actorOverride?:string){
  const intent=await db.prepare("SELECT * FROM school_mobile_fee_receipt_intents WHERE id=? AND organization_id=?").bind(intentId,org).first<R>();
  if(!intent)throw new AppError(404,"OFFLINE_RECEIPT_INTENT_NOT_FOUND","Offline receipt intent not found");
  if(intent.status==="posted"&&intent.official_receipt_id)return {intentId,status:"posted",receiptId:intent.official_receipt_id,paymentId:intent.payment_id};
  const actor=actorOverride||String(intent.created_by||"");
  await db.prepare("UPDATE school_mobile_fee_receipt_intents SET status='processing',attempts=attempts+1,last_attempt_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(intentId,org).run();
  try{
    const accounting=await ensureFeeAccounting(db,org);
    const student=intent.student_id?await requireStudent(db,org,String(intent.student_id)):null;
    if(!student&&!intent.payer_contact_id)throw new AppError(422,"PAYER_REQUIRED","The offline receipt has no student or payer");
    const payer=student?await requirePayer(db,org,student,intent.payer_contact_id):await db.prepare("SELECT id,name,type,active FROM contacts WHERE id=? AND organization_id=? AND archived_at IS NULL").bind(intent.payer_contact_id,org).first<R>();
    if(!payer||payer.type!=="customer"||!payer.active)throw new AppError(422,"INVALID_PAYER","The captured payer is no longer an active customer");
    if(intent.supporting_file_id){const file=await db.prepare("SELECT id FROM school_files WHERE id=? AND organization_id=? AND deleted_at IS NULL").bind(intent.supporting_file_id,org).first();if(!file)throw new AppError(422,"INVALID_SUPPORTING_FILE","The supporting evidence attached offline is no longer available");}
    const pm=await method(db,org,String(intent.payment_method_id)),currency=String(intent.currency||accounting.defaultCurrency),allocations=parseAllocations(String(intent.allocations_json||"[]"));
    if(allocations.length)await feeDocuments(db,org,String(payer.id),currency,allocations);
    const idem=`school-fee-mobile-intent:${intent.id}`;
    let payment=await db.prepare("SELECT id,number,status FROM payments WHERE organization_id=? AND idempotency_key=?").bind(org,idem).first<R>();
    let receipt=payment?await db.prepare("SELECT id,receipt_number AS receiptNumber,status FROM school_fee_receipts WHERE organization_id=? AND payment_id=?").bind(org,payment.id).first<R>():null;
    if(!payment){
      const receiptNumber=await nextNumber(db,org,"fee_receipt","SR-");
      payment=await createPayment(db,org,actor,{type:"receipt",number:receiptNumber,contactId:String(payer.id),bankAccountId:String(pm.accountId),controlAccountId:accounting.receivableAccountId,paymentDate:String(intent.payment_date),currency,amountMinor:Number(intent.amount_minor),reference:intent.reference??undefined},idem) as R;
      receipt={id:createId("frc"),receiptNumber,status:"draft"};
      const before=intent.student_id?Number((await studentBalance(db,org,String(intent.student_id))).balanceMinor||0):null;
      await db.prepare(`INSERT INTO school_fee_receipts(id,organization_id,receipt_number,student_id,payer_contact_id,payment_method_id,payment_id,supporting_file_id,payment_date,currency,amount_minor,allocated_minor,unallocated_minor,reference,notes,status,created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(receipt.id,org,receiptNumber,intent.student_id??null,payer.id,intent.payment_method_id,payment.id,intent.supporting_file_id??null,intent.payment_date,currency,intent.amount_minor,0,intent.amount_minor,intent.reference??null,intent.notes??null,"draft",actor).run();
      await captureDraftReceiptSnapshot(db,org,String(receipt.id),before);
    } else if(!receipt){
      receipt={id:createId("frc"),receiptNumber:String(payment.number),status:"draft"};
      await db.prepare(`INSERT INTO school_fee_receipts(id,organization_id,receipt_number,student_id,payer_contact_id,payment_method_id,payment_id,supporting_file_id,payment_date,currency,amount_minor,allocated_minor,unallocated_minor,reference,notes,status,created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(receipt.id,org,receipt.receiptNumber,intent.student_id??null,payer.id,intent.payment_method_id,payment.id,intent.supporting_file_id??null,intent.payment_date,currency,intent.amount_minor,0,intent.amount_minor,intent.reference??null,intent.notes??null,"draft",actor).run();
    }
    if(receipt.status!=="posted"){
      let finalAllocations=allocations;
      if(!finalAllocations.length&&Number(intent.auto_allocate))finalAllocations=await oldestOpenAllocations(db,org,String(payer.id),currency,Number(intent.amount_minor),intent.student_id?[String(intent.student_id)]:undefined);
      let allocatedMinor=0,unallocatedMinor=Number(intent.amount_minor);
      if(String(payment.status)==="posted"){
        const used=await db.prepare("SELECT COALESCE(SUM(amount_minor),0) AS amount FROM payment_allocations WHERE organization_id=? AND payment_id=? AND reversed_at IS NULL").bind(org,payment.id).first<{amount:number}>();
        allocatedMinor=Number(used?.amount||0);unallocatedMinor=Math.max(0,Number(intent.amount_minor)-allocatedMinor);
      }else{
        const posted=await postPayment(db,org,actor,String(payment.id),finalAllocations);allocatedMinor=Number(posted.allocatedMinor||0);unallocatedMinor=Number(posted.unallocatedMinor??Math.max(0,Number(intent.amount_minor)-allocatedMinor));
      }
      await db.prepare("UPDATE school_fee_receipts SET status='posted',allocated_minor=?,unallocated_minor=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(allocatedMinor,unallocatedMinor,receipt.id,org).run();
      receipt.status="posted";
    }
    await applyInstallments(db,org,String(receipt.id),intent.student_id?String(intent.student_id):undefined,Number(intent.amount_minor));
    await finalizeReceiptSnapshot(db,org,String(receipt.id));
    await db.prepare("UPDATE school_mobile_fee_receipt_intents SET status='posted',official_receipt_id=?,payment_id=?,last_error=NULL,next_attempt_at=NULL,processed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(receipt.id,payment.id,intentId,org).run();
    return {intentId,status:"posted",receiptId:receipt.id,paymentId:payment.id};
  }catch(error){
    const message=error instanceof Error?error.message:String(error),attempt=Math.max(1,Number(intent.attempts||0)+1),delayMinutes=Math.min(1440,Math.pow(2,Math.min(attempt,10)));
    const nextAttemptAt=new Date(Date.now()+delayMinutes*60_000).toISOString();
    await db.prepare("UPDATE school_mobile_fee_receipt_intents SET status='failed',last_error=?,next_attempt_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(message.slice(0,2000),nextAttemptAt,intentId,org).run();
    throw error;
  }
}

export async function processPendingOfflineFeeReceipts(db:D1Database,limit=50,organizationId?:string){
  const bounded=Math.max(1,Math.min(limit,200));
  const rows=organizationId
    ? await db.prepare(`SELECT id,organization_id AS organizationId FROM school_mobile_fee_receipt_intents WHERE organization_id=? AND ((status='pending') OR (status='failed' AND (next_attempt_at IS NULL OR next_attempt_at<=CURRENT_TIMESTAMP)) OR (status='processing' AND updated_at<datetime('now','-10 minutes'))) ORDER BY created_at LIMIT ?`).bind(organizationId,bounded).all<{id:string;organizationId:string}>()
    : await db.prepare(`SELECT id,organization_id AS organizationId FROM school_mobile_fee_receipt_intents WHERE (status='pending') OR (status='failed' AND (next_attempt_at IS NULL OR next_attempt_at<=CURRENT_TIMESTAMP)) OR (status='processing' AND updated_at<datetime('now','-10 minutes')) ORDER BY created_at LIMIT ?`).bind(bounded).all<{id:string;organizationId:string}>();
  let posted=0,failed=0;for(const row of rows.results){try{await processOfflineFeeReceiptIntent(db,row.organizationId,row.id);posted++}catch{failed++}}
  return {scanned:rows.results.length,posted,failed};
}
