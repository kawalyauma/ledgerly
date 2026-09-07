-- Ledgerly v9.10.2 — school-fee billing integrity, batch results and reversals.
-- Draft invoices remain operational drafts and do not belong to the posted fee balance.

CREATE TABLE IF NOT EXISTS school_fee_billing_guards (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  structure_line_id TEXT NOT NULL REFERENCES school_fee_structure_lines(id) ON DELETE CASCADE,
  academic_year_id TEXT NOT NULL REFERENCES school_academic_years(id) ON DELETE CASCADE,
  term_key TEXT NOT NULL DEFAULT '',
  charge_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, student_id, structure_line_id, academic_year_id, term_key),
  UNIQUE (organization_id, charge_id)
);
CREATE INDEX IF NOT EXISTS school_fee_billing_guards_charge_idx
  ON school_fee_billing_guards(organization_id, charge_id);

-- Protect existing active structure billings. If older data already contains duplicates,
-- one surviving charge is enough to block a third billing until all active duplicates are reversed.
INSERT OR IGNORE INTO school_fee_billing_guards
  (organization_id, student_id, structure_line_id, academic_year_id, term_key, charge_id)
SELECT c.organization_id, c.student_id, c.structure_line_id, c.academic_year_id,
       COALESCE(c.term_id,''), MIN(c.id)
FROM school_student_fee_charges c
WHERE c.structure_line_id IS NOT NULL
  AND c.academic_year_id IS NOT NULL
  AND c.status <> 'cancelled'
GROUP BY c.organization_id, c.student_id, c.structure_line_id, c.academic_year_id, COALESCE(c.term_id,'');

CREATE TABLE IF NOT EXISTS school_fee_billing_batch_results (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL REFERENCES school_fee_billing_batches(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  outcome TEXT NOT NULL CHECK(outcome IN ('billed','partial','skipped','failed')),
  billed_items INTEGER NOT NULL DEFAULT 0,
  skipped_items INTEGER NOT NULL DEFAULT 0,
  failed_items INTEGER NOT NULL DEFAULT 0,
  total_amount_minor INTEGER NOT NULL DEFAULT 0,
  code TEXT,
  message TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, batch_id, student_id)
);
CREATE INDEX IF NOT EXISTS school_fee_batch_results_idx
  ON school_fee_billing_batch_results(organization_id, batch_id, outcome, student_id);

CREATE TABLE IF NOT EXISTS school_fee_charge_reversals (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  charge_id TEXT NOT NULL REFERENCES school_student_fee_charges(id) ON DELETE RESTRICT,
  reversal_batch_id TEXT,
  posting_date TEXT NOT NULL,
  reason TEXT NOT NULL,
  reversal_kind TEXT NOT NULL CHECK(reversal_kind IN ('posted_reversal','draft_void')),
  reversal_journal_id TEXT REFERENCES journal_entries(id) ON DELETE SET NULL,
  reversed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reversed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE (organization_id, charge_id)
);
CREATE INDEX IF NOT EXISTS school_fee_charge_reversals_batch_idx
  ON school_fee_charge_reversals(organization_id, reversal_batch_id, reversed_at);
