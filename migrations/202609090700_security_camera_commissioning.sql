CREATE TABLE IF NOT EXISTS security_camera_commissioning_runs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  run_type TEXT NOT NULL CHECK(run_type IN ('readiness_certification','recovery_drill')),
  status TEXT NOT NULL CHECK(status IN ('passed','warning','failed')),
  score INTEGER NOT NULL DEFAULT 0,
  passed INTEGER NOT NULL DEFAULT 0,
  actor_id TEXT,
  summary TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_security_camera_commissioning_org_time ON security_camera_commissioning_runs(organization_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_camera_commissioning_org_type ON security_camera_commissioning_runs(organization_id,run_type,created_at DESC);
