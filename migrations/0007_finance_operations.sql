ALTER TABLE organizations ADD COLUMN address_json text NOT NULL DEFAULT '{}';
ALTER TABLE organizations ADD COLUMN tax_registration_number text;
ALTER TABLE organizations ADD COLUMN document_numbering_json text NOT NULL DEFAULT '{}';
ALTER TABLE accounts ADD COLUMN parent_account_id text REFERENCES accounts(id);
ALTER TABLE accounts ADD COLUMN account_group_id text REFERENCES account_groups(id);
ALTER TABLE contacts ADD COLUMN credit_limit_minor integer NOT NULL DEFAULT 0;
ALTER TABLE contacts ADD COLUMN pricing_tier text;
ALTER TABLE contacts ADD COLUMN archived_at text;
ALTER TABLE products ADD COLUMN costing_method text NOT NULL DEFAULT 'average';
ALTER TABLE products ADD COLUMN committed_quantity_micros integer NOT NULL DEFAULT 0;

CREATE TABLE account_groups (
  id text PRIMARY KEY NOT NULL, organization_id text NOT NULL REFERENCES organizations(id), code text NOT NULL,
  name text NOT NULL, type text NOT NULL, parent_group_id text REFERENCES account_groups(id), active integer NOT NULL DEFAULT 1,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX account_groups_org_code_uq ON account_groups(organization_id,code);

CREATE TABLE organization_membership_invites (
  id text PRIMARY KEY NOT NULL, organization_id text NOT NULL REFERENCES organizations(id), email text NOT NULL, role text NOT NULL,
  scopes text NOT NULL DEFAULT '[]', invited_by text NOT NULL, accepted_at text, expires_at text NOT NULL,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE contact_addresses (
  id text PRIMARY KEY NOT NULL, organization_id text NOT NULL REFERENCES organizations(id), contact_id text NOT NULL REFERENCES contacts(id),
  type text NOT NULL, line1 text NOT NULL, line2 text, city text, state text, postal_code text, country text NOT NULL,
  is_default integer NOT NULL DEFAULT 0, created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX contact_addresses_contact_idx ON contact_addresses(organization_id,contact_id);
CREATE TABLE contact_people (
  id text PRIMARY KEY NOT NULL, organization_id text NOT NULL REFERENCES organizations(id), contact_id text NOT NULL REFERENCES contacts(id),
  name text NOT NULL, email text, phone text, role text, is_primary integer NOT NULL DEFAULT 0,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE supplier_bank_accounts (
  id text PRIMARY KEY NOT NULL, organization_id text NOT NULL REFERENCES organizations(id), contact_id text NOT NULL REFERENCES contacts(id),
  bank_name text NOT NULL, account_name text NOT NULL, account_number_masked text NOT NULL, account_number_encrypted text NOT NULL,
  branch_code text, swift_bic text, currency text NOT NULL, active integer NOT NULL DEFAULT 1,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tax_jurisdictions (
  id text PRIMARY KEY NOT NULL, organization_id text NOT NULL REFERENCES organizations(id), code text NOT NULL, name text NOT NULL,
  country text NOT NULL, authority_name text, active integer NOT NULL DEFAULT 1,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX tax_jurisdictions_org_code_uq ON tax_jurisdictions(organization_id,code);
CREATE TABLE tax_codes (
  id text PRIMARY KEY NOT NULL, organization_id text NOT NULL REFERENCES organizations(id), jurisdiction_id text REFERENCES tax_jurisdictions(id),
  code text NOT NULL, name text NOT NULL, rate_micros integer NOT NULL, calculation text NOT NULL DEFAULT 'exclusive',
  tax_type text NOT NULL, recoverable_percent_micros integer NOT NULL DEFAULT 1000000, sales_account_id text REFERENCES accounts(id),
  purchase_account_id text REFERENCES accounts(id), active integer NOT NULL DEFAULT 1,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX tax_codes_org_code_uq ON tax_codes(organization_id,code);
CREATE TABLE tax_exemptions (
  id text PRIMARY KEY NOT NULL, organization_id text NOT NULL REFERENCES organizations(id), contact_id text REFERENCES contacts(id),
  tax_code_id text REFERENCES tax_codes(id), certificate_number text, reason text NOT NULL, starts_on text, ends_on text, active integer NOT NULL DEFAULT 1,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE tax_returns (
  id text PRIMARY KEY NOT NULL, organization_id text NOT NULL REFERENCES organizations(id), jurisdiction_id text NOT NULL REFERENCES tax_jurisdictions(id),
  period_start text NOT NULL, period_end text NOT NULL, status text NOT NULL DEFAULT 'draft', output_tax_minor integer NOT NULL DEFAULT 0,
  input_tax_minor integer NOT NULL DEFAULT 0, withholding_minor integer NOT NULL DEFAULT 0, net_tax_minor integer NOT NULL DEFAULT 0,
  prepared_by text NOT NULL, locked_at text, locked_by text, filed_at text, filing_reference text,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE bank_accounts (
  id text PRIMARY KEY NOT NULL, organization_id text NOT NULL REFERENCES organizations(id), ledger_account_id text NOT NULL REFERENCES accounts(id),
  name text NOT NULL, bank_name text, account_number_masked text, currency text NOT NULL, opening_balance_minor integer NOT NULL DEFAULT 0,
  active integer NOT NULL DEFAULT 1, created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX bank_accounts_org_ledger_uq ON bank_accounts(organization_id,ledger_account_id);
CREATE TABLE bank_statement_imports (
  id text PRIMARY KEY NOT NULL, organization_id text NOT NULL REFERENCES organizations(id), bank_account_id text NOT NULL REFERENCES bank_accounts(id),
  filename text NOT NULL, statement_start text, statement_end text, opening_balance_minor integer, closing_balance_minor integer,
  status text NOT NULL DEFAULT 'imported', imported_by text NOT NULL, created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE bank_transactions (
  id text PRIMARY KEY NOT NULL, organization_id text NOT NULL REFERENCES organizations(id), bank_account_id text NOT NULL REFERENCES bank_accounts(id),
  import_id text REFERENCES bank_statement_imports(id), external_id text, transaction_date text NOT NULL, description text NOT NULL,
  reference text, amount_minor integer NOT NULL, status text NOT NULL DEFAULT 'unmatched', matched_journal_line_id text REFERENCES journal_lines(id),
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX bank_transactions_external_uq ON bank_transactions(organization_id,bank_account_id,external_id);
CREATE TABLE bank_reconciliations (
  id text PRIMARY KEY NOT NULL, organization_id text NOT NULL REFERENCES organizations(id), bank_account_id text NOT NULL REFERENCES bank_accounts(id),
  statement_date text NOT NULL, statement_balance_minor integer NOT NULL, ledger_balance_minor integer NOT NULL, difference_minor integer NOT NULL,
  status text NOT NULL DEFAULT 'draft', prepared_by text NOT NULL, completed_at text,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE cheques (
  id text PRIMARY KEY NOT NULL, organization_id text NOT NULL REFERENCES organizations(id), bank_account_id text NOT NULL REFERENCES bank_accounts(id),
  cheque_number text NOT NULL, payee_contact_id text REFERENCES contacts(id), issue_date text NOT NULL, amount_minor integer NOT NULL,
  status text NOT NULL DEFAULT 'issued', payment_id text REFERENCES payments(id), cleared_at text, voided_at text,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE orders ADD COLUMN revision integer NOT NULL DEFAULT 1;
ALTER TABLE orders ADD COLUMN accepted_at text;
ALTER TABLE orders ADD COLUMN rejected_at text;
ALTER TABLE orders ADD COLUMN fulfilled_quantity_micros integer NOT NULL DEFAULT 0;
CREATE TABLE delivery_notes (
  id text PRIMARY KEY NOT NULL, organization_id text NOT NULL REFERENCES organizations(id), order_id text NOT NULL REFERENCES orders(id),
  number text NOT NULL, delivery_date text NOT NULL, status text NOT NULL DEFAULT 'draft', notes text,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE delivery_note_lines (
  id text PRIMARY KEY NOT NULL, organization_id text NOT NULL REFERENCES organizations(id), delivery_note_id text NOT NULL REFERENCES delivery_notes(id),
  order_line_id text NOT NULL REFERENCES order_lines(id), quantity_micros integer NOT NULL, location_id text REFERENCES inventory_locations(id),
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE purchase_requisitions (
  id text PRIMARY KEY NOT NULL, organization_id text NOT NULL REFERENCES organizations(id), number text NOT NULL, requested_by text NOT NULL,
  required_by text, status text NOT NULL DEFAULT 'draft', description text NOT NULL, estimated_minor integer NOT NULL DEFAULT 0,
  approved_by text, approved_at text, created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE goods_receipts (
  id text PRIMARY KEY NOT NULL, organization_id text NOT NULL REFERENCES organizations(id), purchase_order_id text NOT NULL REFERENCES orders(id),
  number text NOT NULL, received_date text NOT NULL, location_id text NOT NULL REFERENCES inventory_locations(id), status text NOT NULL DEFAULT 'draft',
  supplier_document_number text, created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE goods_receipt_lines (
  id text PRIMARY KEY NOT NULL, organization_id text NOT NULL REFERENCES organizations(id), goods_receipt_id text NOT NULL REFERENCES goods_receipts(id),
  order_line_id text NOT NULL REFERENCES order_lines(id), product_id text NOT NULL REFERENCES products(id), quantity_micros integer NOT NULL,
  unit_cost_minor integer NOT NULL, created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE recurring_templates (
  id text PRIMARY KEY NOT NULL, organization_id text NOT NULL REFERENCES organizations(id), type text NOT NULL, name text NOT NULL,
  template_json text NOT NULL, cadence text NOT NULL, next_run_at text NOT NULL, auto_post integer NOT NULL DEFAULT 0, active integer NOT NULL DEFAULT 1,
  last_run_at text, created_by text NOT NULL, created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE approval_policies (
  id text PRIMARY KEY NOT NULL, organization_id text NOT NULL REFERENCES organizations(id), document_type text NOT NULL,
  minimum_minor integer NOT NULL DEFAULT 0, maximum_minor integer, levels integer NOT NULL DEFAULT 1, approver_roles text NOT NULL,
  active integer NOT NULL DEFAULT 1, created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE document_approval_requests (
  id text PRIMARY KEY NOT NULL, organization_id text NOT NULL REFERENCES organizations(id), entity_type text NOT NULL, entity_id text NOT NULL,
  policy_id text REFERENCES approval_policies(id), status text NOT NULL DEFAULT 'pending', current_level integer NOT NULL DEFAULT 1,
  submitted_by text NOT NULL, submitted_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, decided_by text, decided_at text, comments text,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE documents ADD COLUMN approval_status text NOT NULL DEFAULT 'not_required';

CREATE TABLE document_attachments (
  id text PRIMARY KEY NOT NULL, organization_id text NOT NULL REFERENCES organizations(id), entity_type text NOT NULL, entity_id text NOT NULL,
  filename text NOT NULL, content_type text NOT NULL, object_key text NOT NULL, size_bytes integer NOT NULL, uploaded_by text NOT NULL,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE document_deliveries (
  id text PRIMARY KEY NOT NULL, organization_id text NOT NULL REFERENCES organizations(id), entity_type text NOT NULL, entity_id text NOT NULL,
  channel text NOT NULL, recipient text NOT NULL, status text NOT NULL DEFAULT 'queued', sent_at text, opened_at text, failure_reason text,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE expense_claims (
  id text PRIMARY KEY NOT NULL, organization_id text NOT NULL REFERENCES organizations(id), employee_id text NOT NULL REFERENCES employees(id),
  number text NOT NULL, claim_date text NOT NULL, currency text NOT NULL, status text NOT NULL DEFAULT 'draft', total_minor integer NOT NULL DEFAULT 0,
  submitted_at text, approved_by text, approved_at text, reimbursed_payment_id text REFERENCES payments(id),
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE expense_claim_lines (
  id text PRIMARY KEY NOT NULL, organization_id text NOT NULL REFERENCES organizations(id), claim_id text NOT NULL REFERENCES expense_claims(id),
  type text NOT NULL, expense_date text NOT NULL, description text NOT NULL, account_id text NOT NULL REFERENCES accounts(id),
  amount_minor integer NOT NULL, tax_minor integer NOT NULL DEFAULT 0, mileage_micros integer, per_diem_days integer, project_id text REFERENCES projects(id),
  receipt_attachment_id text REFERENCES document_attachments(id), created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE corporate_cards (
  id text PRIMARY KEY NOT NULL, organization_id text NOT NULL REFERENCES organizations(id), employee_id text REFERENCES employees(id),
  name text NOT NULL, last_four text NOT NULL, ledger_account_id text NOT NULL REFERENCES accounts(id), active integer NOT NULL DEFAULT 1,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE inventory_reservations (
  id text PRIMARY KEY NOT NULL, organization_id text NOT NULL REFERENCES organizations(id), product_id text NOT NULL REFERENCES products(id),
  location_id text NOT NULL REFERENCES inventory_locations(id), source_type text NOT NULL, source_id text NOT NULL,
  quantity_micros integer NOT NULL, status text NOT NULL DEFAULT 'active', expires_at text,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE inventory_lots (
  id text PRIMARY KEY NOT NULL, organization_id text NOT NULL REFERENCES organizations(id), product_id text NOT NULL REFERENCES products(id),
  location_id text NOT NULL REFERENCES inventory_locations(id), lot_number text NOT NULL, serial_number text, expiry_date text,
  quantity_micros integer NOT NULL, unit_cost_minor integer NOT NULL, received_at text NOT NULL,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE stock_counts (
  id text PRIMARY KEY NOT NULL, organization_id text NOT NULL REFERENCES organizations(id), location_id text NOT NULL REFERENCES inventory_locations(id),
  number text NOT NULL, count_date text NOT NULL, status text NOT NULL DEFAULT 'draft', counted_by text NOT NULL, approved_by text, approved_at text,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE stock_count_lines (
  id text PRIMARY KEY NOT NULL, organization_id text NOT NULL REFERENCES organizations(id), stock_count_id text NOT NULL REFERENCES stock_counts(id),
  product_id text NOT NULL REFERENCES products(id), expected_quantity_micros integer NOT NULL, counted_quantity_micros integer NOT NULL,
  adjustment_movement_id text REFERENCES inventory_movements(id), created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE receivable_actions (
  id text PRIMARY KEY NOT NULL, organization_id text NOT NULL REFERENCES organizations(id), document_id text NOT NULL REFERENCES documents(id),
  type text NOT NULL, action_date text NOT NULL, amount_minor integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'completed',
  notes text, journal_entry_id text REFERENCES journal_entries(id), created_by text NOT NULL,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE payment_plans (
  id text PRIMARY KEY NOT NULL, organization_id text NOT NULL REFERENCES organizations(id), document_id text NOT NULL REFERENCES documents(id),
  status text NOT NULL DEFAULT 'active', created_by text NOT NULL, created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE payment_plan_installments (
  id text PRIMARY KEY NOT NULL, organization_id text NOT NULL REFERENCES organizations(id), payment_plan_id text NOT NULL REFERENCES payment_plans(id),
  due_date text NOT NULL, amount_minor integer NOT NULL, paid_minor integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'pending',
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
