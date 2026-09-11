export async function ensureFinanceOperationsSchema(database) {
  await database.query(`
    CREATE TABLE IF NOT EXISTS fiscal_periods (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name text NOT NULL, starts_on date NOT NULL, ends_on date NOT NULL, status text NOT NULL DEFAULT 'open',
      locked_at timestamptz, locked_by text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (organization_id,starts_on,ends_on), CHECK (ends_on >= starts_on)
    );
    CREATE INDEX IF NOT EXISTS fiscal_periods_org_range_idx ON fiscal_periods (organization_id,starts_on,ends_on);

    CREATE TABLE IF NOT EXISTS account_groups (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      code text NOT NULL, name text NOT NULL, type text NOT NULL, parent_group_id text REFERENCES account_groups(id) ON DELETE RESTRICT,
      active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (organization_id,code)
    );
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS parent_account_id text REFERENCES accounts(id) ON DELETE RESTRICT;
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS account_group_id text REFERENCES account_groups(id) ON DELETE RESTRICT;
    ALTER TABLE contacts ADD COLUMN IF NOT EXISTS credit_limit_minor bigint NOT NULL DEFAULT 0;
    ALTER TABLE contacts ADD COLUMN IF NOT EXISTS pricing_tier text;
    ALTER TABLE contacts ADD COLUMN IF NOT EXISTS archived_at timestamptz;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS costing_method text NOT NULL DEFAULT 'average';
    ALTER TABLE products ADD COLUMN IF NOT EXISTS committed_quantity_micros bigint NOT NULL DEFAULT 0;
    ALTER TABLE documents ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'not_required';
    ALTER TABLE document_lines ADD COLUMN IF NOT EXISTS dimensions_json text NOT NULL DEFAULT '{}';

    CREATE TABLE IF NOT EXISTS contact_addresses (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      contact_id text NOT NULL REFERENCES contacts(id) ON DELETE CASCADE, type text NOT NULL, line1 text NOT NULL, line2 text,
      city text, state text, postal_code text, country text NOT NULL, is_default boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS contact_addresses_contact_idx ON contact_addresses (organization_id,contact_id);
    CREATE TABLE IF NOT EXISTS contact_people (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      contact_id text NOT NULL REFERENCES contacts(id) ON DELETE CASCADE, name text NOT NULL, email text, phone text, role text,
      is_primary boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS supplier_bank_accounts (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      contact_id text NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT, bank_name text NOT NULL, account_name text NOT NULL,
      account_number_masked text NOT NULL, account_number_encrypted text NOT NULL, branch_code text, swift_bic text, currency text NOT NULL,
      active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS tax_jurisdictions (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, code text NOT NULL,
      name text NOT NULL, country text NOT NULL, authority_name text, active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (organization_id,code)
    );
    CREATE TABLE IF NOT EXISTS tax_codes (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      jurisdiction_id text REFERENCES tax_jurisdictions(id) ON DELETE RESTRICT, code text NOT NULL, name text NOT NULL,
      rate_micros bigint NOT NULL, calculation text NOT NULL DEFAULT 'exclusive', tax_type text NOT NULL,
      recoverable_percent_micros bigint NOT NULL DEFAULT 1000000, sales_account_id text REFERENCES accounts(id) ON DELETE RESTRICT,
      purchase_account_id text REFERENCES accounts(id) ON DELETE RESTRICT, active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (organization_id,code)
    );
    CREATE TABLE IF NOT EXISTS tax_exemptions (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      contact_id text REFERENCES contacts(id) ON DELETE CASCADE, tax_code_id text REFERENCES tax_codes(id) ON DELETE CASCADE,
      certificate_number text, reason text NOT NULL, starts_on date, ends_on date, active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS tax_returns (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      jurisdiction_id text NOT NULL REFERENCES tax_jurisdictions(id) ON DELETE RESTRICT, period_start date NOT NULL, period_end date NOT NULL,
      status text NOT NULL DEFAULT 'draft', output_tax_minor bigint NOT NULL DEFAULT 0, input_tax_minor bigint NOT NULL DEFAULT 0,
      withholding_minor bigint NOT NULL DEFAULT 0, net_tax_minor bigint NOT NULL DEFAULT 0, prepared_by text NOT NULL,
      locked_at timestamptz, locked_by text, filed_at timestamptz, filing_reference text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS bank_accounts (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      ledger_account_id text NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT, name text NOT NULL, bank_name text,
      account_number_masked text, currency text NOT NULL, opening_balance_minor bigint NOT NULL DEFAULT 0, active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (organization_id,ledger_account_id)
    );
    CREATE TABLE IF NOT EXISTS bank_statement_imports (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      bank_account_id text NOT NULL REFERENCES bank_accounts(id) ON DELETE RESTRICT, filename text NOT NULL,
      statement_start date, statement_end date, opening_balance_minor bigint, closing_balance_minor bigint,
      status text NOT NULL DEFAULT 'imported', imported_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS bank_transactions (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      bank_account_id text NOT NULL REFERENCES bank_accounts(id) ON DELETE RESTRICT, import_id text REFERENCES bank_statement_imports(id) ON DELETE SET NULL,
      external_id text, transaction_date date NOT NULL, description text NOT NULL, reference text, amount_minor bigint NOT NULL,
      status text NOT NULL DEFAULT 'unmatched', matched_journal_line_id text REFERENCES journal_lines(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (organization_id,bank_account_id,external_id)
    );
    CREATE INDEX IF NOT EXISTS bank_transactions_match_idx ON bank_transactions (organization_id,bank_account_id,status,transaction_date);
    CREATE TABLE IF NOT EXISTS bank_reconciliations (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      bank_account_id text NOT NULL REFERENCES bank_accounts(id) ON DELETE RESTRICT, statement_date date NOT NULL,
      statement_balance_minor bigint NOT NULL, ledger_balance_minor bigint NOT NULL, difference_minor bigint NOT NULL,
      status text NOT NULL DEFAULT 'draft', prepared_by text NOT NULL, completed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS inventory_locations (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      code text NOT NULL, name text NOT NULL, active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (organization_id,code)
    );
    CREATE TABLE IF NOT EXISTS inventory_balances (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      product_id text NOT NULL REFERENCES products(id) ON DELETE RESTRICT, location_id text NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
      quantity_micros bigint NOT NULL DEFAULT 0, average_cost_minor bigint NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (organization_id,product_id,location_id)
    );
    CREATE TABLE IF NOT EXISTS inventory_movements (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      product_id text NOT NULL REFERENCES products(id) ON DELETE RESTRICT, location_id text NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
      movement_date date NOT NULL, type text NOT NULL, quantity_micros bigint NOT NULL, unit_cost_minor bigint NOT NULL DEFAULT 0,
      source_type text, source_id text, journal_entry_id text REFERENCES journal_entries(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS inventory_movements_product_idx ON inventory_movements (organization_id,product_id,location_id,movement_date);
    CREATE TABLE IF NOT EXISTS inventory_reservations (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      product_id text NOT NULL REFERENCES products(id) ON DELETE RESTRICT, location_id text NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
      source_type text NOT NULL, source_id text NOT NULL, quantity_micros bigint NOT NULL CHECK (quantity_micros > 0),
      status text NOT NULL DEFAULT 'active', expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS inventory_lots (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      product_id text NOT NULL REFERENCES products(id) ON DELETE RESTRICT, location_id text NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
      lot_number text NOT NULL, serial_number text, expiry_date date, quantity_micros bigint NOT NULL, unit_cost_minor bigint NOT NULL,
      received_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS stock_counts (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      location_id text NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT, number text NOT NULL, count_date date NOT NULL,
      status text NOT NULL DEFAULT 'draft', counted_by text NOT NULL, approved_by text, approved_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (organization_id,number)
    );
    CREATE TABLE IF NOT EXISTS stock_count_lines (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      stock_count_id text NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE, product_id text NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      expected_quantity_micros bigint NOT NULL, counted_quantity_micros bigint NOT NULL,
      adjustment_movement_id text REFERENCES inventory_movements(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS purchase_requisitions (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, number text NOT NULL,
      requested_by text NOT NULL, required_by date, status text NOT NULL DEFAULT 'draft', description text NOT NULL,
      estimated_minor bigint NOT NULL DEFAULT 0, approved_by text, approved_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (organization_id,number)
    );
    CREATE TABLE IF NOT EXISTS goods_receipts (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      purchase_order_id text NOT NULL, number text NOT NULL, received_date date NOT NULL,
      location_id text NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT, status text NOT NULL DEFAULT 'draft', supplier_document_number text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (organization_id,number)
    );
    CREATE TABLE IF NOT EXISTS goods_receipt_lines (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      goods_receipt_id text NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE, order_line_id text NOT NULL,
      product_id text NOT NULL REFERENCES products(id) ON DELETE RESTRICT, quantity_micros bigint NOT NULL CHECK (quantity_micros > 0),
      unit_cost_minor bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS approval_policies (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      document_type text NOT NULL, minimum_minor bigint NOT NULL DEFAULT 0, maximum_minor bigint, levels integer NOT NULL DEFAULT 1,
      approver_roles text NOT NULL, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS document_approval_requests (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      entity_type text NOT NULL, entity_id text NOT NULL, policy_id text REFERENCES approval_policies(id) ON DELETE SET NULL,
      status text NOT NULL DEFAULT 'pending', current_level integer NOT NULL DEFAULT 1, submitted_by text NOT NULL,
      submitted_at timestamptz NOT NULL DEFAULT now(), decided_by text, decided_at timestamptz, comments text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS approval_requests_pending_idx ON document_approval_requests (organization_id,status,entity_type);

    CREATE TABLE IF NOT EXISTS document_attachments (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      entity_type text NOT NULL, entity_id text NOT NULL, filename text NOT NULL, content_type text NOT NULL,
      object_key text NOT NULL, size_bytes bigint NOT NULL CHECK (size_bytes >= 0), uploaded_by text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS expense_claims (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      employee_id text NOT NULL REFERENCES employees(id) ON DELETE RESTRICT, number text NOT NULL, claim_date date NOT NULL,
      currency text NOT NULL, status text NOT NULL DEFAULT 'draft', total_minor bigint NOT NULL DEFAULT 0,
      submitted_at timestamptz, approved_by text, approved_at timestamptz, reimbursed_payment_id text REFERENCES payments(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (organization_id,number)
    );
    CREATE TABLE IF NOT EXISTS expense_claim_lines (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      claim_id text NOT NULL REFERENCES expense_claims(id) ON DELETE CASCADE, type text NOT NULL, expense_date date NOT NULL,
      description text NOT NULL, account_id text NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT, amount_minor bigint NOT NULL,
      tax_minor bigint NOT NULL DEFAULT 0, mileage_micros bigint, per_diem_days integer, project_id text REFERENCES projects(id) ON DELETE SET NULL,
      receipt_attachment_id text REFERENCES document_attachments(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS ledgerly_mobile_document_intents (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, device_id text,
      intent_type text NOT NULL CHECK (intent_type IN ('invoice','bill')), payload_json text NOT NULL,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','retry','applied','rejected')),
      server_document_id text REFERENCES documents(id) ON DELETE SET NULL, error_code text, error_message text,
      attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz, created_by text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      client_created_at timestamptz NOT NULL, applied_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS ledgerly_mobile_document_intents_pending_idx ON ledgerly_mobile_document_intents (status,next_attempt_at,created_at);
    CREATE TABLE IF NOT EXISTS ledgerly_mobile_journal_intents (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, device_id text,
      payload_json text NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','retry','applied','rejected')),
      server_journal_id text REFERENCES journal_entries(id) ON DELETE SET NULL, error_code text, error_message text,
      attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz, created_by text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      client_created_at timestamptz NOT NULL, applied_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS ledgerly_mobile_journal_intents_pending_idx ON ledgerly_mobile_journal_intents (status,next_attempt_at,created_at);
  `);
}
