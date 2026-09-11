const bool = (value) => value == null ? value : Boolean(Number(value));

function table({ name, columns, conflict, booleans = [], dependencies = [] }) {
  return Object.freeze({
    name,
    columns: Object.freeze(columns),
    conflict: Object.freeze(conflict),
    dependencies: Object.freeze(dependencies),
    transform(row) {
      const next = {};
      for (const column of columns) next[column] = row[column] ?? null;
      for (const column of booleans) if (next[column] != null) next[column] = bool(next[column]);
      return next;
    },
  });
}

export const FINANCE_CORE_TABLES = Object.freeze([
  table({
    name: "contacts",
    columns: ["id","organization_id","type","code","name","email","tax_number","payment_terms_days","active","custom_fields","created_at","updated_at"],
    conflict: ["id"],
    booleans: ["active"],
    dependencies: ["organizations"],
  }),
  table({
    name: "dimensions",
    columns: ["id","organization_id","type","code","name","active","created_at","updated_at"],
    conflict: ["id"],
    booleans: ["active"],
    dependencies: ["organizations"],
  }),
  table({
    name: "projects",
    columns: ["id","organization_id","customer_id","code","name","status","budget_amount_minor","created_at","updated_at"],
    conflict: ["id"],
    dependencies: ["organizations","contacts"],
  }),
  table({
    name: "products",
    columns: ["id","organization_id","sku","name","type","income_account_id","expense_account_id","inventory_account_id","quantity_on_hand_micros","average_cost_minor","reorder_point_micros","active","created_at","updated_at"],
    conflict: ["id"],
    booleans: ["active"],
    dependencies: ["organizations","accounts"],
  }),
  table({
    name: "budgets",
    columns: ["id","organization_id","name","fiscal_year","status","created_at","updated_at"],
    conflict: ["id"],
    dependencies: ["organizations"],
  }),
  table({
    name: "budget_lines",
    columns: ["id","organization_id","budget_id","account_id","period","amount_minor","class_id","department_id","location_id","created_at","updated_at"],
    conflict: ["id"],
    dependencies: ["organizations","budgets","accounts","dimensions"],
  }),
  table({
    name: "journal_entries",
    columns: ["id","organization_id","entry_number","transaction_date","posting_date","description","reference","source_type","source_id","status","currency","exchange_rate_micros","reversal_of_id","posted_at","posted_by","idempotency_key","metadata","created_at","updated_at"],
    conflict: ["id"],
    dependencies: ["organizations"],
  }),
  table({
    name: "journal_lines",
    columns: ["id","organization_id","journal_entry_id","account_id","description","debit_minor","credit_minor","base_debit_minor","base_credit_minor","contact_id","project_id","class_id","department_id","location_id","tax_code","created_at","updated_at"],
    conflict: ["id"],
    dependencies: ["organizations","journal_entries","accounts","contacts","projects","dimensions"],
  }),
  table({
    name: "documents",
    columns: ["id","organization_id","type","number","contact_id","issue_date","due_date","status","currency","subtotal_minor","tax_minor","total_minor","paid_minor","journal_entry_id","custom_fields","created_at","updated_at"],
    conflict: ["id"],
    dependencies: ["organizations","contacts","journal_entries"],
  }),
  table({
    name: "document_lines",
    columns: ["id","organization_id","document_id","product_id","description","quantity_micros","unit_price_minor","subtotal_minor","tax_minor","total_minor","project_id","created_at","updated_at","account_id","tax_account_id"],
    conflict: ["id"],
    dependencies: ["organizations","documents","products","projects","accounts"],
  }),
  table({
    name: "payments",
    columns: ["id","organization_id","type","number","contact_id","bank_account_id","control_account_id","payment_date","currency","amount_minor","reference","status","journal_entry_id","idempotency_key","created_at","updated_at"],
    conflict: ["id"],
    dependencies: ["organizations","contacts","accounts","journal_entries"],
  }),
  table({
    name: "payment_allocations",
    columns: ["id","organization_id","payment_id","document_id","amount_minor","created_at","updated_at"],
    conflict: ["id"],
    dependencies: ["organizations","payments","documents"],
  }),
]);

export function getFinanceCoreTable(name) {
  return FINANCE_CORE_TABLES.find((item) => item.name === name) ?? null;
}
