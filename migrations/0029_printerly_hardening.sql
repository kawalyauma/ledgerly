-- Printerly hardening: private R2 documents and tenant-safe printer identities.

CREATE TABLE IF NOT EXISTS prn_documents (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  checksum_sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'staged' CHECK (status IN ('staged','attached','deleted')),
  uploaded_by TEXT,
  job_id TEXT,
  created_at TEXT NOT NULL,
  attached_at TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_prn_documents_org_status
  ON prn_documents(organization_id,status,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prn_documents_job
  ON prn_documents(job_id) WHERE job_id IS NOT NULL;

ALTER TABLE prn_jobs ADD COLUMN document_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_prn_jobs_document
  ON prn_jobs(document_id) WHERE document_id IS NOT NULL;

-- CUPS queue names are only unique on one computer. Never use them as a
-- cross-tenant/global identity.
CREATE UNIQUE INDEX IF NOT EXISTS idx_prn_printers_node_system
  ON prn_printers(node_id,system_name);
