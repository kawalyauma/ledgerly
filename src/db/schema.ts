import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
};

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  baseCurrency: text("base_currency").notNull().default("UGX"),
  timezone: text("timezone").notNull().default("Africa/Kampala"),
  fiscalYearStartMonth: integer("fiscal_year_start_month").notNull().default(1),
  addressJson:text("address_json").notNull().default("{}"),
  taxRegistrationNumber:text("tax_registration_number"),
  documentNumberingJson:text("document_numbering_json").notNull().default("{}"),
  brandingJson:text("branding_json").notNull().default("{}"),
  status: text("status", { enum: ["active", "suspended"] }).notNull().default("active"),
  ...timestamps,
});

export const fiscalPeriods = sqliteTable("fiscal_periods", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  startsOn: text("starts_on").notNull(),
  endsOn: text("ends_on").notNull(),
  status: text("status", { enum: ["open", "soft_closed", "locked"] }).notNull().default("open"),
  lockedAt: text("locked_at"),
  lockedBy: text("locked_by"),
  ...timestamps,
}, (t) => [
  uniqueIndex("fiscal_periods_org_dates_uq").on(t.organizationId, t.startsOn, t.endsOn),
  index("fiscal_periods_org_range_idx").on(t.organizationId, t.startsOn, t.endsOn),
]);

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash"),
  emailVerifiedAt: text("email_verified_at"),
  status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
  ...timestamps,
}, (t) => [uniqueIndex("users_email_uq").on(t.email)]);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(), userId: text("user_id").notNull().references(() => users.id),
  organizationId: text("organization_id").notNull().references(() => organizations.id), refreshTokenHash: text("refresh_token_hash").notNull(),
  expiresAt: text("expires_at").notNull(), revokedAt: text("revoked_at"), ipAddress: text("ip_address"), userAgent: text("user_agent"), ...timestamps,
}, (t) => [uniqueIndex("sessions_refresh_hash_uq").on(t.refreshTokenHash), index("sessions_user_idx").on(t.userId, t.expiresAt)]);

export const memberships = sqliteTable("memberships", {
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  userId: text("user_id").notNull().references(() => users.id),
  role: text("role", { enum: ["owner", "admin", "accountant", "manager", "viewer", "integration"] }).notNull(),
  scopes: text("scopes").notNull().default("[]"),
  ...timestamps,
}, (t) => [primaryKey({ columns: [t.organizationId, t.userId] })]);

export const dimensions = sqliteTable("dimensions", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  type: text("type", { enum: ["class", "department", "location"] }).notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
}, (t) => [uniqueIndex("dimensions_org_type_code_uq").on(t.organizationId, t.type, t.code)]);

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  type: text("type", { enum: ["asset", "liability", "equity", "revenue", "expense"] }).notNull(),
  subtype: text("subtype"),
  normalBalance: text("normal_balance", { enum: ["debit", "credit"] }).notNull(),
  currency: text("currency"),
  allowPosting: integer("allow_posting", { mode: "boolean" }).notNull().default(true),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  parentAccountId:text("parent_account_id"),
  accountGroupId:text("account_group_id"),
  ...timestamps,
}, (t) => [
  uniqueIndex("accounts_org_code_uq").on(t.organizationId, t.code),
  index("accounts_org_type_idx").on(t.organizationId, t.type),
]);

export const contacts = sqliteTable("contacts", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  type: text("type", { enum: ["customer", "supplier", "employee", "other"] }).notNull(),
  code: text("code"),
  name: text("name").notNull(),
  email: text("email"),
  taxNumber: text("tax_number"),
  paymentTermsDays: integer("payment_terms_days").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  customFields: text("custom_fields").notNull().default("{}"),
  creditLimitMinor:integer("credit_limit_minor").notNull().default(0),
  pricingTier:text("pricing_tier"),
  archivedAt:text("archived_at"),
  ...timestamps,
}, (t) => [index("contacts_org_type_idx").on(t.organizationId, t.type)]);

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  customerId: text("customer_id").references(() => contacts.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  status: text("status", { enum: ["planned", "active", "completed", "cancelled"] }).notNull().default("active"),
  budgetAmountMinor: integer("budget_amount_minor").notNull().default(0),
  ...timestamps,
}, (t) => [uniqueIndex("projects_org_code_uq").on(t.organizationId, t.code)]);

export const journalEntries = sqliteTable("journal_entries", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  entryNumber: text("entry_number").notNull(),
  transactionDate: text("transaction_date").notNull(),
  postingDate: text("posting_date").notNull(),
  description: text("description").notNull(),
  reference: text("reference"),
  sourceType: text("source_type").notNull().default("manual"),
  sourceId: text("source_id"),
  status: text("status", { enum: ["draft", "posted", "reversed"] }).notNull().default("draft"),
  currency: text("currency").notNull(),
  exchangeRateMicros: integer("exchange_rate_micros").notNull().default(1_000_000),
  reversalOfId: text("reversal_of_id"),
  postedAt: text("posted_at"),
  postedBy: text("posted_by"),
  idempotencyKey: text("idempotency_key"),
  metadata: text("metadata").notNull().default("{}"),
  ...timestamps,
}, (t) => [
  uniqueIndex("journals_org_number_uq").on(t.organizationId, t.entryNumber),
  uniqueIndex("journals_org_idempotency_uq").on(t.organizationId, t.idempotencyKey),
  uniqueIndex("journals_org_reversal_uq").on(t.organizationId, t.reversalOfId),
  index("journals_org_posting_idx").on(t.organizationId, t.postingDate, t.status),
]);

export const journalLines = sqliteTable("journal_lines", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  journalEntryId: text("journal_entry_id").notNull().references(() => journalEntries.id),
  accountId: text("account_id").notNull().references(() => accounts.id),
  description: text("description"),
  debitMinor: integer("debit_minor").notNull().default(0),
  creditMinor: integer("credit_minor").notNull().default(0),
  baseDebitMinor: integer("base_debit_minor").notNull().default(0),
  baseCreditMinor: integer("base_credit_minor").notNull().default(0),
  contactId: text("contact_id").references(() => contacts.id),
  projectId: text("project_id").references(() => projects.id),
  classId: text("class_id").references(() => dimensions.id),
  departmentId: text("department_id").references(() => dimensions.id),
  locationId: text("location_id").references(() => dimensions.id),
  taxCode: text("tax_code"),
  dimensionsJson: text("dimensions_json").notNull().default("{}"),
  ...timestamps,
}, (t) => [
  index("journal_lines_entry_idx").on(t.organizationId, t.journalEntryId),
  index("journal_lines_account_idx").on(t.organizationId, t.accountId),
  index("journal_lines_contact_idx").on(t.organizationId, t.contactId),
]);

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  type: text("type", { enum: ["invoice", "bill", "credit_note", "supplier_credit", "payroll"] }).notNull(),
  number: text("number").notNull(),
  contactId: text("contact_id").references(() => contacts.id),
  issueDate: text("issue_date").notNull(),
  dueDate: text("due_date"),
  status: text("status", { enum: ["draft", "open", "partially_paid", "paid", "void"] }).notNull().default("draft"),
  currency: text("currency").notNull(),
  subtotalMinor: integer("subtotal_minor").notNull(),
  taxMinor: integer("tax_minor").notNull().default(0),
  totalMinor: integer("total_minor").notNull(),
  paidMinor: integer("paid_minor").notNull().default(0),
  journalEntryId: text("journal_entry_id").references(() => journalEntries.id),
  customFields: text("custom_fields").notNull().default("{}"),
  ...timestamps,
}, (t) => [
  uniqueIndex("documents_org_type_number_uq").on(t.organizationId, t.type, t.number),
  index("documents_ageing_idx").on(t.organizationId, t.type, t.status, t.dueDate),
]);

export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  type: text("type", { enum: ["inventory", "service", "non_inventory"] }).notNull(),
  incomeAccountId: text("income_account_id").references(() => accounts.id),
  expenseAccountId: text("expense_account_id").references(() => accounts.id),
  inventoryAccountId: text("inventory_account_id").references(() => accounts.id),
  quantityOnHandMicros: integer("quantity_on_hand_micros").notNull().default(0),
  averageCostMinor: integer("average_cost_minor").notNull().default(0),
  reorderPointMicros: integer("reorder_point_micros").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  costingMethod:text("costing_method").notNull().default("average"),
  committedQuantityMicros:integer("committed_quantity_micros").notNull().default(0),
  ...timestamps,
}, (t) => [uniqueIndex("products_org_sku_uq").on(t.organizationId, t.sku)]);

export const inventoryLocations = sqliteTable("inventory_locations", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id),
  code: text("code").notNull(), name: text("name").notNull(), active: integer("active", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
}, (t) => [uniqueIndex("inventory_locations_org_code_uq").on(t.organizationId, t.code)]);

export const inventoryBalances = sqliteTable("inventory_balances", {
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  productId: text("product_id").notNull().references(() => products.id),
  locationId: text("location_id").notNull().references(() => inventoryLocations.id),
  quantityMicros: integer("quantity_micros").notNull().default(0),
  inventoryValueMinor: integer("inventory_value_minor").notNull().default(0),
  ...timestamps,
}, (t) => [primaryKey({ columns: [t.organizationId, t.productId, t.locationId] })]);

export const inventoryMovements = sqliteTable("inventory_movements", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id),
  productId: text("product_id").notNull().references(() => products.id), locationId: text("location_id").notNull().references(() => inventoryLocations.id),
  type: text("type", { enum: ["opening", "receipt", "issue", "adjustment", "transfer_in", "transfer_out", "sale_return", "purchase_return"] }).notNull(),
  movementDate: text("movement_date").notNull(), quantityDeltaMicros: integer("quantity_delta_micros").notNull(),
  unitCostMinor: integer("unit_cost_minor").notNull(), valueDeltaMinor: integer("value_delta_minor").notNull(),
  sourceType: text("source_type").notNull(), sourceId: text("source_id"), transferGroupId: text("transfer_group_id"),
  journalEntryId: text("journal_entry_id").references(() => journalEntries.id), idempotencyKey: text("idempotency_key"),
  ...timestamps,
}, (t) => [
  uniqueIndex("inventory_movements_org_idempotency_uq").on(t.organizationId, t.idempotencyKey),
  index("inventory_movements_product_date_idx").on(t.organizationId, t.productId, t.movementDate),
]);

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id),
  type: text("type", { enum: ["estimate", "purchase_order"] }).notNull(), number: text("number").notNull(),
  contactId: text("contact_id").notNull().references(() => contacts.id), issueDate: text("issue_date").notNull(), expiryDate: text("expiry_date"),
  status: text("status", { enum: ["draft", "approved", "converted", "closed", "cancelled"] }).notNull().default("draft"),
  currency: text("currency").notNull(), subtotalMinor: integer("subtotal_minor").notNull(), taxMinor: integer("tax_minor").notNull().default(0),
  totalMinor: integer("total_minor").notNull(), convertedDocumentId: text("converted_document_id").references(() => documents.id),
  customFields: text("custom_fields").notNull().default("{}"), ...timestamps,
}, (t) => [uniqueIndex("orders_org_type_number_uq").on(t.organizationId, t.type, t.number)]);

export const orderLines = sqliteTable("order_lines", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id),
  orderId: text("order_id").notNull().references(() => orders.id), productId: text("product_id").references(() => products.id),
  accountId: text("account_id").notNull().references(() => accounts.id), taxAccountId: text("tax_account_id").references(() => accounts.id),
  description: text("description").notNull(), quantityMicros: integer("quantity_micros").notNull(), unitPriceMinor: integer("unit_price_minor").notNull(),
  subtotalMinor: integer("subtotal_minor").notNull(), taxMinor: integer("tax_minor").notNull().default(0), totalMinor: integer("total_minor").notNull(),
  projectId: text("project_id").references(() => projects.id), ...timestamps,
}, (t) => [index("order_lines_order_idx").on(t.organizationId, t.orderId)]);

export const documentLines = sqliteTable("document_lines", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  documentId: text("document_id").notNull().references(() => documents.id),
  productId: text("product_id").references(() => products.id),
  accountId: text("account_id").notNull().references(() => accounts.id),
  taxAccountId: text("tax_account_id").references(() => accounts.id),
  description: text("description").notNull(),
  quantityMicros: integer("quantity_micros").notNull().default(1_000_000),
  unitPriceMinor: integer("unit_price_minor").notNull(),
  subtotalMinor: integer("subtotal_minor").notNull(),
  taxMinor: integer("tax_minor").notNull().default(0),
  totalMinor: integer("total_minor").notNull(),
  projectId: text("project_id").references(() => projects.id),
  classId: text("class_id").references(() => dimensions.id),
  departmentId: text("department_id").references(() => dimensions.id),
  locationId: text("location_id").references(() => dimensions.id),
  dimensionsJson: text("dimensions_json").notNull().default("{}"),
  ...timestamps,
}, (t) => [index("document_lines_doc_idx").on(t.organizationId, t.documentId)]);

export const payments = sqliteTable("payments", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  type: text("type", { enum: ["receipt", "payment"] }).notNull(),
  number: text("number").notNull(),
  contactId: text("contact_id").notNull().references(() => contacts.id),
  bankAccountId: text("bank_account_id").notNull().references(() => accounts.id),
  controlAccountId: text("control_account_id").notNull().references(() => accounts.id),
  paymentDate: text("payment_date").notNull(),
  currency: text("currency").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  reference: text("reference"),
  status: text("status", { enum: ["draft", "posted", "reversed"] }).notNull().default("draft"),
  journalEntryId: text("journal_entry_id").references(() => journalEntries.id),
  idempotencyKey: text("idempotency_key"),
  ...timestamps,
}, (t) => [
  uniqueIndex("payments_org_number_uq").on(t.organizationId, t.type, t.number),
  uniqueIndex("payments_org_idempotency_uq").on(t.organizationId, t.idempotencyKey),
  index("payments_org_date_idx").on(t.organizationId, t.paymentDate, t.status),
]);

export const paymentAllocations = sqliteTable("payment_allocations", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  paymentId: text("payment_id").notNull().references(() => payments.id),
  documentId: text("document_id").notNull().references(() => documents.id),
  amountMinor: integer("amount_minor").notNull(),
  reversedAt: text("reversed_at"),
  ...timestamps,
}, (t) => [
  uniqueIndex("payment_allocations_payment_document_uq").on(t.organizationId, t.paymentId, t.documentId),
  index("payment_allocations_document_idx").on(t.organizationId, t.documentId),
]);

export const budgets = sqliteTable("budgets", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  fiscalYear: integer("fiscal_year").notNull(),
  status: text("status", { enum: ["draft", "approved", "archived"] }).notNull().default("draft"),
  ...timestamps,
});

export const budgetLines = sqliteTable("budget_lines", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  budgetId: text("budget_id").notNull().references(() => budgets.id),
  accountId: text("account_id").notNull().references(() => accounts.id),
  period: text("period").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  classId: text("class_id").references(() => dimensions.id),
  departmentId: text("department_id").references(() => dimensions.id),
  locationId: text("location_id").references(() => dimensions.id),
  ...timestamps,
}, (t) => [index("budget_lines_budget_idx").on(t.organizationId, t.budgetId, t.period)]);

export const timeEntries = sqliteTable("time_entries", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id),
  userId: text("user_id").references(() => users.id), projectId: text("project_id").notNull().references(() => projects.id),
  entryDate: text("entry_date").notNull(), minutes: integer("minutes").notNull(), description: text("description"),
  billable: integer("billable", { mode: "boolean" }).notNull().default(false), billed: integer("billed", { mode: "boolean" }).notNull().default(false),
  costRateMinor: integer("cost_rate_minor").notNull().default(0), billingRateMinor: integer("billing_rate_minor").notNull().default(0),
  status: text("status", { enum: ["draft", "approved", "rejected"] }).notNull().default("draft"), ...timestamps,
}, (t) => [index("time_entries_project_date_idx").on(t.organizationId, t.projectId, t.entryDate)]);

export const employees = sqliteTable("employees", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id),
  contactId: text("contact_id").notNull().references(() => contacts.id), employeeNumber: text("employee_number").notNull(),
  hireDate: text("hire_date").notNull(), terminationDate: text("termination_date"), payType: text("pay_type", { enum: ["salary", "hourly"] }).notNull(),
  basePayMinor: integer("base_pay_minor").notNull(), currency: text("currency").notNull(), taxIdentifier: text("tax_identifier"),
  bankDetailsEncrypted: text("bank_details_encrypted"), active: integer("active", { mode: "boolean" }).notNull().default(true), ...timestamps,
}, (t) => [uniqueIndex("employees_org_number_uq").on(t.organizationId, t.employeeNumber)]);

export const payrollRuns = sqliteTable("payroll_runs", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id),
  number: text("number").notNull(), periodStart: text("period_start").notNull(), periodEnd: text("period_end").notNull(), payDate: text("pay_date").notNull(),
  status: text("status", { enum: ["draft", "approved", "posted", "reversed"] }).notNull().default("draft"), currency: text("currency").notNull(),
  grossMinor: integer("gross_minor").notNull().default(0), deductionsMinor: integer("deductions_minor").notNull().default(0),
  employerCostsMinor: integer("employer_costs_minor").notNull().default(0), netMinor: integer("net_minor").notNull().default(0),
  journalEntryId: text("journal_entry_id").references(() => journalEntries.id), ...timestamps,
}, (t) => [uniqueIndex("payroll_runs_org_number_uq").on(t.organizationId, t.number)]);

export const payrollLines = sqliteTable("payroll_lines", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id),
  payrollRunId: text("payroll_run_id").notNull().references(() => payrollRuns.id), employeeId: text("employee_id").notNull().references(() => employees.id),
  grossMinor: integer("gross_minor").notNull(), deductionsMinor: integer("deductions_minor").notNull(),
  employerCostsMinor: integer("employer_costs_minor").notNull().default(0), netMinor: integer("net_minor").notNull(),
  components: text("components").notNull().default("[]"), ...timestamps,
}, (t) => [uniqueIndex("payroll_lines_run_employee_uq").on(t.organizationId, t.payrollRunId, t.employeeId)]);

export const reportJobs = sqliteTable("report_jobs", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  requestedBy: text("requested_by").notNull(),
  reportType: text("report_type").notNull(),
  format: text("format", { enum: ["json", "csv"] }).notNull(),
  filters: text("filters").notNull().default("{}"),
  status: text("status", { enum: ["queued", "processing", "completed", "failed"] }).notNull().default("queued"),
  objectKey: text("object_key"),
  error: text("error"),
  completedAt: text("completed_at"),
  ...timestamps,
}, (t) => [index("report_jobs_org_idx").on(t.organizationId, t.createdAt)]);

export const reportSchedules = sqliteTable("report_schedules", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id),
  name: text("name").notNull(), reportType: text("report_type").notNull(), format: text("format", { enum: ["json", "csv", "xlsx", "pdf"] }).notNull(),
  filters: text("filters").notNull().default("{}"), cron: text("cron").notNull(), recipients: text("recipients").notNull().default("[]"),
  active: integer("active", { mode: "boolean" }).notNull().default(true), nextRunAt: text("next_run_at"), lastRunAt: text("last_run_at"), ...timestamps,
}, (t) => [index("report_schedules_due_idx").on(t.active, t.nextRunAt)]);

export const savedReports = sqliteTable("saved_reports", {
  id:text("id").primaryKey(),organizationId:text("organization_id").notNull().references(()=>organizations.id),
  ownerId:text("owner_id").notNull().references(()=>users.id),name:text("name").notNull(),reportType:text("report_type").notNull(),
  filters:text("filters").notNull().default("{}"),columns:text("columns").notNull().default("[]"),visibility:text("visibility",{enum:["private","organization"]}).notNull().default("private"),...timestamps,
},t=>[index("saved_reports_org_idx").on(t.organizationId,t.ownerId)]);

export const reportPackages = sqliteTable("report_packages", {
  id:text("id").primaryKey(),organizationId:text("organization_id").notNull().references(()=>organizations.id),
  ownerId:text("owner_id").notNull().references(()=>users.id),name:text("name").notNull(),description:text("description"),
  reportDefinitions:text("report_definitions").notNull(),...timestamps,
},t=>[index("report_packages_org_idx").on(t.organizationId,t.ownerId)]);

export const dashboards = sqliteTable("dashboards", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id),
  ownerId: text("owner_id").notNull().references(() => users.id), name: text("name").notNull(),
  visibility: text("visibility", { enum: ["private", "organization"] }).notNull().default("private"),
  layout: text("layout").notNull().default("[]"), isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false), ...timestamps,
}, (t) => [index("dashboards_org_owner_idx").on(t.organizationId, t.ownerId)]);

export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id),
  name: text("name").notNull(), prefix: text("prefix").notNull(), keyHash: text("key_hash").notNull(), scopes: text("scopes").notNull().default("[]"),
  expiresAt: text("expires_at"), lastUsedAt: text("last_used_at"), revokedAt: text("revoked_at"), createdBy: text("created_by").notNull(), ...timestamps,
}, (t) => [uniqueIndex("api_keys_hash_uq").on(t.keyHash), index("api_keys_org_idx").on(t.organizationId)]);

export const webhookEndpoints = sqliteTable("webhook_endpoints", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id),
  url: text("url").notNull(), description: text("description"), events: text("events").notNull(), secretHash: text("secret_hash").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true), failureCount: integer("failure_count").notNull().default(0), ...timestamps,
}, (t) => [index("webhooks_org_idx").on(t.organizationId)]);

export const webhookDeliveries = sqliteTable("webhook_deliveries", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id),
  endpointId: text("endpoint_id").notNull().references(() => webhookEndpoints.id), eventType: text("event_type").notNull(),
  eventId: text("event_id").notNull(), payload: text("payload").notNull(), status: text("status", { enum: ["queued", "delivered", "failed"] }).notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0), responseStatus: integer("response_status"), nextAttemptAt: text("next_attempt_at"), deliveredAt: text("delivered_at"), ...timestamps,
}, (t) => [uniqueIndex("webhook_delivery_event_uq").on(t.endpointId, t.eventId), index("webhook_delivery_due_idx").on(t.status, t.nextAttemptAt)]);

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  requestId: text("request_id"),
  before: text("before"),
  after: text("after"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [index("audit_org_created_idx").on(t.organizationId, t.createdAt)]);
