export async function ensureSchoolFeesSchema(database) {
  await database.query(`
    ALTER TABLE payment_allocations ADD COLUMN IF NOT EXISTS reversed_at timestamptz;
    CREATE INDEX IF NOT EXISTS payment_allocations_active_payment_idx
      ON payment_allocations (organization_id,payment_id) WHERE reversed_at IS NULL;

    CREATE TABLE IF NOT EXISTS school_fee_accounting_settings (
      organization_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
      receivable_account_id text NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      discount_account_id text REFERENCES accounts(id) ON DELETE SET NULL,
      scholarship_account_id text REFERENCES accounts(id) ON DELETE SET NULL,
      writeoff_account_id text REFERENCES accounts(id) ON DELETE SET NULL,
      late_fee_income_account_id text REFERENCES accounts(id) ON DELETE SET NULL,
      default_currency text NOT NULL DEFAULT 'UGX',
      invoice_due_days integer NOT NULL DEFAULT 30,
      auto_post_invoices boolean NOT NULL DEFAULT true,
      auto_post_receipts boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS school_fee_structures (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      code text NOT NULL,
      name text NOT NULL,
      academic_year_id text NOT NULL,
      term_id text,
      campus_id text,
      class_level_id text,
      class_id text,
      stream_id text,
      residency_status text CHECK (residency_status IS NULL OR residency_status IN ('day','boarding','hybrid')),
      student_category text,
      currency text NOT NULL DEFAULT 'UGX',
      effective_from date,
      effective_to date,
      priority integer NOT NULL DEFAULT 100,
      status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
      notes text,
      metadata_json text NOT NULL DEFAULT '{}',
      created_by text REFERENCES users(id) ON DELETE SET NULL,
      updated_by text REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (organization_id,code)
    );
    CREATE INDEX IF NOT EXISTS school_fee_structures_match_idx
      ON school_fee_structures (organization_id,academic_year_id,term_id,campus_id,class_level_id,class_id,stream_id,status,priority);

    CREATE TABLE IF NOT EXISTS school_fee_structure_lines (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      structure_id text NOT NULL REFERENCES school_fee_structures(id) ON DELETE CASCADE,
      fee_category_id text NOT NULL,
      amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
      quantity_micros bigint NOT NULL DEFAULT 1000000 CHECK (quantity_micros > 0),
      due_date date,
      mandatory boolean NOT NULL DEFAULT true,
      discountable boolean NOT NULL DEFAULT true,
      installment_allowed boolean NOT NULL DEFAULT true,
      refundable boolean NOT NULL DEFAULT false,
      tax_minor bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
      tax_account_id text REFERENCES accounts(id) ON DELETE SET NULL,
      description text,
      metadata_json text NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (organization_id,structure_id,fee_category_id)
    );
    CREATE INDEX IF NOT EXISTS school_fee_structure_lines_structure_idx
      ON school_fee_structure_lines (organization_id,structure_id);

    CREATE TABLE IF NOT EXISTS school_fee_billing_batches (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      batch_number text NOT NULL,
      academic_year_id text NOT NULL,
      term_id text,
      structure_id text REFERENCES school_fee_structures(id) ON DELETE SET NULL,
      billing_date date NOT NULL,
      due_date date,
      criteria_json text NOT NULL DEFAULT '{}',
      status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','processing','completed','partial','failed','cancelled')),
      total_students integer NOT NULL DEFAULT 0,
      billed_students integer NOT NULL DEFAULT 0,
      failed_students integer NOT NULL DEFAULT 0,
      total_amount_minor bigint NOT NULL DEFAULT 0,
      errors_json text NOT NULL DEFAULT '[]',
      idempotency_key text NOT NULL,
      created_by text REFERENCES users(id) ON DELETE SET NULL,
      completed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (organization_id,batch_number),
      UNIQUE (organization_id,idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS school_student_fee_charges (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      student_id text NOT NULL,
      payer_contact_id text NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
      academic_year_id text,
      term_id text,
      campus_id text,
      class_id text,
      stream_id text,
      fee_category_id text NOT NULL,
      structure_line_id text REFERENCES school_fee_structure_lines(id) ON DELETE SET NULL,
      billing_batch_id text REFERENCES school_fee_billing_batches(id) ON DELETE SET NULL,
      parent_charge_id text REFERENCES school_student_fee_charges(id) ON DELETE SET NULL,
      description text NOT NULL,
      quantity_micros bigint NOT NULL DEFAULT 1000000,
      gross_minor bigint NOT NULL CHECK (gross_minor >= 0),
      discount_minor bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
      scholarship_minor bigint NOT NULL DEFAULT 0 CHECK (scholarship_minor >= 0),
      waiver_minor bigint NOT NULL DEFAULT 0 CHECK (waiver_minor >= 0),
      tax_minor bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
      total_minor bigint NOT NULL CHECK (total_minor >= 0),
      credited_minor bigint NOT NULL DEFAULT 0 CHECK (credited_minor >= 0),
      written_off_minor bigint NOT NULL DEFAULT 0 CHECK (written_off_minor >= 0),
      currency text NOT NULL DEFAULT 'UGX',
      charge_date date NOT NULL,
      due_date date,
      source text NOT NULL DEFAULT 'manual' CHECK (source IN ('structure','manual','opening_balance','late_fee','adjustment','import')),
      status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','invoiced','partially_settled','settled','credited','waived','written_off','cancelled')),
      document_id text REFERENCES documents(id) ON DELETE SET NULL,
      credit_document_id text REFERENCES documents(id) ON DELETE SET NULL,
      metadata_json text NOT NULL DEFAULT '{}',
      created_by text REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS school_fee_charges_student_idx
      ON school_student_fee_charges (organization_id,student_id,academic_year_id,term_id,status,due_date);
    CREATE INDEX IF NOT EXISTS school_fee_charges_document_idx
      ON school_student_fee_charges (organization_id,document_id);

    CREATE TABLE IF NOT EXISTS school_fee_charge_adjustments (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      charge_id text NOT NULL REFERENCES school_student_fee_charges(id) ON DELETE CASCADE,
      student_id text NOT NULL,
      award_id text,
      scheme_id text,
      adjustment_type text NOT NULL,
      amount_minor bigint NOT NULL CHECK (amount_minor > 0),
      reason text,
      accounting_treatment text NOT NULL DEFAULT 'net_revenue' CHECK (accounting_treatment IN ('net_revenue','expense')),
      account_id text REFERENCES accounts(id) ON DELETE SET NULL,
      journal_entry_id text REFERENCES journal_entries(id) ON DELETE SET NULL,
      status text NOT NULL DEFAULT 'applied' CHECK (status IN ('applied','reversed')),
      reversed_at timestamptz,
      created_by text REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS school_fee_receipts (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      receipt_number text NOT NULL,
      student_id text,
      payer_contact_id text NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
      payment_method_id text,
      payment_id text NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
      supporting_file_id text,
      payment_date date NOT NULL,
      currency text NOT NULL,
      amount_minor bigint NOT NULL CHECK (amount_minor > 0),
      allocated_minor bigint NOT NULL DEFAULT 0 CHECK (allocated_minor >= 0),
      unallocated_minor bigint NOT NULL DEFAULT 0 CHECK (unallocated_minor >= 0),
      reference text,
      notes text,
      status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','reversed')),
      reversed_at timestamptz,
      created_by text REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (organization_id,receipt_number),
      UNIQUE (organization_id,payment_id),
      CHECK (allocated_minor + unallocated_minor = amount_minor)
    );
    CREATE INDEX IF NOT EXISTS school_fee_receipts_student_idx
      ON school_fee_receipts (organization_id,student_id,payment_date,status);

    CREATE TABLE IF NOT EXISTS school_fee_receipt_snapshots (
      receipt_id text PRIMARY KEY REFERENCES school_fee_receipts(id) ON DELETE CASCADE,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      snapshot_version integer NOT NULL DEFAULT 1,
      finalized boolean NOT NULL DEFAULT false,
      amount_words text NOT NULL,
      balance_before_minor bigint,
      balance_after_minor bigint,
      snapshot_json text NOT NULL,
      content_hash text NOT NULL,
      captured_at timestamptz NOT NULL DEFAULT now(),
      finalized_at timestamptz,
      UNIQUE (organization_id,receipt_id)
    );

    CREATE TABLE IF NOT EXISTS school_fee_receipt_prints (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      receipt_id text NOT NULL REFERENCES school_fee_receipts(id) ON DELETE CASCADE,
      purpose text NOT NULL DEFAULT 'print' CHECK (purpose IN ('print','download')),
      copy_no integer NOT NULL DEFAULT 0 CHECK (copy_no >= 0),
      snapshot_hash text NOT NULL,
      requested_by text REFERENCES users(id) ON DELETE SET NULL,
      user_agent text,
      ip_address text,
      rendered_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS school_fee_receipt_prints_copy_uq
      ON school_fee_receipt_prints (organization_id,receipt_id,copy_no) WHERE purpose='print';

    CREATE TABLE IF NOT EXISTS school_fee_billing_guards (
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      student_id text NOT NULL,
      structure_line_id text NOT NULL REFERENCES school_fee_structure_lines(id) ON DELETE CASCADE,
      academic_year_id text NOT NULL,
      term_key text NOT NULL DEFAULT '',
      charge_id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (organization_id,student_id,structure_line_id,academic_year_id,term_key),
      UNIQUE (organization_id,charge_id)
    );

    CREATE TABLE IF NOT EXISTS school_fee_billing_batch_results (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      batch_id text NOT NULL REFERENCES school_fee_billing_batches(id) ON DELETE CASCADE,
      student_id text NOT NULL,
      outcome text NOT NULL CHECK (outcome IN ('billed','partial','skipped','failed')),
      billed_items integer NOT NULL DEFAULT 0,
      skipped_items integer NOT NULL DEFAULT 0,
      failed_items integer NOT NULL DEFAULT 0,
      total_amount_minor bigint NOT NULL DEFAULT 0,
      code text,
      message text,
      details_json text NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (organization_id,batch_id,student_id)
    );

    CREATE TABLE IF NOT EXISTS school_fee_charge_reversals (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      charge_id text NOT NULL REFERENCES school_student_fee_charges(id) ON DELETE RESTRICT,
      reversal_batch_id text,
      posting_date date NOT NULL,
      reason text NOT NULL,
      reversal_kind text NOT NULL CHECK (reversal_kind IN ('posted_reversal','draft_void')),
      reversal_journal_id text REFERENCES journal_entries(id) ON DELETE SET NULL,
      reversed_by text REFERENCES users(id) ON DELETE SET NULL,
      reversed_at timestamptz NOT NULL DEFAULT now(),
      metadata_json text NOT NULL DEFAULT '{}',
      UNIQUE (organization_id,charge_id)
    );

    CREATE TABLE IF NOT EXISTS school_mobile_fee_receipt_intents (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      device_id text,
      student_id text,
      payer_contact_id text,
      payment_method_id text NOT NULL,
      supporting_file_id text,
      payment_date date NOT NULL,
      currency text NOT NULL,
      amount_minor bigint NOT NULL CHECK (amount_minor > 0),
      reference text,
      notes text,
      allocations_json text NOT NULL DEFAULT '[]',
      auto_allocate boolean NOT NULL DEFAULT true,
      captured_at timestamptz NOT NULL,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','posted','failed','cancelled')),
      official_receipt_id text REFERENCES school_fee_receipts(id) ON DELETE SET NULL,
      payment_id text REFERENCES payments(id) ON DELETE SET NULL,
      attempts integer NOT NULL DEFAULT 0,
      last_attempt_at timestamptz,
      next_attempt_at timestamptz,
      last_error text,
      processed_at timestamptz,
      created_by text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (organization_id,id)
    );
    CREATE INDEX IF NOT EXISTS school_mobile_fee_intents_queue_idx
      ON school_mobile_fee_receipt_intents (status,next_attempt_at,updated_at,created_at);
  `);
}
