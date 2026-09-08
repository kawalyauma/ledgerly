-- Printerly v1.4: monthly quotas and usage governance.

CREATE TABLE IF NOT EXISTS prn_quotas (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK(scope_type IN ('organization','user','finance_department','school_department','project')),
  scope_id TEXT,
  scope_key TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'soft' CHECK(mode IN ('soft','hard')),
  max_impressions INTEGER NOT NULL DEFAULT 0 CHECK(max_impressions >= 0),
  max_sheets INTEGER NOT NULL DEFAULT 0 CHECK(max_sheets >= 0),
  max_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK(max_cost_minor >= 0),
  warning_percent INTEGER NOT NULL DEFAULT 80 CHECK(warning_percent BETWEEN 1 AND 100),
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prn_quotas_scope ON prn_quotas(organization_id,scope_key) WHERE active=1;
CREATE INDEX IF NOT EXISTS idx_prn_quotas_org ON prn_quotas(organization_id,active,scope_type);

CREATE TABLE IF NOT EXISTS prn_quota_periods (
  quota_id TEXT NOT NULL REFERENCES prn_quotas(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period_key TEXT NOT NULL,
  reserved_impressions INTEGER NOT NULL DEFAULT 0 CHECK(reserved_impressions >= 0),
  reserved_sheets INTEGER NOT NULL DEFAULT 0 CHECK(reserved_sheets >= 0),
  reserved_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK(reserved_cost_minor >= 0),
  consumed_impressions INTEGER NOT NULL DEFAULT 0 CHECK(consumed_impressions >= 0),
  consumed_sheets INTEGER NOT NULL DEFAULT 0 CHECK(consumed_sheets >= 0),
  consumed_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK(consumed_cost_minor >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(quota_id,period_key)
);
CREATE INDEX IF NOT EXISTS idx_prn_quota_periods_org_period ON prn_quota_periods(organization_id,period_key);

CREATE TABLE IF NOT EXISTS prn_quota_reservations (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  quota_id TEXT NOT NULL REFERENCES prn_quotas(id) ON DELETE CASCADE,
  period_key TEXT NOT NULL,
  job_id TEXT,
  reserved_impressions INTEGER NOT NULL CHECK(reserved_impressions >= 0),
  reserved_sheets INTEGER NOT NULL CHECK(reserved_sheets >= 0),
  reserved_cost_minor INTEGER NOT NULL CHECK(reserved_cost_minor >= 0),
  actual_impressions INTEGER,
  actual_sheets INTEGER,
  actual_cost_minor INTEGER,
  status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','settled','released')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(quota_id,job_id)
);
CREATE INDEX IF NOT EXISTS idx_prn_quota_reservations_group ON prn_quota_reservations(organization_id,group_id,status);
CREATE INDEX IF NOT EXISTS idx_prn_quota_reservations_job ON prn_quota_reservations(organization_id,job_id,status);

UPDATE app_modules
SET version='1.4.0',
    description='Secure remote print and scan management with health monitoring, cost accounting, usage reporting and enforceable monthly print quotas.',
    updated_at=CURRENT_TIMESTAMP
WHERE module_key='printerly';
