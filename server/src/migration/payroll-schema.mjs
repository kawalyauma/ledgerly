export async function ensurePayrollSchema(database) {
  await database.query(`
    CREATE TABLE IF NOT EXISTS employees (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      contact_id text NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
      employee_number text NOT NULL,
      hire_date date NOT NULL,
      termination_date date,
      pay_type text NOT NULL,
      base_pay_minor bigint NOT NULL DEFAULT 0,
      currency text NOT NULL,
      tax_identifier text,
      bank_details_encrypted text,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (organization_id,employee_number)
    );
    CREATE INDEX IF NOT EXISTS employees_org_active_idx ON employees (organization_id,active,employee_number);

    CREATE TABLE IF NOT EXISTS payroll_runs (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      number text NOT NULL,
      period_start date NOT NULL,
      period_end date NOT NULL,
      pay_date date NOT NULL,
      status text NOT NULL DEFAULT 'draft',
      currency text NOT NULL,
      gross_minor bigint NOT NULL DEFAULT 0,
      deductions_minor bigint NOT NULL DEFAULT 0,
      employer_costs_minor bigint NOT NULL DEFAULT 0,
      net_minor bigint NOT NULL DEFAULT 0,
      journal_entry_id text REFERENCES journal_entries(id) ON DELETE RESTRICT,
      reversal_run_id text,
      payment_batch_id text,
      calculation_snapshot text NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (organization_id,number),
      CHECK (period_end >= period_start)
    );
    CREATE INDEX IF NOT EXISTS payroll_runs_period_idx ON payroll_runs (organization_id,period_start,period_end,status);

    CREATE TABLE IF NOT EXISTS payroll_lines (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      payroll_run_id text NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
      employee_id text NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
      gross_minor bigint NOT NULL,
      deductions_minor bigint NOT NULL,
      employer_costs_minor bigint NOT NULL DEFAULT 0,
      net_minor bigint NOT NULL,
      components text NOT NULL DEFAULT '[]',
      paid_minor bigint NOT NULL DEFAULT 0 CHECK (paid_minor >= 0),
      balance_minor bigint NOT NULL DEFAULT 0 CHECK (balance_minor >= 0),
      payment_status text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','partially_paid','paid')),
      payslip_object_key text,
      delivered_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (organization_id,payroll_run_id,employee_id),
      CHECK (gross_minor >= 0 AND deductions_minor >= 0 AND employer_costs_minor >= 0 AND net_minor >= 0),
      CHECK (paid_minor <= net_minor),
      CHECK (balance_minor = net_minor - paid_minor)
    );
    CREATE INDEX IF NOT EXISTS payroll_lines_employee_idx ON payroll_lines (organization_id,employee_id,payroll_run_id);
    CREATE INDEX IF NOT EXISTS payroll_lines_balance_idx ON payroll_lines (organization_id,payroll_run_id,payment_status,balance_minor);

    CREATE TABLE IF NOT EXISTS payroll_components (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      code text NOT NULL,
      name text NOT NULL,
      type text NOT NULL CHECK (type IN ('earning','deduction','employer_cost')),
      calculation_type text NOT NULL CHECK (calculation_type IN ('fixed','percentage','input')),
      rate_micros bigint,
      amount_minor bigint,
      taxable boolean NOT NULL DEFAULT false,
      pensionable boolean NOT NULL DEFAULT false,
      statutory boolean NOT NULL DEFAULT false,
      employer_rate_micros bigint NOT NULL DEFAULT 0,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (organization_id,code)
    );

    CREATE TABLE IF NOT EXISTS payroll_rules (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name text NOT NULL,
      country_code text NOT NULL,
      currency text NOT NULL,
      effective_from date NOT NULL,
      effective_to date,
      status text NOT NULL DEFAULT 'draft',
      settings text NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS payroll_rule_bands (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      rule_id text NOT NULL REFERENCES payroll_rules(id) ON DELETE CASCADE,
      kind text NOT NULL,
      lower_minor bigint NOT NULL,
      upper_minor bigint,
      rate_micros bigint NOT NULL,
      fixed_minor bigint NOT NULL DEFAULT 0,
      employee_rate_micros bigint,
      employer_rate_micros bigint,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS payroll_rule_bands_rule_idx ON payroll_rule_bands (organization_id,rule_id,kind,lower_minor);

    CREATE TABLE IF NOT EXISTS employee_payroll_components (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      employee_id text NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      component_id text NOT NULL REFERENCES payroll_components(id) ON DELETE RESTRICT,
      amount_minor bigint,
      rate_micros bigint,
      effective_from date NOT NULL,
      effective_to date,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS employee_payroll_components_active_idx ON employee_payroll_components (organization_id,employee_id,effective_from,effective_to);

    CREATE TABLE IF NOT EXISTS payroll_inputs (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      employee_id text NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
      input_date date NOT NULL,
      type text NOT NULL,
      units_micros bigint NOT NULL DEFAULT 0,
      amount_minor bigint NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'approved',
      metadata text NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS payroll_inputs_period_idx ON payroll_inputs (organization_id,employee_id,input_date,type);

    CREATE TABLE IF NOT EXISTS payroll_payment_batches (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      payroll_run_id text NOT NULL REFERENCES payroll_runs(id) ON DELETE RESTRICT,
      number text NOT NULL,
      status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','processed','cancelled')),
      bank_account_id text REFERENCES accounts(id) ON DELETE RESTRICT,
      payment_date date NOT NULL,
      total_minor bigint NOT NULL CHECK (total_minor >= 0),
      items text NOT NULL DEFAULT '[]',
      approved_by text REFERENCES users(id) ON DELETE SET NULL,
      processed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (organization_id,number)
    );
    CREATE INDEX IF NOT EXISTS payroll_payment_batches_run_idx ON payroll_payment_batches (organization_id,payroll_run_id,status);

    CREATE TABLE IF NOT EXISTS payroll_statutory_returns (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      payroll_run_id text REFERENCES payroll_runs(id) ON DELETE SET NULL,
      year integer NOT NULL,
      period text NOT NULL,
      authority text NOT NULL,
      type text NOT NULL,
      status text NOT NULL DEFAULT 'draft',
      amount_minor bigint NOT NULL DEFAULT 0,
      payload text NOT NULL DEFAULT '{}',
      filed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS pay_mobile_payment_intents (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      device_id text,
      payload_json text NOT NULL,
      created_by text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      client_created_at timestamptz NOT NULL,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','applied','rejected')),
      server_payment_id text REFERENCES payments(id) ON DELETE SET NULL,
      error_message text,
      attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      last_attempt_at timestamptz,
      next_attempt_at timestamptz,
      applied_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS pay_mobile_payment_retry_idx ON pay_mobile_payment_intents (status,next_attempt_at,created_at);
  `);
}
