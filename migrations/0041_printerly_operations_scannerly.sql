-- Printerly v1.2: cost allocation/accounting, printer health and alerts, and Scannerly.

ALTER TABLE prn_printers ADD COLUMN health_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE prn_printers ADD COLUMN state_reasons_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE prn_printers ADD COLUMN marker_levels_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE prn_printers ADD COLUMN health_message TEXT;
ALTER TABLE prn_printers ADD COLUMN last_health_at TEXT;

ALTER TABLE prn_jobs ADD COLUMN source_module TEXT;
ALTER TABLE prn_jobs ADD COLUMN source_reference TEXT;
ALTER TABLE prn_jobs ADD COLUMN charge_project_id TEXT;
ALTER TABLE prn_jobs ADD COLUMN charge_department_type TEXT;
ALTER TABLE prn_jobs ADD COLUMN charge_department_id TEXT;
ALTER TABLE prn_jobs ADD COLUMN estimated_pages INTEGER;
ALTER TABLE prn_jobs ADD COLUMN estimated_impressions INTEGER;
ALTER TABLE prn_jobs ADD COLUMN estimated_sheets INTEGER;
ALTER TABLE prn_jobs ADD COLUMN actual_impressions INTEGER;
ALTER TABLE prn_jobs ADD COLUMN actual_sheets INTEGER;
ALTER TABLE prn_jobs ADD COLUMN estimated_cost_minor INTEGER;
ALTER TABLE prn_jobs ADD COLUMN actual_cost_minor INTEGER;

CREATE INDEX IF NOT EXISTS idx_prn_jobs_charge_project ON prn_jobs(organization_id,charge_project_id,created_at);
CREATE INDEX IF NOT EXISTS idx_prn_jobs_charge_department ON prn_jobs(organization_id,charge_department_type,charge_department_id,created_at);

CREATE TABLE IF NOT EXISTS prn_cost_profiles (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  currency TEXT NOT NULL DEFAULT 'UGX',
  paper_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK(paper_cost_minor >= 0),
  bw_toner_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK(bw_toner_cost_minor >= 0),
  color_toner_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK(color_toner_cost_minor >= 0),
  maintenance_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK(maintenance_cost_minor >= 0),
  electricity_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK(electricity_cost_minor >= 0),
  expense_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  offset_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  auto_post_accounting INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS prn_cost_ledger (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES prn_jobs(id) ON DELETE CASCADE,
  project_id TEXT,
  department_type TEXT,
  department_id TEXT,
  impressions INTEGER NOT NULL CHECK(impressions >= 0),
  sheets INTEGER NOT NULL CHECK(sheets >= 0),
  paper_cost_minor INTEGER NOT NULL CHECK(paper_cost_minor >= 0),
  toner_cost_minor INTEGER NOT NULL CHECK(toner_cost_minor >= 0),
  maintenance_cost_minor INTEGER NOT NULL CHECK(maintenance_cost_minor >= 0),
  electricity_cost_minor INTEGER NOT NULL CHECK(electricity_cost_minor >= 0),
  total_cost_minor INTEGER NOT NULL CHECK(total_cost_minor >= 0),
  currency TEXT NOT NULL,
  calculation_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,job_id)
);
CREATE INDEX IF NOT EXISTS idx_prn_cost_ledger_org_created ON prn_cost_ledger(organization_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prn_cost_ledger_project ON prn_cost_ledger(organization_id,project_id,created_at DESC);

CREATE TABLE IF NOT EXISTS prn_cost_postings (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES prn_jobs(id) ON DELETE CASCADE,
  cost_ledger_id TEXT NOT NULL REFERENCES prn_cost_ledger(id) ON DELETE RESTRICT,
  journal_entry_id TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE RESTRICT,
  posted_by TEXT,
  posted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,job_id),
  UNIQUE(organization_id,journal_entry_id)
);

CREATE TABLE IF NOT EXISTS prn_alerts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning' CHECK(severity IN ('info','warning','critical')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  acknowledged_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prn_alert_active_fingerprint ON prn_alerts(organization_id,fingerprint) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_prn_alerts_org_state ON prn_alerts(organization_id,resolved_at,acknowledged_at,created_at DESC);

CREATE TABLE IF NOT EXISTS prn_alert_subscriptions (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  email INTEGER NOT NULL DEFAULT 1,
  sms INTEGER NOT NULL DEFAULT 0,
  whatsapp INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(organization_id,user_id,event_type)
);

CREATE TABLE IF NOT EXISTS prn_scanners (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES prn_nodes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  system_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown',
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(node_id,system_name)
);
CREATE INDEX IF NOT EXISTS idx_prn_scanners_org ON prn_scanners(organization_id,node_id,status);

CREATE TABLE IF NOT EXISTS prn_scan_jobs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scan_number TEXT NOT NULL,
  title TEXT NOT NULL,
  scanner_id TEXT REFERENCES prn_scanners(id) ON DELETE SET NULL,
  node_id TEXT REFERENCES prn_nodes(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','claimed','scanning','uploading','completed','failed','cancelled')),
  source TEXT NOT NULL DEFAULT 'flatbed' CHECK(source IN ('flatbed','adf')),
  color_mode TEXT NOT NULL DEFAULT 'color' CHECK(color_mode IN ('color','gray','lineart')),
  resolution_dpi INTEGER NOT NULL DEFAULT 300 CHECK(resolution_dpi BETWEEN 75 AND 1200),
  page_size TEXT NOT NULL DEFAULT 'A4',
  output_format TEXT NOT NULL DEFAULT 'pdf' CHECK(output_format IN ('pdf','png','jpeg')),
  target_type TEXT NOT NULL DEFAULT 'inbox' CHECK(target_type IN ('inbox','student','staff','module')),
  target_module TEXT,
  target_id TEXT,
  notes TEXT,
  claim_token TEXT,
  claim_expires_at TEXT,
  document_id TEXT,
  error_message TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  UNIQUE(organization_id,scan_number)
);
CREATE INDEX IF NOT EXISTS idx_prn_scan_jobs_queue ON prn_scan_jobs(organization_id,status,created_at);
CREATE INDEX IF NOT EXISTS idx_prn_scan_jobs_target ON prn_scan_jobs(organization_id,target_type,target_module,target_id,created_at DESC);

CREATE TABLE IF NOT EXISTS prn_scan_documents (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scan_job_id TEXT NOT NULL REFERENCES prn_scan_jobs(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK(size_bytes > 0),
  checksum_sha256 TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_module TEXT,
  target_id TEXT,
  school_file_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,scan_job_id)
);
CREATE INDEX IF NOT EXISTS idx_prn_scan_documents_target ON prn_scan_documents(organization_id,target_type,target_module,target_id,created_at DESC);

CREATE TABLE IF NOT EXISTS prn_scan_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scan_job_id TEXT NOT NULL REFERENCES prn_scan_jobs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_prn_scan_events_job ON prn_scan_events(organization_id,scan_job_id,created_at);

INSERT OR IGNORE INTO app_modules(module_key,name,version,description,category,core,manifest_json,active)
VALUES('printerly','Printerly','1.2.0','Secure remote print, scan, printer-health and print-cost management for Ledgerly using always-online local Printerly Nodes.','operations',0,'{}',1);

-- The original Printerly schema pre-dated module registration. Make existing organizations usable after this upgrade.
INSERT OR IGNORE INTO organization_modules(organization_id,module_key,enabled,configuration_json,enabled_at)
SELECT id,'printerly',1,'{}',CURRENT_TIMESTAMP FROM organizations;

UPDATE app_modules
SET version='1.2.0',
    description='Secure remote print, scan, printer-health and print-cost management for Ledgerly using always-online local Printerly Nodes.',
    manifest_json='{"standalone":true,"sharedCore":["organizations","users","permissions","files","projects","dimensions","journals","notifications"],"features":["remote-printing","global-print-with-printerly","department-project-charging","print-cost-accounting","ledger-journal-posting","printer-health","multi-channel-alerts","scannerly","student-staff-scan-routing","module-scan-inbox","private-r2-documents","secure-release","priority-queue","cups-node","sane-scanner","claim-leases","checksum-verification","restart-safe-duplicate-prevention"]}',
    updated_at=CURRENT_TIMESTAMP
WHERE module_key='printerly';
