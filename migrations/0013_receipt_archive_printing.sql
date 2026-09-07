PRAGMA foreign_keys=ON;

-- Immutable receipt archive + auditable print history.
-- New receipts are snapshotted when recorded and finalized when posted.
-- Legacy posted receipts are snapshotted lazily the first time they are opened/printed.
CREATE TABLE IF NOT EXISTS school_fee_receipt_snapshots (
  receipt_id TEXT PRIMARY KEY REFERENCES school_fee_receipts(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  snapshot_version INTEGER NOT NULL DEFAULT 1,
  finalized INTEGER NOT NULL DEFAULT 0 CHECK(finalized IN (0,1)),
  amount_words TEXT NOT NULL,
  balance_before_minor INTEGER,
  balance_after_minor INTEGER,
  snapshot_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finalized_at TEXT,
  UNIQUE(organization_id, receipt_id)
);
CREATE INDEX IF NOT EXISTS school_fee_receipt_snapshots_org_idx
  ON school_fee_receipt_snapshots(organization_id, finalized, captured_at);

CREATE TABLE IF NOT EXISTS school_fee_receipt_prints (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  receipt_id TEXT NOT NULL REFERENCES school_fee_receipts(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL DEFAULT 'print' CHECK(purpose IN ('print','download')),
  copy_no INTEGER NOT NULL DEFAULT 0 CHECK(copy_no >= 0),
  snapshot_hash TEXT NOT NULL,
  requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  user_agent TEXT,
  ip_address TEXT,
  rendered_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS school_fee_receipt_prints_receipt_idx
  ON school_fee_receipt_prints(organization_id, receipt_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS school_fee_receipt_prints_copy_uq
  ON school_fee_receipt_prints(organization_id, receipt_id, copy_no)
  WHERE purpose='print';
