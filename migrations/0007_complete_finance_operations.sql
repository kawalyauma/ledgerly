ALTER TABLE payroll_runs ADD COLUMN reversal_run_id TEXT;
ALTER TABLE payroll_runs ADD COLUMN payment_batch_id TEXT;
ALTER TABLE payroll_runs ADD COLUMN calculation_snapshot TEXT NOT NULL DEFAULT '{}';
ALTER TABLE payroll_lines ADD COLUMN payslip_object_key TEXT;
ALTER TABLE payroll_lines ADD COLUMN delivered_at TEXT;
ALTER TABLE budgets ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE budgets ADD COLUMN scenario TEXT NOT NULL DEFAULT 'base';
ALTER TABLE budgets ADD COLUMN kind TEXT NOT NULL DEFAULT 'annual';
ALTER TABLE budgets ADD COLUMN parent_id TEXT;
ALTER TABLE budgets ADD COLUMN locked_at TEXT;
ALTER TABLE budgets ADD COLUMN locked_by TEXT;
ALTER TABLE budgets ADD COLUMN submitted_by TEXT;
ALTER TABLE budgets ADD COLUMN approved_by TEXT;

CREATE TABLE payroll_components (id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,code TEXT NOT NULL,name TEXT NOT NULL,type TEXT NOT NULL,calculation_type TEXT NOT NULL,rate_micros INTEGER,amount_minor INTEGER,taxable INTEGER NOT NULL DEFAULT 0,pensionable INTEGER NOT NULL DEFAULT 0,statutory INTEGER NOT NULL DEFAULT 0,employer_rate_micros INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX payroll_components_org_code_uq ON payroll_components(organization_id,code);
CREATE TABLE payroll_rules (id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,name TEXT NOT NULL,country_code TEXT NOT NULL,currency TEXT NOT NULL,effective_from TEXT NOT NULL,effective_to TEXT,status TEXT NOT NULL DEFAULT 'draft',settings TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE payroll_rule_bands (id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,rule_id TEXT NOT NULL,kind TEXT NOT NULL,lower_minor INTEGER NOT NULL,upper_minor INTEGER,rate_micros INTEGER NOT NULL,fixed_minor INTEGER NOT NULL DEFAULT 0,employee_rate_micros INTEGER,employer_rate_micros INTEGER,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX payroll_rule_bands_rule_idx ON payroll_rule_bands(organization_id,rule_id,kind,lower_minor);
CREATE TABLE employee_payroll_components (id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,employee_id TEXT NOT NULL,component_id TEXT NOT NULL,amount_minor INTEGER,rate_micros INTEGER,effective_from TEXT NOT NULL,effective_to TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE payroll_inputs (id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,employee_id TEXT NOT NULL,input_date TEXT NOT NULL,type TEXT NOT NULL,units_micros INTEGER NOT NULL DEFAULT 0,amount_minor INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'approved',metadata TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX payroll_inputs_period_idx ON payroll_inputs(organization_id,employee_id,input_date,type);
CREATE TABLE payroll_payment_batches (id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,payroll_run_id TEXT NOT NULL,number TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',bank_account_id TEXT,payment_date TEXT NOT NULL,total_minor INTEGER NOT NULL,items TEXT NOT NULL DEFAULT '[]',approved_by TEXT,processed_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX payroll_batches_org_number_uq ON payroll_payment_batches(organization_id,number);
CREATE TABLE payroll_statutory_returns (id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,payroll_run_id TEXT,year INTEGER NOT NULL,period TEXT NOT NULL,authority TEXT NOT NULL,type TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',amount_minor INTEGER NOT NULL DEFAULT 0,payload TEXT NOT NULL DEFAULT '{}',filed_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE close_checklist_items (id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,period_id TEXT NOT NULL,code TEXT NOT NULL,name TEXT NOT NULL,required INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'pending',evidence TEXT,completed_by TEXT,completed_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX close_checklist_org_period_code_uq ON close_checklist_items(organization_id,period_id,code);
CREATE TABLE adjustment_schedules (id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,type TEXT NOT NULL,name TEXT NOT NULL,start_date TEXT NOT NULL,end_date TEXT,frequency TEXT NOT NULL,amount_minor INTEGER NOT NULL,debit_account_id TEXT NOT NULL,credit_account_id TEXT NOT NULL,next_posting_date TEXT,status TEXT NOT NULL DEFAULT 'active',metadata TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE close_signoffs (id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,period_id TEXT NOT NULL,stage TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',requested_by TEXT NOT NULL,approved_by TEXT,comment TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE compliance_approvals (id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,action TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',requested_by TEXT NOT NULL,reviewed_by TEXT,reason TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,reviewed_at TEXT);
CREATE INDEX compliance_approvals_entity_idx ON compliance_approvals(organization_id,entity_type,entity_id,status);
CREATE TABLE segregation_rules (id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,name TEXT NOT NULL,entity_type TEXT NOT NULL,action TEXT NOT NULL,requester_roles TEXT NOT NULL DEFAULT '[]',approver_roles TEXT NOT NULL DEFAULT '[]',active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE attachments (id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,file_name TEXT NOT NULL,content_type TEXT NOT NULL,object_key TEXT NOT NULL,sha256 TEXT NOT NULL,retention_until TEXT,uploaded_by TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE report_layouts (id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,name TEXT NOT NULL,report_type TEXT NOT NULL,groups_json TEXT NOT NULL DEFAULT '[]',columns_json TEXT NOT NULL DEFAULT '[]',branding_json TEXT NOT NULL DEFAULT '{}',active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE report_annotations (id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,report_type TEXT NOT NULL,period_key TEXT NOT NULL,text TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',created_by TEXT NOT NULL,signed_off_by TEXT,signed_off_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
