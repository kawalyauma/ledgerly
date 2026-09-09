-- Printerly v1.5: automatic print policies and approval workflows.

CREATE TABLE IF NOT EXISTS prn_print_rules (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 100 CHECK(priority BETWEEN 1 AND 1000),
  match_json TEXT NOT NULL DEFAULT '{}',
  action_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_prn_print_rules_org_active
  ON prn_print_rules(organization_id,active,priority,created_at);

CREATE TABLE IF NOT EXISTS prn_approvals (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES prn_jobs(id) ON DELETE CASCADE,
  rule_ids_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
  requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approver_roles_json TEXT NOT NULL DEFAULT '["owner","admin"]',
  approver_user_ids_json TEXT NOT NULL DEFAULT '[]',
  allow_self_approval INTEGER NOT NULL DEFAULT 0,
  decided_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  decided_at TEXT,
  decision_note TEXT,
  decision_nonce TEXT,
  UNIQUE(organization_id,job_id)
);
CREATE INDEX IF NOT EXISTS idx_prn_approvals_org_status
  ON prn_approvals(organization_id,status,requested_at DESC);

UPDATE app_modules
SET version='1.5.0',
    description='Secure remote print and scan management with accounting, quotas, automatic print policies and approval workflows.',
    updated_at=CURRENT_TIMESTAMP
WHERE module_key='printerly';
