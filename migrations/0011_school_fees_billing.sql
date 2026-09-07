PRAGMA foreign_keys=ON;

-- School Fees & Billing module. This module is a subledger over Ledgerly's
-- contacts, products, invoices, payments, journals and chart of accounts.

CREATE TABLE IF NOT EXISTS school_number_sequences (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sequence_key TEXT NOT NULL,
  current_value INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, sequence_key)
);

CREATE TABLE IF NOT EXISTS school_fee_accounting_settings (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  receivable_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  discount_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  scholarship_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  writeoff_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  late_fee_income_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  default_currency TEXT NOT NULL DEFAULT 'UGX',
  invoice_due_days INTEGER NOT NULL DEFAULT 30,
  auto_post_invoices INTEGER NOT NULL DEFAULT 1,
  auto_post_receipts INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS school_fee_structures (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  academic_year_id TEXT NOT NULL REFERENCES school_academic_years(id) ON DELETE RESTRICT,
  term_id TEXT REFERENCES school_terms(id) ON DELETE RESTRICT,
  campus_id TEXT REFERENCES school_branches(id) ON DELETE SET NULL,
  class_level_id TEXT REFERENCES school_class_levels(id) ON DELETE SET NULL,
  class_id TEXT REFERENCES school_classes(id) ON DELETE SET NULL,
  stream_id TEXT REFERENCES school_streams(id) ON DELETE SET NULL,
  residency_status TEXT CHECK(residency_status IN ('day','boarding','hybrid')),
  student_category TEXT,
  currency TEXT NOT NULL DEFAULT 'UGX',
  effective_from TEXT,
  effective_to TEXT,
  priority INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','archived')),
  notes TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, code)
);
CREATE INDEX IF NOT EXISTS school_fee_structures_match_idx ON school_fee_structures(organization_id,academic_year_id,term_id,campus_id,class_level_id,class_id,stream_id,status,priority);

CREATE TABLE IF NOT EXISTS school_fee_structure_lines (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  structure_id TEXT NOT NULL REFERENCES school_fee_structures(id) ON DELETE CASCADE,
  fee_category_id TEXT NOT NULL REFERENCES school_fee_categories(id) ON DELETE RESTRICT,
  amount_minor INTEGER NOT NULL CHECK(amount_minor >= 0),
  quantity_micros INTEGER NOT NULL DEFAULT 1000000 CHECK(quantity_micros > 0),
  due_date TEXT,
  mandatory INTEGER NOT NULL DEFAULT 1,
  discountable INTEGER NOT NULL DEFAULT 1,
  installment_allowed INTEGER NOT NULL DEFAULT 1,
  refundable INTEGER NOT NULL DEFAULT 0,
  tax_minor INTEGER NOT NULL DEFAULT 0 CHECK(tax_minor >= 0),
  tax_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  description TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, structure_id, fee_category_id)
);
CREATE INDEX IF NOT EXISTS school_fee_structure_lines_structure_idx ON school_fee_structure_lines(organization_id,structure_id);

CREATE TABLE IF NOT EXISTS school_fee_discount_schemes (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'discount' CHECK(category IN ('discount','scholarship','bursary','sibling_discount','staff_child','waiver','promotion','other')),
  calculation_type TEXT NOT NULL CHECK(calculation_type IN ('fixed','percentage')),
  amount_minor INTEGER,
  rate_micros INTEGER,
  fee_category_id TEXT REFERENCES school_fee_categories(id) ON DELETE SET NULL,
  academic_year_id TEXT REFERENCES school_academic_years(id) ON DELETE SET NULL,
  term_id TEXT REFERENCES school_terms(id) ON DELETE SET NULL,
  campus_id TEXT REFERENCES school_branches(id) ON DELETE SET NULL,
  class_level_id TEXT REFERENCES school_class_levels(id) ON DELETE SET NULL,
  class_id TEXT REFERENCES school_classes(id) ON DELETE SET NULL,
  residency_status TEXT,
  student_category TEXT,
  sibling_min_count INTEGER,
  max_amount_minor INTEGER,
  priority INTEGER NOT NULL DEFAULT 100,
  stackable INTEGER NOT NULL DEFAULT 0,
  approval_required INTEGER NOT NULL DEFAULT 0,
  accounting_treatment TEXT NOT NULL DEFAULT 'net_revenue' CHECK(accounting_treatment IN ('net_revenue','expense')),
  expense_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  starts_on TEXT,
  ends_on TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, code),
  CHECK((calculation_type='fixed' AND amount_minor IS NOT NULL AND amount_minor>=0) OR (calculation_type='percentage' AND rate_micros IS NOT NULL AND rate_micros>=0 AND rate_micros<=100000000))
);
CREATE INDEX IF NOT EXISTS school_fee_discount_schemes_match_idx ON school_fee_discount_schemes(organization_id,active,academic_year_id,term_id,fee_category_id,priority);

CREATE TABLE IF NOT EXISTS school_student_fee_awards (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  scheme_id TEXT REFERENCES school_fee_discount_schemes(id) ON DELETE SET NULL,
  fee_category_id TEXT REFERENCES school_fee_categories(id) ON DELETE SET NULL,
  academic_year_id TEXT REFERENCES school_academic_years(id) ON DELETE SET NULL,
  term_id TEXT REFERENCES school_terms(id) ON DELETE SET NULL,
  award_type TEXT NOT NULL DEFAULT 'discount' CHECK(award_type IN ('discount','scholarship','bursary','waiver','sponsorship','other')),
  calculation_type TEXT NOT NULL CHECK(calculation_type IN ('fixed','percentage')),
  amount_minor INTEGER,
  rate_micros INTEGER,
  max_amount_minor INTEGER,
  starts_on TEXT,
  ends_on TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','revoked','expired')),
  notes TEXT,
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK((calculation_type='fixed' AND amount_minor IS NOT NULL AND amount_minor>=0) OR (calculation_type='percentage' AND rate_micros IS NOT NULL AND rate_micros>=0 AND rate_micros<=100000000))
);
CREATE INDEX IF NOT EXISTS school_student_fee_awards_student_idx ON school_student_fee_awards(organization_id,student_id,status,academic_year_id,term_id);

CREATE TABLE IF NOT EXISTS school_fee_billing_schedules (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  academic_year_id TEXT NOT NULL REFERENCES school_academic_years(id) ON DELETE RESTRICT,
  term_id TEXT REFERENCES school_terms(id) ON DELETE RESTRICT,
  structure_id TEXT REFERENCES school_fee_structures(id) ON DELETE SET NULL,
  run_on TEXT NOT NULL,
  due_date TEXT,
  criteria_json TEXT NOT NULL DEFAULT '{}',
  auto_post INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed','cancelled')),
  last_batch_id TEXT,
  last_error TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS school_fee_billing_schedules_due_idx ON school_fee_billing_schedules(organization_id,status,run_on);

CREATE TABLE IF NOT EXISTS school_fee_billing_batches (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  batch_number TEXT NOT NULL,
  academic_year_id TEXT NOT NULL REFERENCES school_academic_years(id) ON DELETE RESTRICT,
  term_id TEXT REFERENCES school_terms(id) ON DELETE RESTRICT,
  structure_id TEXT REFERENCES school_fee_structures(id) ON DELETE SET NULL,
  billing_date TEXT NOT NULL,
  due_date TEXT,
  criteria_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','processing','completed','partial','failed','cancelled')),
  total_students INTEGER NOT NULL DEFAULT 0,
  billed_students INTEGER NOT NULL DEFAULT 0,
  failed_students INTEGER NOT NULL DEFAULT 0,
  total_amount_minor INTEGER NOT NULL DEFAULT 0,
  errors_json TEXT NOT NULL DEFAULT '[]',
  idempotency_key TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,batch_number),
  UNIQUE(organization_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS school_fee_batches_period_idx ON school_fee_billing_batches(organization_id,academic_year_id,term_id,created_at);

CREATE TABLE IF NOT EXISTS school_student_fee_charges (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES school_students(id) ON DELETE RESTRICT,
  payer_contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  academic_year_id TEXT REFERENCES school_academic_years(id) ON DELETE SET NULL,
  term_id TEXT REFERENCES school_terms(id) ON DELETE SET NULL,
  campus_id TEXT REFERENCES school_branches(id) ON DELETE SET NULL,
  class_id TEXT REFERENCES school_classes(id) ON DELETE SET NULL,
  stream_id TEXT REFERENCES school_streams(id) ON DELETE SET NULL,
  fee_category_id TEXT NOT NULL REFERENCES school_fee_categories(id) ON DELETE RESTRICT,
  structure_line_id TEXT REFERENCES school_fee_structure_lines(id) ON DELETE SET NULL,
  billing_batch_id TEXT REFERENCES school_fee_billing_batches(id) ON DELETE SET NULL,
  parent_charge_id TEXT REFERENCES school_student_fee_charges(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity_micros INTEGER NOT NULL DEFAULT 1000000,
  gross_minor INTEGER NOT NULL CHECK(gross_minor >= 0),
  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK(discount_minor >= 0),
  scholarship_minor INTEGER NOT NULL DEFAULT 0 CHECK(scholarship_minor >= 0),
  waiver_minor INTEGER NOT NULL DEFAULT 0 CHECK(waiver_minor >= 0),
  tax_minor INTEGER NOT NULL DEFAULT 0 CHECK(tax_minor >= 0),
  total_minor INTEGER NOT NULL CHECK(total_minor >= 0),
  credited_minor INTEGER NOT NULL DEFAULT 0 CHECK(credited_minor >= 0),
  written_off_minor INTEGER NOT NULL DEFAULT 0 CHECK(written_off_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'UGX',
  charge_date TEXT NOT NULL,
  due_date TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('structure','manual','opening_balance','late_fee','adjustment','import')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','invoiced','partially_settled','settled','credited','waived','written_off','cancelled')),
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  credit_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS school_fee_charges_student_idx ON school_student_fee_charges(organization_id,student_id,academic_year_id,term_id,status,due_date);
CREATE INDEX IF NOT EXISTS school_fee_charges_document_idx ON school_student_fee_charges(organization_id,document_id);
CREATE INDEX IF NOT EXISTS school_fee_charges_payer_idx ON school_student_fee_charges(organization_id,payer_contact_id,status);

CREATE TABLE IF NOT EXISTS school_fee_charge_adjustments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  charge_id TEXT NOT NULL REFERENCES school_student_fee_charges(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  award_id TEXT REFERENCES school_student_fee_awards(id) ON DELETE SET NULL,
  scheme_id TEXT REFERENCES school_fee_discount_schemes(id) ON DELETE SET NULL,
  adjustment_type TEXT NOT NULL CHECK(adjustment_type IN ('discount','scholarship','bursary','waiver','sibling_discount','late_fee_reversal','other')),
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  reason TEXT,
  accounting_treatment TEXT NOT NULL DEFAULT 'net_revenue' CHECK(accounting_treatment IN ('net_revenue','expense')),
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  journal_entry_id TEXT REFERENCES journal_entries(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'applied' CHECK(status IN ('applied','reversed')),
  reversed_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS school_fee_adjustments_charge_idx ON school_fee_charge_adjustments(organization_id,charge_id,status);

CREATE TABLE IF NOT EXISTS school_fee_receipts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  receipt_number TEXT NOT NULL,
  student_id TEXT REFERENCES school_students(id) ON DELETE SET NULL,
  payer_contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  payment_method_id TEXT REFERENCES school_payment_methods(id) ON DELETE SET NULL,
  payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  supporting_file_id TEXT REFERENCES school_files(id) ON DELETE SET NULL,
  payment_date TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  allocated_minor INTEGER NOT NULL DEFAULT 0 CHECK(allocated_minor >= 0),
  unallocated_minor INTEGER NOT NULL DEFAULT 0 CHECK(unallocated_minor >= 0),
  reference TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','posted','reversed')),
  reversed_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,receipt_number),
  UNIQUE(organization_id,payment_id)
);
CREATE INDEX IF NOT EXISTS school_fee_receipts_student_idx ON school_fee_receipts(organization_id,student_id,payment_date,status);
CREATE INDEX IF NOT EXISTS school_fee_receipts_payer_idx ON school_fee_receipts(organization_id,payer_contact_id,payment_date,status);

CREATE TABLE IF NOT EXISTS school_fee_payment_plans (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_number TEXT NOT NULL,
  student_id TEXT NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  payer_contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  academic_year_id TEXT REFERENCES school_academic_years(id) ON DELETE SET NULL,
  term_id TEXT REFERENCES school_terms(id) ON DELETE SET NULL,
  total_minor INTEGER NOT NULL CHECK(total_minor > 0),
  currency TEXT NOT NULL DEFAULT 'UGX',
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('draft','active','completed','defaulted','cancelled')),
  notes TEXT,
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,plan_number),
  CHECK(starts_on <= ends_on)
);
CREATE INDEX IF NOT EXISTS school_fee_plans_student_idx ON school_fee_payment_plans(organization_id,student_id,status);

CREATE TABLE IF NOT EXISTS school_fee_payment_plan_installments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES school_fee_payment_plans(id) ON DELETE CASCADE,
  sequence_no INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  paid_minor INTEGER NOT NULL DEFAULT 0 CHECK(paid_minor >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','partially_paid','paid','overdue','waived')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,plan_id,sequence_no)
);
CREATE INDEX IF NOT EXISTS school_fee_installments_due_idx ON school_fee_payment_plan_installments(organization_id,due_date,status);

CREATE TABLE IF NOT EXISTS school_fee_installment_allocations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  installment_id TEXT NOT NULL REFERENCES school_fee_payment_plan_installments(id) ON DELETE CASCADE,
  receipt_id TEXT NOT NULL REFERENCES school_fee_receipts(id) ON DELETE CASCADE,
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  reversed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,installment_id,receipt_id)
);

CREATE TABLE IF NOT EXISTS school_fee_late_fee_rules (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  penalty_fee_category_id TEXT NOT NULL REFERENCES school_fee_categories(id) ON DELETE RESTRICT,
  applies_to_fee_category_id TEXT REFERENCES school_fee_categories(id) ON DELETE SET NULL,
  calculation_type TEXT NOT NULL CHECK(calculation_type IN ('fixed','percentage')),
  amount_minor INTEGER,
  rate_micros INTEGER,
  grace_days INTEGER NOT NULL DEFAULT 0 CHECK(grace_days >= 0),
  recurrence TEXT NOT NULL DEFAULT 'one_time' CHECK(recurrence IN ('one_time','daily','weekly','monthly')),
  max_amount_minor INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  starts_on TEXT,
  ends_on TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,code),
  CHECK((calculation_type='fixed' AND amount_minor IS NOT NULL AND amount_minor>=0) OR (calculation_type='percentage' AND rate_micros IS NOT NULL AND rate_micros>=0))
);

CREATE TABLE IF NOT EXISTS school_fee_late_fee_assessments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL REFERENCES school_fee_late_fee_rules(id) ON DELETE CASCADE,
  source_charge_id TEXT NOT NULL REFERENCES school_student_fee_charges(id) ON DELETE CASCADE,
  penalty_charge_id TEXT NOT NULL REFERENCES school_student_fee_charges(id) ON DELETE CASCADE,
  assessment_key TEXT NOT NULL,
  assessed_on TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,assessment_key)
);

CREATE TABLE IF NOT EXISTS school_fee_credits (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  credit_number TEXT NOT NULL,
  student_id TEXT NOT NULL REFERENCES school_students(id) ON DELETE RESTRICT,
  charge_id TEXT NOT NULL REFERENCES school_student_fee_charges(id) ON DELETE RESTRICT,
  payer_contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  credit_date TEXT NOT NULL,
  currency TEXT NOT NULL,
  reason TEXT NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'posted' CHECK(status IN ('posted','reversed')),
  reversed_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,credit_number),
  UNIQUE(organization_id,document_id)
);
CREATE INDEX IF NOT EXISTS school_fee_credits_charge_idx ON school_fee_credits(organization_id,charge_id,status);

CREATE TABLE IF NOT EXISTS school_fee_refunds (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  refund_number TEXT NOT NULL,
  student_id TEXT REFERENCES school_students(id) ON DELETE SET NULL,
  payer_contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  bank_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  receivable_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  refund_date TEXT NOT NULL,
  currency TEXT NOT NULL,
  reason TEXT NOT NULL,
  journal_entry_id TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'posted' CHECK(status IN ('posted','reversed')),
  reversed_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,refund_number)
);

CREATE TABLE IF NOT EXISTS school_fee_writeoffs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  writeoff_number TEXT NOT NULL,
  student_id TEXT NOT NULL REFERENCES school_students(id) ON DELETE RESTRICT,
  charge_id TEXT NOT NULL REFERENCES school_student_fee_charges(id) ON DELETE RESTRICT,
  payer_contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  expense_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  receivable_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  writeoff_date TEXT NOT NULL,
  currency TEXT NOT NULL,
  reason TEXT NOT NULL,
  journal_entry_id TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'posted' CHECK(status IN ('posted','reversed')),
  reversed_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,writeoff_number)
);

CREATE TABLE IF NOT EXISTS school_fee_holds (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  hold_type TEXT NOT NULL DEFAULT 'financial' CHECK(hold_type IN ('financial','report_card','exam','registration','clearance','other')),
  reason TEXT NOT NULL,
  balance_threshold_minor INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','released','expired')),
  placed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  placed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  released_at TEXT,
  release_reason TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS school_fee_holds_student_idx ON school_fee_holds(organization_id,student_id,status);

CREATE TABLE IF NOT EXISTS school_fee_clearance_records (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  academic_year_id TEXT REFERENCES school_academic_years(id) ON DELETE SET NULL,
  term_id TEXT REFERENCES school_terms(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK(status IN ('cleared','not_cleared','conditional')),
  balance_snapshot_minor INTEGER NOT NULL DEFAULT 0,
  threshold_minor INTEGER NOT NULL DEFAULT 0,
  valid_until TEXT,
  notes TEXT,
  evaluated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  evaluated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS school_fee_clearance_student_idx ON school_fee_clearance_records(organization_id,student_id,evaluated_at);

CREATE TABLE IF NOT EXISTS school_fee_import_jobs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  import_type TEXT NOT NULL CHECK(import_type IN ('payments','opening_balances','charges')),
  status TEXT NOT NULL DEFAULT 'processing' CHECK(status IN ('processing','completed','failed')),
  total_rows INTEGER NOT NULL DEFAULT 0,
  processed_rows INTEGER NOT NULL DEFAULT 0,
  valid_rows INTEGER NOT NULL DEFAULT 0,
  invalid_rows INTEGER NOT NULL DEFAULT 0,
  total_amount_minor INTEGER NOT NULL DEFAULT 0,
  errors_json TEXT NOT NULL DEFAULT '[]',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE TRIGGER IF NOT EXISTS trg_school_fee_charge_document_status
AFTER UPDATE OF paid_minor,status ON documents
BEGIN
  UPDATE school_student_fee_charges
  SET status = CASE
      WHEN NEW.status='paid' THEN 'settled'
      WHEN NEW.status='partially_paid' THEN 'partially_settled'
      WHEN NEW.status='open' THEN 'invoiced'
      ELSE status END,
      updated_at=CURRENT_TIMESTAMP
  WHERE organization_id=NEW.organization_id AND document_id=NEW.id
    AND status IN ('invoiced','partially_settled','settled');
END;

-- Plugin-safe dimensions metadata. The traditional class/department/location
-- dimension columns remain intact, while modules can preserve their own
-- structured dimensions without overloading the core chart of accounts.
ALTER TABLE document_lines ADD COLUMN class_id TEXT REFERENCES dimensions(id);
ALTER TABLE document_lines ADD COLUMN department_id TEXT REFERENCES dimensions(id);
ALTER TABLE document_lines ADD COLUMN location_id TEXT REFERENCES dimensions(id);
ALTER TABLE document_lines ADD COLUMN dimensions_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE journal_lines ADD COLUMN dimensions_json TEXT NOT NULL DEFAULT '{}';

UPDATE app_modules
SET version='1.2.0',
    manifest_json='{"backendModules":["setup","iam","student-management","staff-teacher-management","files","fees-billing"],"plannedModules":["attendance","exams","timetable","library","boarding","transport","discipline","communications"],"accountingIntegration":true,"r2Uploads":true,"salaryInstallments":true,"schoolFeesLedger":true,"feeInstallments":true,"bulkBilling":true}',
    updated_at=CURRENT_TIMESTAMP
WHERE module_key='school-management';

-- Extend existing built-in school roles with fees permissions. New schools also
-- receive these permissions through the IAM bootstrap defaults in application code.
INSERT OR IGNORE INTO school_role_permissions (organization_id,role_id,permission,effect)
SELECT organization_id,id,'school.fees:read','allow' FROM school_roles WHERE code IN ('super_admin','school_admin','head_teacher','director','bursar','accountant','cashier');
INSERT OR IGNORE INTO school_role_permissions (organization_id,role_id,permission,effect)
SELECT organization_id,id,'school.fees:write','allow' FROM school_roles WHERE code IN ('super_admin','school_admin','bursar','accountant','cashier');
INSERT OR IGNORE INTO school_role_permissions (organization_id,role_id,permission,effect)
SELECT organization_id,id,'school.fees:approve','allow' FROM school_roles WHERE code IN ('super_admin','school_admin','head_teacher','director','bursar','accountant');
INSERT OR IGNORE INTO school_role_permissions (organization_id,role_id,permission,effect)
SELECT organization_id,id,'school.fees:export','allow' FROM school_roles WHERE code IN ('super_admin','school_admin','head_teacher','director','bursar','accountant');
