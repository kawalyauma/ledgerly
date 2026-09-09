-- Printerly v1.9: secure release credentials and LAN release stations.
CREATE TABLE IF NOT EXISTS prn_release_credentials (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES prn_jobs(id) ON DELETE CASCADE,
  issued_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  pin_digest TEXT NOT NULL,
  token_digest TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  locked_at TEXT,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  revoked_at TEXT,
  used_node_id TEXT REFERENCES prn_nodes(id) ON DELETE SET NULL,
  used_printer_id TEXT REFERENCES prn_printers(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_prn_release_job ON prn_release_credentials(organization_id,job_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prn_release_pin ON prn_release_credentials(organization_id,pin_digest,expires_at);
CREATE INDEX IF NOT EXISTS idx_prn_release_token ON prn_release_credentials(organization_id,token_digest,expires_at);

CREATE TABLE IF NOT EXISTS prn_release_attempt_log (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES prn_nodes(id) ON DELETE CASCADE,
  credential_id TEXT REFERENCES prn_release_credentials(id) ON DELETE SET NULL,
  success INTEGER NOT NULL DEFAULT 0,
  failure_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_prn_release_attempt_node ON prn_release_attempt_log(organization_id,node_id,created_at DESC);

UPDATE app_modules
SET version='1.9.0',
    description='Secure remote print and scan management with smart routing and at-printer PIN/QR secure release stations.',
    updated_at=CURRENT_TIMESTAMP
WHERE module_key='printerly';
