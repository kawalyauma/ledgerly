import { AppError } from "../lib/errors";
import { createId } from "../lib/ids";
import { auditStatement } from "./audit";
import { createJournal, postJournal, reverseJournal } from "./ledger";

export interface PaymentInput { type:"receipt"|"payment";number:string;contactId:string;bankAccountId:string;controlAccountId:string;paymentDate:string;currency:string;amountMinor:number;reference?:string }
export interface AllocationInput { documentId:string;amountMinor:number }

export async function createPayment(db:D1Database,organizationId:string,actorId:string,input:PaymentInput,idempotencyKey:string){
  const existing=await db.prepare("SELECT id,number,status FROM payments WHERE organization_id=? AND idempotency_key=?").bind(organizationId,idempotencyKey).first();
  if(existing)return existing;
  const contact=await db.prepare("SELECT type FROM contacts WHERE id=? AND organization_id=? AND active=1").bind(input.contactId,organizationId).first<{type:string}>();
  const allowedContacts=input.type==="receipt"?["customer"]:["supplier","employee"];
  if(!contact||!allowedContacts.includes(contact.type))throw new AppError(422,"INVALID_CONTACT",input.type==="receipt"?"An active customer contact is required":"An active supplier or employee contact is required");
  const accounts=await db.prepare("SELECT id,subtype FROM accounts WHERE organization_id=? AND id IN (?,?) AND active=1 AND allow_posting=1").bind(organizationId,input.bankAccountId,input.controlAccountId).all<{id:string;subtype:string}>();
  if(accounts.results.length!==new Set([input.bankAccountId,input.controlAccountId]).size)throw new AppError(422,"INVALID_ACCOUNT","Payment accounts must be active posting accounts");
  if(!accounts.results.some(a=>a.id===input.bankAccountId&&a.subtype==="cash"))throw new AppError(422,"INVALID_BANK_ACCOUNT","Bank account must use the cash subtype");
  const controlSubtype=input.type==="receipt"?"receivable":"payable";
  if(!accounts.results.some(a=>a.id===input.controlAccountId&&a.subtype===controlSubtype))throw new AppError(422,"INVALID_CONTROL_ACCOUNT",`Control account must use the ${controlSubtype} subtype`);
  const id=createId("pay");
  await db.batch([
    db.prepare(`INSERT INTO payments (id,organization_id,type,number,contact_id,bank_account_id,control_account_id,payment_date,currency,amount_minor,reference,status,idempotency_key)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'draft',?)`).bind(id,organizationId,input.type,input.number,input.contactId,input.bankAccountId,input.controlAccountId,input.paymentDate,input.currency,input.amountMinor,input.reference??null,idempotencyKey),
    auditStatement(db,{organizationId,actorId,action:"payment.created",entityType:"payment",entityId:id,after:{type:input.type,number:input.number,amountMinor:input.amountMinor}}),
  ]);
  return {id,number:input.number,status:"draft"};
}

export async function postPayment(db:D1Database,organizationId:string,actorId:string,id:string,allocations:AllocationInput[]){
  const payment=await db.prepare(`SELECT id,type,number,contact_id AS contactId,bank_account_id AS bankAccountId,control_account_id AS controlAccountId,
    payment_date AS paymentDate,currency,amount_minor AS amountMinor,status,journal_entry_id AS journalEntryId FROM payments WHERE id=? AND organization_id=?`)
    .bind(id,organizationId).first<{id:string;type:"receipt"|"payment";number:string;contactId:string;bankAccountId:string;controlAccountId:string;paymentDate:string;currency:string;amountMinor:number;status:string;journalEntryId:string|null}>();
  if(!payment)throw new AppError(404,"NOT_FOUND","Payment not found");
  if(payment.status!=="draft"){if(payment.journalEntryId)return{id,status:payment.status,journalEntryId:payment.journalEntryId};throw new AppError(409,"INVALID_STATE","Only draft payments can be posted")}
  const duplicate=new Set(allocations.map(a=>a.documentId));
  if(duplicate.size!==allocations.length)throw new AppError(422,"DUPLICATE_ALLOCATION","Each document may appear once per payment");
  const allocated=allocations.reduce((n,a)=>n+a.amountMinor,0);
  if(allocations.some(a=>!Number.isSafeInteger(a.amountMinor)||a.amountMinor<=0)||allocated>payment.amountMinor)throw new AppError(422,"INVALID_ALLOCATION","Allocations must be positive and cannot exceed the payment amount");
  for(const allocation of allocations){
    const expectedType=payment.type==="receipt"?"invoice":"bill";
    const doc=await db.prepare(`SELECT id,total_minor AS totalMinor,paid_minor AS paidMinor FROM documents
      WHERE id=? AND organization_id=? AND contact_id=? AND type=? AND currency=? AND status IN ('open','partially_paid')`)
      .bind(allocation.documentId,organizationId,payment.contactId,expectedType,payment.currency).first<{id:string;totalMinor:number;paidMinor:number}>();
    if(!doc)throw new AppError(422,"INVALID_ALLOCATION_DOCUMENT","Allocation document is not open or does not match the payment");
    if(allocation.amountMinor>doc.totalMinor-doc.paidMinor)throw new AppError(422,"OVER_ALLOCATION","Allocation exceeds the document outstanding balance",{documentId:doc.id});
  }
  const receipt=payment.type==="receipt";
  const journal=await createJournal(db,organizationId,actorId,{transactionDate:payment.paymentDate,postingDate:payment.paymentDate,description:`${payment.type}: ${payment.number}`,reference:payment.number,currency:payment.currency,sourceType:payment.type,sourceId:id,lines:[
    {accountId:payment.bankAccountId,description:payment.number,contactId:payment.contactId,...(receipt?{debitMinor:payment.amountMinor}:{creditMinor:payment.amountMinor})},
    {accountId:payment.controlAccountId,description:payment.number,contactId:payment.contactId,...(receipt?{creditMinor:payment.amountMinor}:{debitMinor:payment.amountMinor})},
  ]},`payment:${id}:post`);
  const state=await db.prepare("SELECT status FROM journal_entries WHERE id=? AND organization_id=?").bind(journal.id,organizationId).first<{status:string}>();
  if(state?.status==="draft")await postJournal(db,organizationId,actorId,journal.id);
  const statements:D1PreparedStatement[]=[db.prepare("UPDATE payments SET status='posted',journal_entry_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND status='draft'").bind(journal.id,id,organizationId)];
  for (const allocation of allocations) {
    statements.push(db.prepare("INSERT INTO payment_allocations (id,organization_id,payment_id,document_id,amount_minor) VALUES (?,?,?,?,?)").bind(createId("pal"),organizationId,id,allocation.documentId,allocation.amountMinor));
  }
  statements.push(auditStatement(db,{organizationId,actorId,action:"payment.posted",entityType:"payment",entityId:id,after:{journalEntryId:journal.id,allocatedMinor:allocated}}));
  await db.batch(statements);
  return{id,status:"posted",journalEntryId:journal.id,allocatedMinor:allocated,unallocatedMinor:payment.amountMinor-allocated};
}

export async function reversePayment(db: D1Database, organizationId: string, actorId: string, id: string, postingDate: string, reason: string) {
  const payment = await db.prepare("SELECT status,journal_entry_id AS journalEntryId FROM payments WHERE id=? AND organization_id=?")
    .bind(id, organizationId).first<{ status: string; journalEntryId: string | null }>();
  if (!payment) throw new AppError(404, "NOT_FOUND", "Payment not found");
  if (payment.status !== "posted" || !payment.journalEntryId) throw new AppError(409, "INVALID_STATE", "Only an unreversed posted payment can be reversed");
  const reversal = await reverseJournal(db, organizationId, actorId, payment.journalEntryId, postingDate, reason);
  const allocations = await db.prepare("SELECT id FROM payment_allocations WHERE payment_id=? AND organization_id=? AND reversed_at IS NULL")
    .bind(id, organizationId).all<{ id: string }>();
  await db.batch([
    db.prepare("UPDATE payments SET status='reversed',updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND status='posted'").bind(id, organizationId),
    ...allocations.results.map((allocation) => db.prepare("UPDATE payment_allocations SET reversed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND reversed_at IS NULL").bind(allocation.id, organizationId)),
    auditStatement(db, { organizationId, actorId, action: "payment.reversed", entityType: "payment", entityId: id, after: { reversalJournalId: reversal.id, reason } }),
  ]);
  return { id, status: "reversed", reversalJournalId: reversal.id };
}

export async function allocatePostedPayment(db:D1Database,organizationId:string,actorId:string,id:string,allocations:AllocationInput[]){
  const payment=await db.prepare(`SELECT amount_minor AS amountMinor,status FROM payments WHERE id=? AND organization_id=?`)
    .bind(id,organizationId).first<{amountMinor:number;status:string}>();
  if(!payment||payment.status!=="posted")throw new AppError(409,"INVALID_STATE","Posted payment not found");
  const used=await db.prepare("SELECT COALESCE(SUM(amount_minor),0) AS amount FROM payment_allocations WHERE payment_id=? AND organization_id=? AND reversed_at IS NULL").bind(id,organizationId).first<{amount:number}>();
  const requested=allocations.reduce((n,a)=>n+a.amountMinor,0);
  if(!allocations.length||allocations.some(a=>!Number.isSafeInteger(a.amountMinor)||a.amountMinor<=0)||requested>payment.amountMinor-Number(used?.amount??0))throw new AppError(422,"INVALID_ALLOCATION","Allocations exceed the unallocated payment balance");
  await db.batch([
    ...allocations.map(a=>db.prepare("INSERT INTO payment_allocations (id,organization_id,payment_id,document_id,amount_minor) VALUES (?,?,?,?,?)").bind(createId("pal"),organizationId,id,a.documentId,a.amountMinor)),
    auditStatement(db,{organizationId,actorId,action:"payment.allocated",entityType:"payment",entityId:id,after:{allocatedMinor:requested}}),
  ]);
  return{id,allocatedMinor:requested,unallocatedMinor:payment.amountMinor-Number(used?.amount??0)-requested};
}
