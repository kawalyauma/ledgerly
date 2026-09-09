-- Security Cameras v0.10 delivery bridge, redundancy and validation.
PRAGMA foreign_keys=ON;

ALTER TABLE security_camera_notification_queue ADD COLUMN communication_campaign_id TEXT;
ALTER TABLE security_camera_notification_queue ADD COLUMN communication_delivery_id TEXT;
ALTER TABLE security_camera_notification_queue ADD COLUMN provider_status TEXT;
ALTER TABLE security_camera_notification_queue ADD COLUMN provider_error TEXT;
ALTER TABLE security_camera_notification_queue ADD COLUMN delivered_at TEXT;
CREATE INDEX IF NOT EXISTS idx_security_camera_notification_delivery ON security_camera_notification_queue(organization_id,communication_delivery_id);

CREATE TABLE IF NOT EXISTS security_camera_redundancy (
  camera_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  primary_server_id TEXT NOT NULL,
  secondary_server_id TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'automatic',
  failover_after_seconds INTEGER NOT NULL DEFAULT 90,
  failback_enabled INTEGER NOT NULL DEFAULT 1,
  failback_after_seconds INTEGER NOT NULL DEFAULT 300,
  state TEXT NOT NULL DEFAULT 'primary',
  state_changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  primary_healthy_since TEXT,
  last_evaluated_at TEXT,
  last_reason TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(camera_id) REFERENCES security_cameras(id) ON DELETE CASCADE,
  FOREIGN KEY(primary_server_id) REFERENCES security_camera_servers(id),
  FOREIGN KEY(secondary_server_id) REFERENCES security_camera_servers(id)
);
CREATE INDEX IF NOT EXISTS idx_security_camera_redundancy_org ON security_camera_redundancy(organization_id,enabled,state);
CREATE INDEX IF NOT EXISTS idx_security_camera_redundancy_primary ON security_camera_redundancy(organization_id,primary_server_id,enabled);
CREATE INDEX IF NOT EXISTS idx_security_camera_redundancy_secondary ON security_camera_redundancy(organization_id,secondary_server_id,enabled);

CREATE TABLE IF NOT EXISTS security_camera_failover_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  camera_id TEXT NOT NULL,
  from_server_id TEXT,
  to_server_id TEXT,
  reason TEXT NOT NULL,
  automatic INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_security_camera_failover_events_org_time ON security_camera_failover_events(organization_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_camera_failover_events_camera ON security_camera_failover_events(organization_id,camera_id,created_at DESC);

CREATE TABLE IF NOT EXISTS security_camera_validation_runs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  server_id TEXT,
  camera_id TEXT,
  check_type TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_security_camera_validation_org_time ON security_camera_validation_runs(organization_id,created_at DESC);
