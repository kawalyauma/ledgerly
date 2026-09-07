import { z } from "zod";
import { AppError } from "../../../../src/lib/errors";
import { createId } from "../../../../src/lib/ids";
import { createDocument, postDocument } from "../../../../src/services/documents";
import { createJournal, postJournal } from "../../../../src/services/ledger";

export const money = z.number().int().nonnegative();
export const positiveMoney = z.number().int().positive();
export const percentageMicros = z.number().int().min(0).max(100_000_000);
export const nullableText = (max: number) => z.string().trim().max(max).optional().nullable();

export type FeeAccounting = {
  receivableAccountId: string;
  discountAccountId: string | null;
  scholarshipAccountId: string | null;
  writeoffAccountId: string | null;
  lateFeeIncomeAccountId: string | null;
  defaultCurrency: string;
  invoiceDueDays: number;
  autoPostInvoices: number;
  autoPostReceipts: number;
};

export type StudentBillingRow = {
  id: string;
  contactId: string | null;
  financialSponsorContactId: string | null;
  currentAcademicYearId: string | null;
  currentClassId: string | null;
  currentStreamId: string | null;
  campusId: string | null;
  classLevelId: string | null;
  residencyStatus: string;
  studentCategory: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string;
  admissionNumber: string;
  studentNumber: string;
};

export type FeeCategoryRow = {
  id: string;
  code: string;
  name: string;
  incomeAccountId: string | null;
  receivableAccountId: string | null;
  productId: string | null;
  taxable: number;
  taxCode: string | null;
  refundable: number;
  mandatory: number;
  active: number;
};

export type FeeAdjustment = {
  awardId?: string;
  schemeId?: string;
  type: "discount"|"scholarship"|"bursary"|"waiver"|"sibling_discount"|"other";
  amountMinor: number;
  reason: string;
  accountingTreatment: "net_revenue"|"expense";
  accountId?: string | null;
};

export function today() { return new Date().toISOString().slice(0, 10); }
export function addDays(value: string, days: number) {
  const d = new Date(`${value}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
export function fullName(s: Pick<StudentBillingRow,"firstName"|"middleName"|"lastName">) { return [s.firstName,s.middleName,s.lastName].filter(Boolean).join(" "); }
export function safeCode(value: string) { return value.toUpperCase().replace(/[^A-Z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,24) || "FEE"; }
export function parseJson<T>(value: unknown, fallback: T): T { try { return typeof value === "string" ? JSON.parse(value) as T : fallback; } catch { return fallback; } }

async function nextAvailableAccountCode(db:D1Database, organizationId:string, preferred:string){
  let code=preferred.slice(0,30), i=1;
  while(await db.prepare("SELECT 1 FROM accounts WHERE organization_id=? AND code=?").bind(organizationId,code).first()){
    const suffix=`-${i++}`; code=`${preferred.slice(0,30-suffix.length)}${suffix}`;
  }
  return code;
}

export async function ensureAccount(db:D1Database,organizationId:string,input:{code:string;name:string;type:"asset"|"liability"|"revenue"|"expense";subtype:string;normalBalance:"debit"|"credit";currency?:string|null}){
  const existing=await db.prepare("SELECT id FROM accounts WHERE organization_id=? AND subtype=? AND name=? LIMIT 1").bind(organizationId,input.subtype,input.name).first<{id:string}>();
  if(existing)return existing.id;
  const id=createId("acc"), code=await nextAvailableAccountCode(db,organizationId,input.code);
  await db.prepare(`INSERT INTO accounts (id,organization_id,code,name,type,subtype,normal_balance,currency,allow_posting,active) VALUES (?,?,?,?,?,?,?,?,1,1)`)
    .bind(id,organizationId,code,input.name,input.type,input.subtype,input.normalBalance,input.currency??null).run();
  return id;
}

export async function ensureFeeAccounting(db:D1Database,organizationId:string):Promise<FeeAccounting>{
  const existing=await db.prepare(`SELECT receivable_account_id AS receivableAccountId,discount_account_id AS discountAccountId,scholarship_account_id AS scholarshipAccountId,writeoff_account_id AS writeoffAccountId,late_fee_income_account_id AS lateFeeIncomeAccountId,default_currency AS defaultCurrency,invoice_due_days AS invoiceDueDays,auto_post_invoices AS autoPostInvoices,auto_post_receipts AS autoPostReceipts FROM school_fee_accounting_settings WHERE organization_id=?`).bind(organizationId).first<FeeAccounting>();
  if(existing)return existing;
  const profile=await db.prepare("SELECT default_currency AS currency FROM school_profiles WHERE organization_id=?").bind(organizationId).first<{currency:string}>();
  const org=await db.prepare("SELECT base_currency AS currency FROM organizations WHERE id=?").bind(organizationId).first<{currency:string}>();
  const currency=profile?.currency||org?.currency||"UGX";
  const [receivable,discount,scholarship,writeoff,lateIncome]=await Promise.all([
    ensureAccount(db,organizationId,{code:"1105",name:"School Fees Receivable",type:"asset",subtype:"receivable",normalBalance:"debit",currency}),
    ensureAccount(db,organizationId,{code:"6115",name:"School Fee Discounts",type:"expense",subtype:"school_fee_discount",normalBalance:"debit",currency}),
    ensureAccount(db,organizationId,{code:"6120",name:"Scholarships & Bursaries",type:"expense",subtype:"scholarship",normalBalance:"debit",currency}),
    ensureAccount(db,organizationId,{code:"6130",name:"School Fee Bad Debts",type:"expense",subtype:"bad_debt",normalBalance:"debit",currency}),
    ensureAccount(db,organizationId,{code:"4210",name:"Late Fees & Penalties",type:"revenue",subtype:"school_fee",normalBalance:"credit",currency}),
  ]);
  await db.prepare(`INSERT INTO school_fee_accounting_settings (organization_id,receivable_account_id,discount_account_id,scholarship_account_id,writeoff_account_id,late_fee_income_account_id,default_currency) VALUES (?,?,?,?,?,?,?)`).bind(organizationId,receivable,discount,scholarship,writeoff,lateIncome,currency).run();
  return {receivableAccountId:receivable,discountAccountId:discount,scholarshipAccountId:scholarship,writeoffAccountId:writeoff,lateFeeIncomeAccountId:lateIncome,defaultCurrency:currency,invoiceDueDays:30,autoPostInvoices:1,autoPostReceipts:1};
}

export async function validateAccount(db:D1Database,organizationId:string,accountId:string,options?:{type?:string;subtype?:string}){
  const row=await db.prepare("SELECT type,subtype,active,allow_posting AS allowPosting FROM accounts WHERE id=? AND organization_id=?").bind(accountId,organizationId).first<{type:string;subtype:string|null;active:number;allowPosting:number}>();
  if(!row||!row.active||!row.allowPosting)throw new AppError(422,"INVALID_ACCOUNT","Select an active posting account that belongs to this school");
  if(options?.type&&row.type!==options.type)throw new AppError(422,"INVALID_ACCOUNT_TYPE",`The selected account must be a ${options.type} account`);
  if(options?.subtype&&row.subtype!==options.subtype)throw new AppError(422,"INVALID_ACCOUNT_SUBTYPE",`The selected account must use the ${options.subtype} subtype`);
  return row;
}

export async function nextNumber(db:D1Database,organizationId:string,key:"fee_invoice"|"fee_credit"|"fee_receipt"|"fee_batch"|"fee_plan"|"fee_refund"|"fee_writeoff",fallbackPrefix:string){
  const setting=await db.prepare("SELECT value_json AS value FROM school_settings WHERE organization_id=? AND setting_group='numbering' AND setting_key=?").bind(organizationId,`${key}_format`).first<{value:string}>();
  const config=parseJson<{prefix?:string;width?:number;year?:boolean}>(setting?.value,{});
  const prefix=String(config.prefix||fallbackPrefix), width=Math.max(3,Math.min(Number(config.width||6),12)), year=config.year===false?"":String(new Date().getUTCFullYear());
  const row=await db.prepare(`INSERT INTO school_number_sequences (organization_id,sequence_key,current_value,updated_at) VALUES (?,?,1,CURRENT_TIMESTAMP) ON CONFLICT(organization_id,sequence_key) DO UPDATE SET current_value=current_value+1,updated_at=CURRENT_TIMESTAMP RETURNING current_value AS value`).bind(organizationId,key).first<{value:number}>();
  return `${prefix}${year}${String(row?.value||1).padStart(width,"0")}`;
}

export async function requireStudent(db:D1Database,organizationId:string,studentId:string):Promise<StudentBillingRow>{
  const row=await db.prepare(`SELECT s.id,s.contact_id AS contactId,s.financial_sponsor_contact_id AS financialSponsorContactId,s.current_academic_year_id AS currentAcademicYearId,s.current_class_id AS currentClassId,s.current_stream_id AS currentStreamId,s.campus_id AS campusId,s.residency_status AS residencyStatus,s.student_category AS studentCategory,s.first_name AS firstName,s.middle_name AS middleName,s.last_name AS lastName,s.admission_number AS admissionNumber,s.student_number AS studentNumber,c.class_level_id AS classLevelId FROM school_students s LEFT JOIN school_classes c ON c.id=s.current_class_id AND c.organization_id=s.organization_id WHERE s.id=? AND s.organization_id=? AND s.deleted_at IS NULL`).bind(studentId,organizationId).first<StudentBillingRow>();
  if(!row)throw new AppError(404,"STUDENT_NOT_FOUND","Student not found");
  if(!row.contactId)throw new AppError(409,"STUDENT_ACCOUNT_NOT_READY","The student does not have a Ledgerly customer account. Re-save the student profile or contact an administrator.");
  return row;
}

export async function requirePayer(db:D1Database,organizationId:string,student:StudentBillingRow,explicit?:string|null){
  const contactId=explicit||student.financialSponsorContactId||student.contactId;
  if(!contactId)throw new AppError(422,"PAYER_REQUIRED","Select a parent, sponsor or student customer account to bill");
  const contact=await db.prepare("SELECT id,name,type,active FROM contacts WHERE id=? AND organization_id=? AND archived_at IS NULL").bind(contactId,organizationId).first<{id:string;name:string;type:string;active:number}>();
  if(!contact||contact.type!=="customer"||!contact.active)throw new AppError(422,"INVALID_PAYER","The fee payer must be an active Ledgerly customer contact");
  return contact;
}

export async function requireCategory(db:D1Database,organizationId:string,categoryId:string):Promise<FeeCategoryRow>{
  const row=await db.prepare(`SELECT id,code,name,income_account_id AS incomeAccountId,receivable_account_id AS receivableAccountId,product_id AS productId,taxable,tax_code AS taxCode,refundable,mandatory,active FROM school_fee_categories WHERE id=? AND organization_id=?`).bind(categoryId,organizationId).first<FeeCategoryRow>();
  if(!row||!row.active)throw new AppError(422,"INVALID_FEE_CATEGORY","Select an active school fee category");
  return row;
}

export async function provisionCategory(db:D1Database,organizationId:string,categoryId:string){
  const accounting=await ensureFeeAccounting(db,organizationId), category=await requireCategory(db,organizationId,categoryId);
  let incomeAccountId=category.incomeAccountId;
  if(!incomeAccountId)incomeAccountId=await ensureAccount(db,organizationId,{code:`42-${safeCode(category.code)}`,name:`${category.name} Revenue`,type:"revenue",subtype:"school_fee",normalBalance:"credit",currency:accounting.defaultCurrency});
  else await validateAccount(db,organizationId,incomeAccountId,{type:"revenue"});
  let productId=category.productId;
  if(!productId){
    productId=createId("prd");
    let sku=`FEE-${safeCode(category.code)}`.slice(0,60), n=1;
    while(await db.prepare("SELECT 1 FROM products WHERE organization_id=? AND sku=?").bind(organizationId,sku).first()) sku=`FEE-${safeCode(category.code).slice(0,48)}-${n++}`.slice(0,60);
    await db.prepare("INSERT INTO products (id,organization_id,sku,name,type,income_account_id,active) VALUES (?,?,?,?,'service',?,1)").bind(productId,organizationId,sku,category.name,incomeAccountId).run();
  }
  await db.prepare("UPDATE school_fee_categories SET income_account_id=?,receivable_account_id=?,product_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(incomeAccountId,accounting.receivableAccountId,productId,categoryId,organizationId).run();
  return {...category,incomeAccountId,receivableAccountId:accounting.receivableAccountId,productId,accounting};
}

export async function resolveStructure(db:D1Database,organizationId:string,student:StudentBillingRow,academicYearId:string,termId?:string|null,explicitStructureId?:string|null){
  if(explicitStructureId){
    const row=await db.prepare("SELECT * FROM school_fee_structures WHERE id=? AND organization_id=? AND status='active'").bind(explicitStructureId,organizationId).first<Record<string,unknown>>();
    if(!row)throw new AppError(422,"INVALID_FEE_STRUCTURE","The selected fee structure is not active");
    return row;
  }
  const rows=await db.prepare(`SELECT * FROM school_fee_structures WHERE organization_id=? AND academic_year_id=? AND status='active' AND (term_id IS NULL OR term_id=?) AND (campus_id IS NULL OR campus_id=?) AND (class_level_id IS NULL OR class_level_id=?) AND (class_id IS NULL OR class_id=?) AND (stream_id IS NULL OR stream_id=?) AND (residency_status IS NULL OR residency_status=?) AND (student_category IS NULL OR student_category=?) ORDER BY (term_id IS NOT NULL)+(campus_id IS NOT NULL)+(class_level_id IS NOT NULL)+(class_id IS NOT NULL)+(stream_id IS NOT NULL)+(residency_status IS NOT NULL)+(student_category IS NOT NULL) DESC,priority ASC,created_at DESC LIMIT 1`).bind(organizationId,academicYearId,termId??null,student.campusId,student.classLevelId,student.currentClassId,student.currentStreamId,student.residencyStatus,student.studentCategory).all<Record<string,unknown>>();
  const row=rows.results[0];
  if(!row)throw new AppError(422,"FEE_STRUCTURE_NOT_FOUND",`No active fee structure matches ${fullName(student)} for the selected academic period`);
  return row;
}

export async function siblingCount(db:D1Database,organizationId:string,studentId:string){
  const row=await db.prepare(`SELECT COUNT(DISTINCT sg2.student_id) AS count FROM school_student_guardians sg1 JOIN school_student_guardians sg2 ON sg2.organization_id=sg1.organization_id AND sg2.guardian_id=sg1.guardian_id JOIN school_students s ON s.id=sg2.student_id AND s.organization_id=sg2.organization_id AND s.deleted_at IS NULL AND s.status='active' WHERE sg1.organization_id=? AND sg1.student_id=?`).bind(organizationId,studentId).first<{count:number}>();
  return Math.max(1,Number(row?.count||1));
}

function calcAmount(calculationType:string,amountMinor:number|null,rateMicros:number|null,grossMinor:number,maxAmountMinor:number|null){
  let amount=calculationType==="fixed"?Number(amountMinor||0):Math.round(grossMinor*Number(rateMicros||0)/100_000_000);
  if(maxAmountMinor!=null)amount=Math.min(amount,Number(maxAmountMinor));
  return Math.max(0,Math.min(grossMinor,amount));
}

export async function computeAdjustments(db:D1Database,organizationId:string,student:StudentBillingRow,input:{academicYearId:string;termId?:string|null;feeCategoryId:string;grossMinor:number;discountable:boolean;chargeDate:string}){
  if(!input.discountable||input.grossMinor<=0)return [] as FeeAdjustment[];
  const adjustments:FeeAdjustment[]=[];
  const awards=await db.prepare(`SELECT a.*,s.accounting_treatment AS scheme_accounting_treatment,s.expense_account_id AS scheme_expense_account_id,s.name AS scheme_name FROM school_student_fee_awards a LEFT JOIN school_fee_discount_schemes s ON s.id=a.scheme_id AND s.organization_id=a.organization_id WHERE a.organization_id=? AND a.student_id=? AND a.status='approved' AND (a.academic_year_id IS NULL OR a.academic_year_id=?) AND (a.term_id IS NULL OR a.term_id=?) AND (a.fee_category_id IS NULL OR a.fee_category_id=?) AND (a.starts_on IS NULL OR a.starts_on<=?) AND (a.ends_on IS NULL OR a.ends_on>=?) ORDER BY a.created_at`).bind(organizationId,student.id,input.academicYearId,input.termId??null,input.feeCategoryId,input.chargeDate,input.chargeDate).all<any>();
  let remaining=input.grossMinor;
  for(const a of awards.results){
    const amount=Math.min(remaining,calcAmount(a.calculation_type,a.amount_minor,a.rate_micros,input.grossMinor,a.max_amount_minor)); if(amount<=0)continue;
    const type=(a.award_type==="sponsorship"?"scholarship":a.award_type) as FeeAdjustment["type"];
    adjustments.push({awardId:a.id,schemeId:a.scheme_id??undefined,type,amountMinor:amount,reason:a.notes||a.scheme_name||a.award_type,accountingTreatment:a.scheme_accounting_treatment||"net_revenue",accountId:a.scheme_expense_account_id??null}); remaining-=amount; if(remaining<=0)break;
  }
  if(remaining<=0)return adjustments;
  const siblings=await siblingCount(db,organizationId,student.id);
  const schemes=await db.prepare(`SELECT * FROM school_fee_discount_schemes WHERE organization_id=? AND active=1 AND (academic_year_id IS NULL OR academic_year_id=?) AND (term_id IS NULL OR term_id=?) AND (fee_category_id IS NULL OR fee_category_id=?) AND (campus_id IS NULL OR campus_id=?) AND (class_level_id IS NULL OR class_level_id=?) AND (class_id IS NULL OR class_id=?) AND (residency_status IS NULL OR residency_status=?) AND (student_category IS NULL OR student_category=?) AND (starts_on IS NULL OR starts_on<=?) AND (ends_on IS NULL OR ends_on>=?) AND (sibling_min_count IS NULL OR sibling_min_count<=?) AND approval_required=0 ORDER BY priority,created_at`).bind(organizationId,input.academicYearId,input.termId??null,input.feeCategoryId,student.campusId,student.classLevelId,student.currentClassId,student.residencyStatus,student.studentCategory,input.chargeDate,input.chargeDate,siblings).all<any>();
  for(const s of schemes.results){
    const amount=Math.min(remaining,calcAmount(s.calculation_type,s.amount_minor,s.rate_micros,input.grossMinor,s.max_amount_minor));if(amount<=0)continue;
    adjustments.push({schemeId:s.id,type:s.category as FeeAdjustment["type"],amountMinor:amount,reason:s.name,accountingTreatment:s.accounting_treatment,accountId:s.expense_account_id??null});remaining-=amount;if(!s.stackable||remaining<=0)break;
  }
  return adjustments;
}

export function adjustmentBuckets(adjustments:FeeAdjustment[]){
  let discount=0,scholarship=0,waiver=0;
  for(const a of adjustments){if(["scholarship","bursary"].includes(a.type))scholarship+=a.amountMinor;else if(a.type==="waiver")waiver+=a.amountMinor;else discount+=a.amountMinor;}
  return {discountMinor:discount,scholarshipMinor:scholarship,waiverMinor:waiver,totalAdjustmentMinor:discount+scholarship+waiver};
}

export async function reclassifyExpenseAdjustments(db:D1Database,organizationId:string,actorId:string,chargeId:string,incomeAccountId:string,currency:string,chargeDate:string,student:StudentBillingRow,adjustments:FeeAdjustment[]){
  for(let i=0;i<adjustments.length;i++){
    const a=adjustments[i]; if(a.accountingTreatment!=="expense"||a.amountMinor<=0)continue;
    const defaults=await ensureFeeAccounting(db,organizationId);
    const expenseAccountId=a.accountId||(a.type==="scholarship"||a.type==="bursary"?defaults.scholarshipAccountId:defaults.discountAccountId);
    if(!expenseAccountId)throw new AppError(422,"ADJUSTMENT_ACCOUNT_REQUIRED",`Configure an expense account for ${a.type.replaceAll("_"," ")}`);
    const j=await createJournal(db,organizationId,actorId,{transactionDate:chargeDate,postingDate:chargeDate,description:`Fee ${a.type.replaceAll("_"," ")} — ${fullName(student)}`,reference:chargeId,currency,sourceType:"school_fee_adjustment",sourceId:chargeId,lines:[{accountId:expenseAccountId,debitMinor:a.amountMinor,contactId:student.contactId??undefined,dimensions:{schoolStudentId:student.id,schoolAcademicYearId:student.currentAcademicYearId,schoolClassId:student.currentClassId}},{accountId:incomeAccountId,creditMinor:a.amountMinor,contactId:student.contactId??undefined,dimensions:{schoolStudentId:student.id,schoolAcademicYearId:student.currentAcademicYearId,schoolClassId:student.currentClassId}}]},`school-fee-adjustment:${chargeId}:${i}`);
    const state=await db.prepare("SELECT status FROM journal_entries WHERE id=? AND organization_id=?").bind(j.id,organizationId).first<{status:string}>();if(state?.status==="draft")await postJournal(db,organizationId,actorId,j.id);
    await db.prepare("UPDATE school_fee_charge_adjustments SET journal_entry_id=? WHERE charge_id=? AND organization_id=? AND status='applied' AND journal_entry_id IS NULL AND adjustment_type=? AND amount_minor=? LIMIT 1").bind(j.id,chargeId,organizationId,a.type,a.amountMinor).run();
  }
}

export async function createChargeAndInvoice(db:D1Database,organizationId:string,actorId:string,input:{student:StudentBillingRow;payerContactId:string;academicYearId?:string|null;termId?:string|null;feeCategoryId:string;structureLineId?:string|null;billingBatchId?:string|null;parentChargeId?:string|null;description:string;quantityMicros:number;grossMinor:number;taxMinor?:number;taxAccountId?:string|null;chargeDate:string;dueDate?:string|null;source:"structure"|"manual"|"opening_balance"|"late_fee"|"adjustment"|"import";currency:string;adjustments?:FeeAdjustment[];metadata?:Record<string,unknown>;autoPost?:boolean;chargeId?:string}){
  const category=await provisionCategory(db,organizationId,input.feeCategoryId), accounting=category.accounting, adjustments=input.adjustments||[], buckets=adjustmentBuckets(adjustments), netSubtotal=Math.max(0,input.grossMinor-buckets.totalAdjustmentMinor), totalMinor=netSubtotal+Number(input.taxMinor||0), chargeId=input.chargeId||createId("sfc");
  if(input.taxMinor&& !input.taxAccountId)throw new AppError(422,"TAX_ACCOUNT_REQUIRED","A tax account is required for taxed school fee charges");
  if(totalMinor===0){
    await db.prepare(`INSERT INTO school_student_fee_charges (id,organization_id,student_id,payer_contact_id,academic_year_id,term_id,campus_id,class_id,stream_id,fee_category_id,structure_line_id,billing_batch_id,parent_charge_id,description,quantity_micros,gross_minor,discount_minor,scholarship_minor,waiver_minor,tax_minor,total_minor,currency,charge_date,due_date,source,status,metadata_json,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'waived',?,?)`).bind(chargeId,organizationId,input.student.id,input.payerContactId,input.academicYearId??null,input.termId??null,input.student.campusId,input.student.currentClassId,input.student.currentStreamId,input.feeCategoryId,input.structureLineId??null,input.billingBatchId??null,input.parentChargeId??null,input.description,input.quantityMicros,input.grossMinor,buckets.discountMinor,buckets.scholarshipMinor,buckets.waiverMinor,input.taxMinor||0,totalMinor,input.currency,input.chargeDate,input.dueDate??null,input.source,JSON.stringify(input.metadata||{}),actorId).run();
    for(const a of adjustments)await db.prepare(`INSERT INTO school_fee_charge_adjustments (id,organization_id,charge_id,student_id,award_id,scheme_id,adjustment_type,amount_minor,reason,accounting_treatment,account_id,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(createId("sfa"),organizationId,chargeId,input.student.id,a.awardId??null,a.schemeId??null,a.type,a.amountMinor,a.reason,a.accountingTreatment,a.accountId??null,actorId).run();
    return {chargeId,documentId:null,invoiceNumber:null,totalMinor,status:"waived"};
  }
  const invoiceNumber=await nextNumber(db,organizationId,"fee_invoice","SINV-"), document=await createDocument(db,organizationId,actorId,{type:"invoice",number:invoiceNumber,contactId:input.payerContactId,issueDate:input.chargeDate,dueDate:input.dueDate||addDays(input.chargeDate,accounting.invoiceDueDays),currency:input.currency,customFields:{schoolFee:true,studentId:input.student.id,academicYearId:input.academicYearId,termId:input.termId,feeCategoryId:input.feeCategoryId,chargeId},lines:[{productId:category.productId??undefined,accountId:category.incomeAccountId!,taxAccountId:input.taxAccountId??undefined,description:input.description,quantityMicros:1_000_000,unitPriceMinor:netSubtotal,taxMinor:input.taxMinor||0,dimensions:{schoolStudentId:input.student.id,schoolAcademicYearId:input.academicYearId??null,schoolTermId:input.termId??null,schoolCampusId:input.student.campusId,schoolClassId:input.student.currentClassId,schoolStreamId:input.student.currentStreamId,schoolFeeCategoryId:input.feeCategoryId}}]});
  await db.prepare(`INSERT INTO school_student_fee_charges (id,organization_id,student_id,payer_contact_id,academic_year_id,term_id,campus_id,class_id,stream_id,fee_category_id,structure_line_id,billing_batch_id,parent_charge_id,description,quantity_micros,gross_minor,discount_minor,scholarship_minor,waiver_minor,tax_minor,total_minor,currency,charge_date,due_date,source,status,document_id,metadata_json,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?)`).bind(chargeId,organizationId,input.student.id,input.payerContactId,input.academicYearId??null,input.termId??null,input.student.campusId,input.student.currentClassId,input.student.currentStreamId,input.feeCategoryId,input.structureLineId??null,input.billingBatchId??null,input.parentChargeId??null,input.description,input.quantityMicros,input.grossMinor,buckets.discountMinor,buckets.scholarshipMinor,buckets.waiverMinor,input.taxMinor||0,totalMinor,input.currency,input.chargeDate,input.dueDate??null,input.source,document.id,JSON.stringify(input.metadata||{}),actorId).run();
  for(const a of adjustments)await db.prepare(`INSERT INTO school_fee_charge_adjustments (id,organization_id,charge_id,student_id,award_id,scheme_id,adjustment_type,amount_minor,reason,accounting_treatment,account_id,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(createId("sfa"),organizationId,chargeId,input.student.id,a.awardId??null,a.schemeId??null,a.type,a.amountMinor,a.reason,a.accountingTreatment,a.accountId??null,actorId).run();
  const autoPost=input.autoPost??Boolean(accounting.autoPostInvoices);
  if(autoPost){await postDocument(db,organizationId,actorId,document.id,accounting.receivableAccountId);await db.prepare("UPDATE school_student_fee_charges SET status='invoiced',updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(chargeId,organizationId).run();await reclassifyExpenseAdjustments(db,organizationId,actorId,chargeId,category.incomeAccountId!,input.currency,input.chargeDate,input.student,adjustments);}
  return {chargeId,documentId:document.id,invoiceNumber,totalMinor,status:autoPost?"invoiced":"draft"};
}

export type BillingGuardKey={studentId:string;structureLineId:string;academicYearId:string;termId?:string|null};
export function billingTermKey(termId?:string|null){return termId||"";}
export async function claimBillingGuard(db:D1Database,organizationId:string,key:BillingGuardKey,chargeId:string){
  const termKey=billingTermKey(key.termId);
  const selectGuard=()=>db.prepare(`SELECT g.charge_id AS chargeId,c.status,c.total_minor AS totalMinor,d.number AS invoiceNumber
    FROM school_fee_billing_guards g
    LEFT JOIN school_student_fee_charges c ON c.id=g.charge_id AND c.organization_id=g.organization_id
    LEFT JOIN documents d ON d.id=c.document_id AND d.organization_id=c.organization_id
    WHERE g.organization_id=? AND g.student_id=? AND g.structure_line_id=? AND g.academic_year_id=? AND g.term_key=?`)
    .bind(organizationId,key.studentId,key.structureLineId,key.academicYearId,termKey).first<any>();
  const deleteStale=(staleChargeId:string)=>db.prepare(`DELETE FROM school_fee_billing_guards
    WHERE organization_id=? AND student_id=? AND structure_line_id=? AND academic_year_id=? AND term_key=? AND charge_id=?`)
    .bind(organizationId,key.studentId,key.structureLineId,key.academicYearId,termKey,staleChargeId).run();

  let existing=await selectGuard();
  // A request can fail after claiming the unique guard but before inserting the
  // charge. Such a row must not block the learner forever; repair it lazily.
  if(existing && existing.status==null){await deleteStale(existing.chargeId);existing=null;}
  if(existing)return {claimed:false,existing};

  try{
    await db.prepare(`INSERT INTO school_fee_billing_guards (organization_id,student_id,structure_line_id,academic_year_id,term_key,charge_id) VALUES (?,?,?,?,?,?)`)
      .bind(organizationId,key.studentId,key.structureLineId,key.academicYearId,termKey,chargeId).run();
    return {claimed:true,existing:null};
  }catch(error){
    let raced=await selectGuard();
    if(raced && raced.status==null){
      await deleteStale(raced.chargeId);
      try{
        await db.prepare(`INSERT INTO school_fee_billing_guards (organization_id,student_id,structure_line_id,academic_year_id,term_key,charge_id) VALUES (?,?,?,?,?,?)`)
          .bind(organizationId,key.studentId,key.structureLineId,key.academicYearId,termKey,chargeId).run();
        return {claimed:true,existing:null};
      }catch{/* another concurrent request reclaimed it; resolve below */}
      raced=await selectGuard();
    }
    if(raced)return {claimed:false,existing:raced};
    throw error;
  }
}
export async function releaseBillingGuard(db:D1Database,organizationId:string,chargeId:string){
  const key=await db.prepare(`SELECT organization_id AS organizationId,student_id AS studentId,structure_line_id AS structureLineId,academic_year_id AS academicYearId,term_key AS termKey FROM school_fee_billing_guards WHERE organization_id=? AND charge_id=?`).bind(organizationId,chargeId).first<any>();
  if(!key)return;
  await db.prepare("DELETE FROM school_fee_billing_guards WHERE organization_id=? AND charge_id=?").bind(organizationId,chargeId).run();
  const replacement=await db.prepare(`SELECT id FROM school_student_fee_charges WHERE organization_id=? AND student_id=? AND structure_line_id=? AND academic_year_id=? AND COALESCE(term_id,'')=? AND status<>'cancelled' ORDER BY created_at,id LIMIT 1`)
    .bind(organizationId,key.studentId,key.structureLineId,key.academicYearId,key.termKey).first<{id:string}>();
  if(replacement)await db.prepare(`INSERT OR IGNORE INTO school_fee_billing_guards (organization_id,student_id,structure_line_id,academic_year_id,term_key,charge_id) VALUES (?,?,?,?,?,?)`).bind(organizationId,key.studentId,key.structureLineId,key.academicYearId,key.termKey,replacement.id).run();
}

export async function postSchoolFeeCharge(db:D1Database,organizationId:string,actorId:string,chargeId:string){
  const row=await db.prepare(`SELECT c.*,fc.income_account_id AS incomeAccountId,d.status AS documentStatus
    FROM school_student_fee_charges c
    JOIN school_fee_categories fc ON fc.id=c.fee_category_id AND fc.organization_id=c.organization_id
    LEFT JOIN documents d ON d.id=c.document_id AND d.organization_id=c.organization_id
    WHERE c.id=? AND c.organization_id=?`).bind(chargeId,organizationId).first<any>();
  if(!row)throw new AppError(404,"FEE_CHARGE_NOT_FOUND","School fee charge not found");
  if(row.status!=="draft"){
    if(POSTED_FEE_CHARGE_STATUSES.includes(row.status))return {chargeId,status:row.status,documentId:row.document_id};
    throw new AppError(409,"INVALID_STATE","Only a draft fee charge can be posted");
  }
  if(!row.document_id||row.documentStatus!=="draft")throw new AppError(409,"FEE_INVOICE_NOT_DRAFT","The linked Ledgerly invoice is not available as a draft");
  const accounting=await ensureFeeAccounting(db,organizationId);
  const posted=await postDocument(db,organizationId,actorId,row.document_id,accounting.receivableAccountId);
  await db.prepare("UPDATE school_student_fee_charges SET status='invoiced',updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND status='draft'").bind(chargeId,organizationId).run();
  const student=await requireStudent(db,organizationId,row.student_id);
  const raw=await db.prepare(`SELECT award_id AS awardId,scheme_id AS schemeId,adjustment_type AS type,amount_minor AS amountMinor,reason,accounting_treatment AS accountingTreatment,account_id AS accountId FROM school_fee_charge_adjustments WHERE organization_id=? AND charge_id=? AND status='applied'`).bind(organizationId,chargeId).all<any>();
  await reclassifyExpenseAdjustments(db,organizationId,actorId,chargeId,row.incomeAccountId,row.currency,row.charge_date,student,raw.results as FeeAdjustment[]);
  return {chargeId,status:"invoiced",documentId:row.document_id,journalEntryId:posted.journalEntryId};
}

export const POSTED_FEE_CHARGE_STATUSES=["invoiced","partially_settled","settled","credited","written_off"] as const;
export const postedFeeChargeSql=(alias="c")=>`${alias}.status IN ('invoiced','partially_settled','settled','credited','written_off')`;

export async function studentBalance(db:D1Database,organizationId:string,studentId:string,academicYearId?:string|null,termId?:string|null){
  const filters=["c.organization_id=?","c.student_id=?",postedFeeChargeSql("c"),"d.status IN ('open','partially_paid','paid')"];const bind:any[]=[organizationId,studentId];
  if(academicYearId){filters.push("c.academic_year_id=?");bind.push(academicYearId)}if(termId){filters.push("c.term_id=?");bind.push(termId)}
  const where=filters.join(" AND ");
  const totals=await db.prepare(`SELECT COALESCE(SUM(c.gross_minor),0) AS grossMinor,COALESCE(SUM(c.discount_minor+c.scholarship_minor+c.waiver_minor),0) AS adjustmentsMinor,COALESCE(SUM(c.total_minor),0) AS billedMinor,COALESCE(SUM(c.credited_minor),0) AS creditedMinor,COALESCE(SUM(c.written_off_minor),0) AS writtenOffMinor FROM school_student_fee_charges c JOIN documents d ON d.id=c.document_id AND d.organization_id=c.organization_id WHERE ${where}`).bind(...bind).first<any>();
  const paid=await db.prepare(`SELECT COALESCE(SUM(pa.amount_minor),0) AS paidMinor FROM payment_allocations pa JOIN documents d ON d.id=pa.document_id AND d.organization_id=pa.organization_id JOIN school_student_fee_charges c ON c.document_id=d.id AND c.organization_id=d.organization_id WHERE pa.reversed_at IS NULL AND ${where}`).bind(...bind).first<any>();
  const billed=Number(totals?.billedMinor||0), credited=Number(totals?.creditedMinor||0), writtenOff=Number(totals?.writtenOffMinor||0), paidMinor=Number(paid?.paidMinor||0);
  return {...totals,paidMinor,balanceMinor:Math.max(0,billed-credited-writtenOff-paidMinor)};
}

export async function payerCreditBalance(db:D1Database,organizationId:string,payerContactId:string){
  const paid=await db.prepare("SELECT COALESCE(SUM(amount_minor),0) AS amount FROM payments WHERE organization_id=? AND contact_id=? AND type='receipt' AND status='posted'").bind(organizationId,payerContactId).first<{amount:number}>();
  const allocated=await db.prepare(`SELECT COALESCE(SUM(pa.amount_minor),0) AS amount FROM payment_allocations pa JOIN payments p ON p.id=pa.payment_id AND p.organization_id=pa.organization_id WHERE pa.organization_id=? AND p.contact_id=? AND p.type='receipt' AND p.status='posted' AND pa.reversed_at IS NULL`).bind(organizationId,payerContactId).first<{amount:number}>();
  const refunds=await db.prepare("SELECT COALESCE(SUM(amount_minor),0) AS amount FROM school_fee_refunds WHERE organization_id=? AND payer_contact_id=? AND status='posted'").bind(organizationId,payerContactId).first<{amount:number}>();
  return Math.max(0,Number(paid?.amount||0)-Number(allocated?.amount||0)-Number(refunds?.amount||0));
}

export async function oldestOpenAllocations(db:D1Database,organizationId:string,payerContactId:string,currency:string,amountMinor:number,studentIds?:string[]){
  const filters=["d.organization_id=?","d.contact_id=?","d.currency=?","d.type='invoice'","d.status IN ('open','partially_paid')","c.status IN ('invoiced','partially_settled')"];const bind:any[]=[organizationId,payerContactId,currency];
  if(studentIds?.length){filters.push(`c.student_id IN (${studentIds.map(()=>"?").join(",")})`);bind.push(...studentIds)}
  const rows=await db.prepare(`SELECT d.id,d.total_minor-d.paid_minor AS outstandingMinor FROM documents d JOIN school_student_fee_charges c ON c.document_id=d.id AND c.organization_id=d.organization_id WHERE ${filters.join(" AND ")} ORDER BY COALESCE(d.due_date,d.issue_date),d.issue_date,d.created_at`).bind(...bind).all<{id:string;outstandingMinor:number}>();
  let remaining=amountMinor;const out:{documentId:string;amountMinor:number}[]=[];for(const r of rows.results){if(remaining<=0)break;const amount=Math.min(remaining,Number(r.outstandingMinor));if(amount>0){out.push({documentId:r.id,amountMinor:amount});remaining-=amount}}
  return out;
}
