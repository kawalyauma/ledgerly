CREATE TABLE IF NOT EXISTS prn_nodes (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, name TEXT NOT NULL, location TEXT,
  status TEXT NOT NULL DEFAULT 'pairing', pairing_code_hash TEXT, pairing_expires_at TEXT,
  token_hash TEXT, last_seen_at TEXT, version TEXT, revoked_at TEXT, created_by TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prn_nodes_org ON prn_nodes(organization_id,status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prn_nodes_pairing ON prn_nodes(pairing_code_hash) WHERE pairing_code_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_prn_nodes_token ON prn_nodes(token_hash) WHERE token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS prn_printers (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, node_id TEXT NOT NULL, name TEXT NOT NULL,
  system_name TEXT NOT NULL, location TEXT, status TEXT NOT NULL DEFAULT 'unknown', capabilities_json TEXT,
  last_seen_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prn_printers_org ON prn_printers(organization_id,node_id,status);

CREATE TABLE IF NOT EXISTS prn_jobs (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, job_number TEXT NOT NULL, title TEXT NOT NULL,
  document_url TEXT NOT NULL, document_mime TEXT NOT NULL DEFAULT 'application/pdf', document_sha256 TEXT,
  printer_id TEXT, node_id TEXT, status TEXT NOT NULL DEFAULT 'queued', priority TEXT NOT NULL DEFAULT 'normal',
  copies INTEGER NOT NULL DEFAULT 1, page_size TEXT NOT NULL DEFAULT 'A4', color_mode TEXT NOT NULL DEFAULT 'monochrome',
  duplex INTEGER NOT NULL DEFAULT 0, secure_release INTEGER NOT NULL DEFAULT 0, total_sheets INTEGER,
  claim_token TEXT, claim_expires_at TEXT, released_at TEXT, error_message TEXT, created_by TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prn_jobs_number ON prn_jobs(organization_id,job_number);
CREATE INDEX IF NOT EXISTS idx_prn_jobs_queue ON prn_jobs(organization_id,status,priority,created_at);
CREATE INDEX IF NOT EXISTS idx_prn_jobs_node ON prn_jobs(node_id,status);

CREATE TABLE IF NOT EXISTS prn_job_events (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, job_id TEXT NOT NULL, event_type TEXT NOT NULL,
  actor_id TEXT, details_json TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prn_job_events_job ON prn_job_events(organization_id,job_id,created_at);
