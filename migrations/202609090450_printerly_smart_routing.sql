-- Printerly v1.8: printer pools and smart routing.
CREATE TABLE IF NOT EXISTS prn_printer_pools (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  strategy TEXT NOT NULL DEFAULT 'least_loaded' CHECK(strategy IN ('least_loaded','priority_load')),
  requirements_json TEXT NOT NULL DEFAULT '{}',
  default_auto INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_prn_printer_pools_org ON prn_printer_pools(organization_id,active,name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prn_printer_pools_default ON prn_printer_pools(organization_id) WHERE active=1 AND default_auto=1;

CREATE TABLE IF NOT EXISTS prn_printer_pool_members (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pool_id TEXT NOT NULL REFERENCES prn_printer_pools(id) ON DELETE CASCADE,
  printer_id TEXT NOT NULL REFERENCES prn_printers(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 100 CHECK(priority BETWEEN 1 AND 1000),
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(pool_id,printer_id)
);
CREATE INDEX IF NOT EXISTS idx_prn_pool_members_printer ON prn_printer_pool_members(organization_id,printer_id,pool_id);

ALTER TABLE prn_jobs ADD COLUMN route_pool_id TEXT REFERENCES prn_printer_pools(id) ON DELETE SET NULL;
ALTER TABLE prn_jobs ADD COLUMN route_strategy TEXT;
ALTER TABLE prn_jobs ADD COLUMN route_reason TEXT;
ALTER TABLE prn_jobs ADD COLUMN routed_at TEXT;
CREATE INDEX IF NOT EXISTS idx_prn_jobs_route_pool ON prn_jobs(organization_id,route_pool_id,status,created_at);

UPDATE app_modules
SET version='1.8.0',
    description='Secure remote print and scan management with governance, scheduling, audit, printer pools and smart load-aware routing.',
    updated_at=CURRENT_TIMESTAMP
WHERE module_key='printerly';
