ALTER TABLE security_cameras ADD COLUMN capture_paused INTEGER NOT NULL DEFAULT 0;
ALTER TABLE security_cameras ADD COLUMN pause_reason TEXT;
ALTER TABLE security_cameras ADD COLUMN remediation_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE security_cameras ADD COLUMN last_remediation_at TEXT;
ALTER TABLE security_cameras ADD COLUMN nvr_reachability TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE security_cameras ADD COLUMN health_score INTEGER NOT NULL DEFAULT 100;
ALTER TABLE security_cameras ADD COLUMN health_state TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE security_cameras ADD COLUMN health_issues_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE security_cameras ADD COLUMN health_evaluated_at TEXT;

CREATE TABLE IF NOT EXISTS security_camera_health_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  camera_id TEXT NOT NULL,
  health_score INTEGER NOT NULL,
  health_state TEXT NOT NULL,
  classification TEXT NOT NULL,
  issues_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(camera_id) REFERENCES security_cameras(id)
);
CREATE INDEX IF NOT EXISTS idx_security_camera_health_events_camera ON security_camera_health_events(organization_id,camera_id,created_at DESC);
