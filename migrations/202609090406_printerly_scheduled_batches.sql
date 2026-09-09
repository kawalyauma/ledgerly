-- Printerly v1.6: scheduled and multi-document batch printing.

CREATE TABLE IF NOT EXISTS prn_batches (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  batch_number TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'ready',
  defaults_json TEXT NOT NULL DEFAULT '{}',
  scheduled_at TEXT,
  creator_role TEXT,
  creator_scopes_json TEXT NOT NULL DEFAULT '[]',
  last_error TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  completed_at TEXT,
  UNIQUE(organization_id,batch_number)
);
CREATE INDEX IF NOT EXISTS idx_prn_batches_org_status
  ON prn_batches(organization_id,status,scheduled_at,created_at DESC);

CREATE TABLE IF NOT EXISTS prn_batch_items (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL REFERENCES prn_batches(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES prn_documents(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  settings_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  job_id TEXT REFERENCES prn_jobs(id) ON DELETE SET NULL,
  error_message TEXT,
  claim_token TEXT,
  claim_expires_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(batch_id,document_id)
);
CREATE INDEX IF NOT EXISTS idx_prn_batch_items_batch
  ON prn_batch_items(organization_id,batch_id,status,sort_order);
CREATE INDEX IF NOT EXISTS idx_prn_batch_items_claim
  ON prn_batch_items(status,claim_expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prn_batch_items_job
  ON prn_batch_items(organization_id,job_id) WHERE job_id IS NOT NULL;

-- The source reference is inserted atomically with the job itself. This makes
-- a batch item idempotent even if a dispatch worker crashes after job creation.
CREATE UNIQUE INDEX IF NOT EXISTS idx_prn_jobs_batch_source
  ON prn_jobs(organization_id,source_reference)
  WHERE source_module='printerly-batch' AND source_reference IS NOT NULL;

UPDATE app_modules
SET version='1.6.0',
    description='Secure remote print and scan management with accounting, quotas, policy approvals, scheduled printing and multi-document batches.',
    updated_at=CURRENT_TIMESTAMP
WHERE module_key='printerly';
