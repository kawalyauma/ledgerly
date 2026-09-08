import type { MobileSyncRecord, MobileSyncSnapshotContext } from "../../mobile-sync/backend/contracts";

type Row = Record<string, any> & { id: string; updatedAt?: string; createdAt?: string };
function records(rows: Row[]): MobileSyncRecord[] {
  return rows.map(row => ({ id: row.id, version: 1, updatedAt: row.updatedAt || row.createdAt || new Date(0).toISOString(), payload: row }));
}
async function all(context: MobileSyncSnapshotContext, sql: string) {
  const result = await context.db.prepare(sql).bind(context.organizationId).all<Row>();
  return records(result.results);
}

export const snapshotAccounts = (c:MobileSyncSnapshotContext) => all(c, `SELECT id,code,name,type,subtype,normal_balance AS normalBalance,currency,allow_posting AS allowPosting,active,parent_account_id AS parentAccountId,account_group_id AS accountGroupId,created_at AS createdAt,updated_at AS updatedAt FROM accounts WHERE organization_id=? ORDER BY code`);
export const snapshotDimensions = (c:MobileSyncSnapshotContext) => all(c, `SELECT id,type,code,name,active,created_at AS createdAt,updated_at AS updatedAt FROM dimensions WHERE organization_id=? ORDER BY type,code`);
export const snapshotProducts = (c:MobileSyncSnapshotContext) => all(c, `SELECT id,sku,name,type,income_account_id AS incomeAccountId,expense_account_id AS expenseAccountId,inventory_account_id AS inventoryAccountId,quantity_on_hand_micros AS quantityOnHandMicros,average_cost_minor AS averageCostMinor,reorder_point_micros AS reorderPointMicros,active,created_at AS createdAt,updated_at AS updatedAt FROM products WHERE organization_id=? ORDER BY name`);
export const snapshotProjects = (c:MobileSyncSnapshotContext) => all(c, `SELECT id,customer_id AS customerId,code,name,status,budget_amount_minor AS budgetAmountMinor,created_at AS createdAt,updated_at AS updatedAt FROM projects WHERE organization_id=? ORDER BY code`);
export const snapshotPeriods = (c:MobileSyncSnapshotContext) => all(c, `SELECT id,name,starts_on AS startsOn,ends_on AS endsOn,status,locked_at AS lockedAt,locked_by AS lockedBy,created_at AS createdAt,updated_at AS updatedAt FROM fiscal_periods WHERE organization_id=? ORDER BY starts_on DESC`);
export const snapshotBankAccounts = (c:MobileSyncSnapshotContext) => all(c, `SELECT id,ledger_account_id AS ledgerAccountId,name,bank_name AS bankName,account_number_masked AS accountNumberMasked,currency,opening_balance_minor AS openingBalanceMinor,active,created_at AS createdAt,updated_at AS updatedAt FROM bank_accounts WHERE organization_id=? ORDER BY name`);
export const snapshotDocuments = (c:MobileSyncSnapshotContext) => all(c, `SELECT id,type,number,contact_id AS contactId,issue_date AS issueDate,due_date AS dueDate,status,currency,subtotal_minor AS subtotalMinor,tax_minor AS taxMinor,total_minor AS totalMinor,paid_minor AS paidMinor,journal_entry_id AS journalEntryId,approval_status AS approvalStatus,custom_fields AS customFields,created_at AS createdAt,updated_at AS updatedAt FROM documents WHERE organization_id=? ORDER BY issue_date DESC,created_at DESC`);
export const snapshotDocumentLines = (c:MobileSyncSnapshotContext) => all(c, `SELECT id,document_id AS documentId,product_id AS productId,account_id AS accountId,tax_account_id AS taxAccountId,description,quantity_micros AS quantityMicros,unit_price_minor AS unitPriceMinor,subtotal_minor AS subtotalMinor,tax_minor AS taxMinor,total_minor AS totalMinor,project_id AS projectId,class_id AS classId,department_id AS departmentId,location_id AS locationId,dimensions_json AS dimensionsJson,created_at AS createdAt,updated_at AS updatedAt FROM document_lines WHERE organization_id=? ORDER BY created_at,id`);
export const snapshotJournals = (c:MobileSyncSnapshotContext) => all(c, `SELECT id,entry_number AS entryNumber,transaction_date AS transactionDate,posting_date AS postingDate,description,reference,source_type AS sourceType,source_id AS sourceId,status,currency,exchange_rate_micros AS exchangeRateMicros,reversal_of_id AS reversalOfId,posted_at AS postedAt,posted_by AS postedBy,metadata,created_at AS createdAt,updated_at AS updatedAt FROM journal_entries WHERE organization_id=? ORDER BY posting_date DESC,created_at DESC`);
export const snapshotJournalLines = (c:MobileSyncSnapshotContext) => all(c, `SELECT id,journal_entry_id AS journalEntryId,account_id AS accountId,description,debit_minor AS debitMinor,credit_minor AS creditMinor,base_debit_minor AS baseDebitMinor,base_credit_minor AS baseCreditMinor,contact_id AS contactId,project_id AS projectId,class_id AS classId,department_id AS departmentId,location_id AS locationId,tax_code AS taxCode,dimensions_json AS dimensionsJson,created_at AS createdAt,updated_at AS updatedAt FROM journal_lines WHERE organization_id=? ORDER BY created_at,id`);

export async function snapshotDocumentIntents(c:MobileSyncSnapshotContext){
  const result=await c.db.prepare(`SELECT id,intent_type AS intentType,status,server_document_id AS serverDocumentId,error_code AS errorCode,error_message AS errorMessage,attempts,client_created_at AS clientCreatedAt,created_at AS createdAt,updated_at AS updatedAt FROM ledgerly_mobile_document_intents WHERE organization_id=? AND created_by=? ORDER BY created_at DESC`).bind(c.organizationId,c.userId).all<Row>();
  return records(result.results);
}
export async function snapshotJournalIntents(c:MobileSyncSnapshotContext){
  const result=await c.db.prepare(`SELECT id,status,server_journal_id AS serverJournalId,error_code AS errorCode,error_message AS errorMessage,attempts,client_created_at AS clientCreatedAt,created_at AS createdAt,updated_at AS updatedAt FROM ledgerly_mobile_journal_intents WHERE organization_id=? AND created_by=? ORDER BY created_at DESC`).bind(c.organizationId,c.userId).all<Row>();
  return records(result.results);
}
