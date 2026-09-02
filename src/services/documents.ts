import { AppError } from "../lib/errors";
import { createId } from "../lib/ids";
import { createJournal, postJournal, reverseJournal, type JournalLineInput } from "./ledger";
import { auditStatement } from "./audit";
import { recordMovement } from "./inventory";

export type DocumentType = "invoice" | "bill" | "credit_note" | "supplier_credit";
export interface DocumentLineInput { productId?: string; accountId: string; taxAccountId?: string; description: string; quantityMicros: number; unitPriceMinor: number; taxMinor: number; projectId?: string }
export interface DocumentInput { type: DocumentType; number: string; contactId: string; issueDate: string; dueDate?: string; currency: string; customFields?: Record<string, unknown>; lines: DocumentLineInput[] }

function calculate(input: DocumentInput) {
  const lines = input.lines.map((line) => {
    const subtotalMinor = Math.round(line.quantityMicros * line.unitPriceMinor / 1_000_000);
    if (!Number.isSafeInteger(subtotalMinor) || subtotalMinor < 0 || line.taxMinor < 0) throw new AppError(422,"INVALID_AMOUNT","Document amounts must be non-negative safe integers");
    return { ...line, subtotalMinor, totalMinor: subtotalMinor + line.taxMinor };
  });
  return { lines, subtotalMinor: lines.reduce((n,l)=>n+l.subtotalMinor,0), taxMinor: lines.reduce((n,l)=>n+l.taxMinor,0), totalMinor: lines.reduce((n,l)=>n+l.totalMinor,0) };
}

export async function createDocument(db:D1Database,organizationId:string,actorId:string,input:DocumentInput){
  const expectedContact=input.type==="invoice"||input.type==="credit_note"?"customer":"supplier";
  const contact=await db.prepare("SELECT type FROM contacts WHERE id=? AND organization_id=? AND active=1").bind(input.contactId,organizationId).first<{type:string}>();
  if(!contact||contact.type!==expectedContact) throw new AppError(422,"INVALID_CONTACT",`A ${expectedContact} contact is required`);
  const totals=calculate(input);
  if(totals.totalMinor<=0) throw new AppError(422,"INVALID_TOTAL","Document total must be positive");
  const accountIds=[...input.lines.flatMap(l=>[l.accountId,l.taxAccountId].filter((x):x is string=>Boolean(x)))];
  const placeholders=accountIds.map(()=>"?").join(",");
  const accounts=await db.prepare(`SELECT COUNT(*) AS count FROM accounts WHERE organization_id=? AND active=1 AND allow_posting=1 AND id IN (${placeholders})`).bind(organizationId,...accountIds).first<{count:number}>();
  if(Number(accounts?.count??0)!==new Set(accountIds).size) throw new AppError(422,"INVALID_ACCOUNT","All line accounts must be active posting accounts in the organization");
  const productIds = input.lines.map((line) => line.productId).filter((value): value is string => Boolean(value));
  if (productIds.length) {
    const productCount = await db.prepare(`SELECT COUNT(*) AS count FROM products WHERE organization_id=? AND active=1 AND id IN (${productIds.map(() => "?").join(",")})`)
      .bind(organizationId, ...productIds).first<{ count: number }>();
    if (Number(productCount?.count ?? 0) !== new Set(productIds).size) throw new AppError(422, "INVALID_PRODUCT", "All products must be active and belong to the organization");
  }
  const projectIds = input.lines.map((line) => line.projectId).filter((value): value is string => Boolean(value));
  if (projectIds.length) {
    const projectCount = await db.prepare(`SELECT COUNT(*) AS count FROM projects WHERE organization_id=? AND status IN ('planned','active') AND id IN (${projectIds.map(() => "?").join(",")})`)
      .bind(organizationId, ...projectIds).first<{ count: number }>();
    if (Number(projectCount?.count ?? 0) !== new Set(projectIds).size) throw new AppError(422, "INVALID_PROJECT", "All projects must be open and belong to the organization");
  }
  const id=createId("doc");
  const statements:D1PreparedStatement[]=[db.prepare(`INSERT INTO documents
    (id,organization_id,type,number,contact_id,issue_date,due_date,status,currency,subtotal_minor,tax_minor,total_minor,custom_fields)
    VALUES (?,?,?,?,?,?,?,'draft',?,?,?,?,?)`).bind(id,organizationId,input.type,input.number,input.contactId,input.issueDate,input.dueDate??input.issueDate,input.currency,totals.subtotalMinor,totals.taxMinor,totals.totalMinor,JSON.stringify(input.customFields??{}))];
  for(const line of totals.lines) statements.push(db.prepare(`INSERT INTO document_lines
    (id,organization_id,document_id,product_id,account_id,tax_account_id,description,quantity_micros,unit_price_minor,subtotal_minor,tax_minor,total_minor,project_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(createId("dln"),organizationId,id,line.productId??null,line.accountId,line.taxAccountId??null,line.description,line.quantityMicros,line.unitPriceMinor,line.subtotalMinor,line.taxMinor,line.totalMinor,line.projectId??null));
  statements.push(auditStatement(db,{organizationId,actorId,action:"document.created",entityType:"document",entityId:id,after:{type:input.type,number:input.number,totalMinor:totals.totalMinor}}));
  await db.batch(statements);
  return {id,status:"draft" as const,...totals};
}

export async function postDocument(db:D1Database,organizationId:string,actorId:string,id:string,controlAccountId:string){
  const doc=await db.prepare(`SELECT id,type,number,contact_id AS contactId,issue_date AS issueDate,currency,total_minor AS totalMinor,status,journal_entry_id AS journalEntryId,approval_status AS approvalStatus,custom_fields AS customFields
    FROM documents WHERE id=? AND organization_id=?`).bind(id,organizationId).first<{id:string;type:DocumentType;number:string;contactId:string;issueDate:string;currency:string;totalMinor:number;status:string;journalEntryId:string|null;approvalStatus:string;customFields:string}>();
  if(!doc) throw new AppError(404,"NOT_FOUND","Document not found");
  if(doc.status!=="draft") { if(doc.journalEntryId) return {id,status:doc.status,journalEntryId:doc.journalEntryId}; throw new AppError(409,"INVALID_STATE","Only draft documents can be posted"); }
  const policy=await db.prepare("SELECT 1 FROM approval_policies WHERE organization_id=? AND document_type=? AND active=1 AND minimum_minor<=? AND (maximum_minor IS NULL OR maximum_minor>=?) LIMIT 1").bind(organizationId,doc.type,doc.totalMinor,doc.totalMinor).first();
  if(policy&&doc.approvalStatus!=="approved")throw new AppError(409,"APPROVAL_REQUIRED","Document must complete its approval workflow before posting");
  const control=await db.prepare("SELECT subtype FROM accounts WHERE id=? AND organization_id=? AND active=1 AND allow_posting=1").bind(controlAccountId,organizationId).first<{subtype:string}>();
  const receivable=doc.type==="invoice"||doc.type==="credit_note";
  if(!control||control.subtype!==(receivable?"receivable":"payable")) throw new AppError(422,"INVALID_CONTROL_ACCOUNT",`A valid accounts ${receivable?"receivable":"payable"} control account is required`);
  const raw=await db.prepare(`SELECT account_id AS accountId,tax_account_id AS taxAccountId,description,subtotal_minor AS subtotalMinor,tax_minor AS taxMinor,project_id AS projectId
    FROM document_lines WHERE document_id=? AND organization_id=?`).bind(id,organizationId).all<{accountId:string;taxAccountId:string|null;description:string;subtotalMinor:number;taxMinor:number;projectId:string|null}>();
  const positive=doc.type==="invoice"||doc.type==="bill";
  const lines:JournalLineInput[]=[];
  const controlDebit=doc.type==="invoice"||doc.type==="supplier_credit";
  lines.push({accountId:controlAccountId,contactId:doc.contactId,description:doc.number,...(controlDebit?{debitMinor:doc.totalMinor}:{creditMinor:doc.totalMinor})});
  for(const line of raw.results){
    const debit=(doc.type==="bill"||doc.type==="credit_note");
    lines.push({accountId:line.accountId,description:line.description,projectId:line.projectId??undefined,contactId:doc.contactId,...(debit?{debitMinor:line.subtotalMinor}:{creditMinor:line.subtotalMinor})});
    if(line.taxMinor>0){
      if(!line.taxAccountId) throw new AppError(422,"TAX_ACCOUNT_REQUIRED","Every taxed line requires a tax account");
      lines.push({accountId:line.taxAccountId,description:`Tax: ${line.description}`,contactId:doc.contactId,...(debit?{debitMinor:line.taxMinor}:{creditMinor:line.taxMinor})});
    }
  }
  const journal=await createJournal(db,organizationId,actorId,{transactionDate:doc.issueDate,postingDate:doc.issueDate,description:`${doc.type}: ${doc.number}`,reference:doc.number,currency:doc.currency,sourceType:doc.type,sourceId:id,lines},`document:${id}:post`);
  const state=await db.prepare("SELECT status FROM journal_entries WHERE id=? AND organization_id=?").bind(journal.id,organizationId).first<{status:string}>();
  if(state?.status==="draft") await postJournal(db,organizationId,actorId,journal.id);
  await db.batch([
    db.prepare("UPDATE documents SET status='open',journal_entry_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND status='draft'").bind(journal.id,id,organizationId),
    auditStatement(db,{organizationId,actorId,action:"document.posted",entityType:"document",entityId:id,after:{journalEntryId:journal.id}}),
  ]);
  const inventoryLocationId=(JSON.parse(doc.customFields||"{}") as {inventoryLocationId?:string}).inventoryLocationId;
  if(inventoryLocationId){const inventoryLines=await db.prepare(`SELECT l.id,l.product_id AS productId,l.account_id AS lineAccountId,l.quantity_micros AS quantityMicros,l.unit_price_minor AS unitCostMinor,p.expense_account_id AS expenseAccountId,p.type FROM document_lines l JOIN products p ON p.id=l.product_id AND p.organization_id=l.organization_id WHERE l.document_id=? AND l.organization_id=? AND p.type='inventory'`).bind(id,organizationId).all<{id:string;productId:string;lineAccountId:string;quantityMicros:number;unitCostMinor:number;expenseAccountId:string|null;type:string}>();for(const line of inventoryLines.results){const sale=doc.type==="invoice"||doc.type==="credit_note",positive=doc.type==="bill"||doc.type==="credit_note",offset=sale?line.expenseAccountId:line.lineAccountId;if(!offset)throw new AppError(422,"COGS_ACCOUNT_REQUIRED","Inventory sales require a product expense/COGS account");await recordMovement(db,organizationId,actorId,{productId:line.productId,locationId:inventoryLocationId,type:doc.type==="invoice"?"issue":doc.type==="bill"?"receipt":doc.type==="credit_note"?"sale_return":"purchase_return",movementDate:doc.issueDate,quantityDeltaMicros:positive?line.quantityMicros:-line.quantityMicros,unitCostMinor:positive?line.unitCostMinor:undefined,offsetAccountId:offset,sourceType:doc.type,sourceId:id},`document-inventory:${id}:${line.id}`)}}
  return {id,status:"open",journalEntryId:journal.id};
}

export async function reverseDocument(db: D1Database, organizationId: string, actorId: string, id: string, postingDate: string, reason: string) {
  const doc = await db.prepare("SELECT status,paid_minor AS paidMinor,journal_entry_id AS journalEntryId FROM documents WHERE id=? AND organization_id=?")
    .bind(id, organizationId).first<{ status: string; paidMinor: number; journalEntryId: string | null }>();
  if (!doc) throw new AppError(404, "NOT_FOUND", "Document not found");
  if (!doc.journalEntryId || !["open", "partially_paid", "paid"].includes(doc.status)) throw new AppError(409, "INVALID_STATE", "Only a posted document can be reversed");
  if (doc.paidMinor !== 0) throw new AppError(409, "DOCUMENT_HAS_PAYMENTS", "Reverse allocated payments before reversing this document");
  const reversal = await reverseJournal(db, organizationId, actorId, doc.journalEntryId, postingDate, reason);
  await db.batch([
    db.prepare("UPDATE documents SET status='void',updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND paid_minor=0").bind(id, organizationId),
    auditStatement(db, { organizationId, actorId, action: "document.reversed", entityType: "document", entityId: id, after: { reversalJournalId: reversal.id, reason } }),
  ]);
  return { id, status: "void", reversalJournalId: reversal.id };
}
