-- Printerly v1.10: document retention, privacy controls and legal holds.
CREATE TABLE IF NOT EXISTS prn_retention_policies (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1,
  staged_hours INTEGER NOT NULL DEFAULT 24 CHECK(staged_hours BETWEEN 1 AND 720),
  completed_print_days INTEGER NOT NULL DEFAULT 7 CHECK(completed_print_days BETWEEN 0 AND 3650),
  failed_print_days INTEGER NOT NULL DEFAULT 7 CHECK(failed_print_days BETWEEN 0 AND 3650),
  secure_print_minutes INTEGER NOT NULL DEFAULT 10 CHECK(secure_print_minutes BETWEEN 0 AND 10080),
  scan_inbox_days INTEGER NOT NULL DEFAULT 30 CHECK(scan_inbox_days BETWEEN 0 AND 3650),
  scan_routed_days INTEGER NOT NULL DEFAULT 7 CHECK(scan_routed_days BETWEEN 0 AND 3650),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE prn_documents ADD COLUMN retention_purged_at TEXT;
ALTER TABLE prn_documents ADD COLUMN retention_purge_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_prn_documents_retention ON prn_documents(organization_id,retention_purged_at,status,created_at);

ALTER TABLE prn_scan_documents ADD COLUMN retention_purged_at TEXT;
ALTER TABLE prn_scan_documents ADD COLUMN retention_purge_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_prn_scan_documents_retention ON prn_scan_documents(organization_id,retention_purged_at,created_at);

CREATE TABLE IF NOT EXISTS prn_retention_holds (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('print_job','scan_job','print_document','scan_document')),
  entity_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  held_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  held_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  released_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_prn_retention_holds_org ON prn_retention_holds(organization_id,released_at,held_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prn_retention_holds_active ON prn_retention_holds(organization_id,entity_type,entity_id) WHERE released_at IS NULL;

CREATE TABLE IF NOT EXISTS prn_retention_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  object_key TEXT,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_prn_retention_events_org ON prn_retention_events(organization_id,created_at DESC);

UPDATE app_modules
SET version='1.10.0',
    description='Secure remote print and scan management with smart routing, secure release, legal holds and automatic document-retention privacy controls.',
    updated_at=CURRENT_TIMESTAMP
WHERE module_key='printerly';
