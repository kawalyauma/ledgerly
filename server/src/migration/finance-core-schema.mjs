export async function ensureFinanceCoreSchema(database) {
  await database.query(`
    CREATE TABLE IF NOT EXISTS contacts (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      type text NOT NULL,
      code text,
      name text NOT NULL,
      email text,
      tax_number text,
      payment_terms_days integer NOT NULL DEFAULT 0,
      active boolean NOT NULL DEFAULT true,
      custom_fields text NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS contacts_org_type_idx ON contacts (organization_id,type);

    CREATE TABLE IF NOT EXISTS dimensions (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      type text NOT NULL,
      code text NOT NULL,
      name text NOT NULL,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (organization_id,type,code)
    );

    CREATE TABLE IF NOT EXISTS projects (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      customer_id text REFERENCES contacts(id) ON DELETE RESTRICT,
      code text NOT NULL,
      name text NOT NULL,
      status text NOT NULL DEFAULT 'active',
      budget_amount_minor bigint NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (organization_id,code)
    );

    CREATE TABLE IF NOT EXISTS products (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      sku text NOT NULL,
      name text NOT NULL,
      type text NOT NULL,
      income_account_id text REFERENCES accounts(id) ON DELETE RESTRICT,
      expense_account_id text REFERENCES accounts(id) ON DELETE RESTRICT,
      inventory_account_id text REFERENCES accounts(id) ON DELETE RESTRICT,
      quantity_on_hand_micros bigint NOT NULL DEFAULT 0,
      average_cost_minor bigint NOT NULL DEFAULT 0,
      reorder_point_micros bigint NOT NULL DEFAULT 0,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (organization_id,sku)
    );

    CREATE TABLE IF NOT EXISTS budgets (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name text NOT NULL,
      fiscal_year integer NOT NULL,
      status text NOT NULL DEFAULT 'draft',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS budget_lines (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      budget_id text NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
      account_id text NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      period text NOT NULL,
      amount_minor bigint NOT NULL,
      class_id text REFERENCES dimensions(id) ON DELETE RESTRICT,
      department_id text REFERENCES dimensions(id) ON DELETE RESTRICT,
      location_id text REFERENCES dimensions(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS budget_lines_budget_idx ON budget_lines (organization_id,budget_id,period);

    CREATE TABLE IF NOT EXISTS journal_entries (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      entry_number text NOT NULL,
      transaction_date date NOT NULL,
      posting_date date NOT NULL,
      description text NOT NULL,
      reference text,
      source_type text NOT NULL DEFAULT 'manual',
      source_id text,
      status text NOT NULL DEFAULT 'draft',
      currency text NOT NULL,
      exchange_rate_micros bigint NOT NULL DEFAULT 1000000 CHECK (exchange_rate_micros > 0),
      reversal_of_id text REFERENCES journal_entries(id) ON DELETE RESTRICT,
      posted_at timestamptz,
      posted_by text,
      idempotency_key text,
      metadata text NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (organization_id,entry_number),
      UNIQUE (organization_id,idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS journals_org_posting_idx ON journal_entries (organization_id,posting_date,status);
    CREATE INDEX IF NOT EXISTS journals_source_idx ON journal_entries (organization_id,source_type,source_id);

    CREATE TABLE IF NOT EXISTS journal_lines (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      journal_entry_id text NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
      account_id text NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      description text,
      debit_minor bigint NOT NULL DEFAULT 0 CHECK (debit_minor >= 0),
      credit_minor bigint NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),
      base_debit_minor bigint NOT NULL DEFAULT 0 CHECK (base_debit_minor >= 0),
      base_credit_minor bigint NOT NULL DEFAULT 0 CHECK (base_credit_minor >= 0),
      contact_id text REFERENCES contacts(id) ON DELETE RESTRICT,
      project_id text REFERENCES projects(id) ON DELETE RESTRICT,
      class_id text REFERENCES dimensions(id) ON DELETE RESTRICT,
      department_id text REFERENCES dimensions(id) ON DELETE RESTRICT,
      location_id text REFERENCES dimensions(id) ON DELETE RESTRICT,
      tax_code text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK ((debit_minor = 0) <> (credit_minor = 0))
    );
    CREATE INDEX IF NOT EXISTS journal_lines_entry_idx ON journal_lines (organization_id,journal_entry_id);
    CREATE INDEX IF NOT EXISTS journal_lines_account_idx ON journal_lines (organization_id,account_id);
    CREATE INDEX IF NOT EXISTS journal_lines_contact_idx ON journal_lines (organization_id,contact_id);

    CREATE TABLE IF NOT EXISTS documents (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      type text NOT NULL,
      number text NOT NULL,
      contact_id text REFERENCES contacts(id) ON DELETE RESTRICT,
      issue_date date NOT NULL,
      due_date date,
      status text NOT NULL DEFAULT 'draft',
      currency text NOT NULL,
      subtotal_minor bigint NOT NULL,
      tax_minor bigint NOT NULL DEFAULT 0,
      total_minor bigint NOT NULL CHECK (total_minor >= 0),
      paid_minor bigint NOT NULL DEFAULT 0 CHECK (paid_minor >= 0 AND paid_minor <= total_minor),
      journal_entry_id text REFERENCES journal_entries(id) ON DELETE RESTRICT,
      custom_fields text NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (organization_id,type,number)
    );
    CREATE INDEX IF NOT EXISTS documents_ageing_idx ON documents (organization_id,type,status,due_date);

    CREATE TABLE IF NOT EXISTS document_lines (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      product_id text REFERENCES products(id) ON DELETE RESTRICT,
      description text NOT NULL,
      quantity_micros bigint NOT NULL DEFAULT 1000000,
      unit_price_minor bigint NOT NULL,
      subtotal_minor bigint NOT NULL,
      tax_minor bigint NOT NULL DEFAULT 0,
      total_minor bigint NOT NULL,
      project_id text REFERENCES projects(id) ON DELETE RESTRICT,
      account_id text NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      tax_account_id text REFERENCES accounts(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS document_lines_doc_idx ON document_lines (organization_id,document_id);

    CREATE TABLE IF NOT EXISTS payments (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      type text NOT NULL,
      number text NOT NULL,
      contact_id text NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
      bank_account_id text NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      control_account_id text NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      payment_date date NOT NULL,
      currency text NOT NULL,
      amount_minor bigint NOT NULL CHECK (amount_minor > 0),
      reference text,
      status text NOT NULL DEFAULT 'draft',
      journal_entry_id text REFERENCES journal_entries(id) ON DELETE RESTRICT,
      idempotency_key text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (organization_id,type,number),
      UNIQUE (organization_id,idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS payments_org_date_idx ON payments (organization_id,payment_date,status);

    CREATE TABLE IF NOT EXISTS payment_allocations (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      payment_id text NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
      document_id text NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
      amount_minor bigint NOT NULL CHECK (amount_minor > 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (organization_id,payment_id,document_id)
    );
    CREATE INDEX IF NOT EXISTS payment_allocations_document_idx ON payment_allocations (organization_id,document_id);
  `);
}
