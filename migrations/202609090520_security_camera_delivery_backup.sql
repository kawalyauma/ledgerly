-- Security Cameras v0.11: complete alert delivery and local/NAS archive backup health.
PRAGMA foreign_keys=ON;

ALTER TABLE security_camera_notification_queue ADD COLUMN email_message_id TEXT;
ALTER TABLE security_camera_notification_queue ADD COLUMN webhook_event_id TEXT;
ALTER TABLE security_camera_notification_queue ADD COLUMN in_app_notification_id TEXT;

CREATE TABLE IF NOT EXISTS security_camera_inbox (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  notification_queue_id TEXT NOT NULL,
  alert_id TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  camera_id TEXT,
  server_id TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(notification_queue_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_security_camera_inbox_user ON security_camera_inbox(organization_id,user_id,read_at,created_at DESC);

CREATE TABLE IF NOT EXISTS security_camera_backup_status (
  server_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'disabled',
  pending_files INTEGER NOT NULL DEFAULT 0,
  pending_bytes INTEGER NOT NULL DEFAULT 0,
  oldest_pending_at TEXT,
  lag_seconds INTEGER NOT NULL DEFAULT 0,
  copied_files INTEGER NOT NULL DEFAULT 0,
  copied_bytes INTEGER NOT NULL DEFAULT 0,
  last_success_at TEXT,
  last_error TEXT,
  last_reported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(server_id) REFERENCES security_camera_servers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_security_camera_backup_org ON security_camera_backup_status(organization_id,status,updated_at DESC);
