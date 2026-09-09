-- Security Cameras v0.9 governance, audit and escalation.
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS security_camera_audit_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  camera_id TEXT,
  server_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_security_camera_audit_org_time ON security_camera_audit_events(organization_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_camera_audit_camera ON security_camera_audit_events(organization_id,camera_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_camera_audit_actor ON security_camera_audit_events(organization_id,actor_id,created_at DESC);

CREATE TABLE IF NOT EXISTS security_camera_notification_policies (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  minimum_severity TEXT NOT NULL DEFAULT 'warning',
  event_types_json TEXT NOT NULL DEFAULT '[]',
  channels_json TEXT NOT NULL DEFAULT '[]',
  recipients_json TEXT NOT NULL DEFAULT '[]',
  schedule_id TEXT,
  escalation_minutes INTEGER NOT NULL DEFAULT 0,
  cooldown_minutes INTEGER NOT NULL DEFAULT 10,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_security_camera_notification_policies_org ON security_camera_notification_policies(organization_id,enabled,name);

CREATE TABLE IF NOT EXISTS security_camera_notification_queue (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  alert_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  not_before TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  payload_json TEXT NOT NULL DEFAULT '{}',
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT,
  FOREIGN KEY(policy_id) REFERENCES security_camera_notification_policies(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_security_camera_notification_queue_ready ON security_camera_notification_queue(organization_id,status,not_before);
CREATE INDEX IF NOT EXISTS idx_security_camera_notification_queue_alert ON security_camera_notification_queue(organization_id,alert_id,created_at DESC);

CREATE TABLE IF NOT EXISTS security_camera_server_update_policies (
  server_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  desired_version TEXT,
  update_channel TEXT NOT NULL DEFAULT 'stable',
  auto_update_enabled INTEGER NOT NULL DEFAULT 0,
  maintenance_start TEXT,
  maintenance_end TEXT,
  requested_by TEXT,
  requested_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(server_id) REFERENCES security_camera_servers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_security_camera_server_update_org ON security_camera_server_update_policies(organization_id,update_channel,auto_update_enabled);
