CREATE TABLE IF NOT EXISTS security_camera_profiles (
  camera_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  preferred_facing TEXT NOT NULL DEFAULT 'back',
  width INTEGER NOT NULL DEFAULT 1280,
  height INTEGER NOT NULL DEFAULT 720,
  fps INTEGER NOT NULL DEFAULT 15,
  bitrate_kbps INTEGER NOT NULL DEFAULT 1200,
  segment_seconds INTEGER NOT NULL DEFAULT 20,
  retention_days INTEGER NOT NULL DEFAULT 30,
  audio_enabled INTEGER NOT NULL DEFAULT 0,
  motion_enabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(camera_id) REFERENCES security_cameras(id)
);
CREATE INDEX IF NOT EXISTS idx_security_camera_profiles_org ON security_camera_profiles(organization_id);

CREATE TABLE IF NOT EXISTS security_camera_server_runtime (
  server_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  public_control_base_url TEXT,
  cpu_percent REAL,
  memory_percent REAL,
  uptime_seconds INTEGER,
  active_streams INTEGER NOT NULL DEFAULT 0,
  active_viewers INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(server_id) REFERENCES security_camera_servers(id)
);

CREATE TABLE IF NOT EXISTS security_camera_server_volumes (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  volume_key TEXT NOT NULL,
  label TEXT NOT NULL,
  path TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  free_bytes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'online',
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(server_id, volume_key),
  FOREIGN KEY(server_id) REFERENCES security_camera_servers(id)
);
CREATE INDEX IF NOT EXISTS idx_security_camera_volumes_org_server ON security_camera_server_volumes(organization_id,server_id);

CREATE TABLE IF NOT EXISTS security_camera_alerts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  camera_id TEXT,
  server_id TEXT,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  status TEXT NOT NULL DEFAULT 'open',
  message TEXT NOT NULL,
  details_json TEXT,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  acknowledged_at TEXT,
  acknowledged_by TEXT,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_security_camera_alerts_org_status ON security_camera_alerts(organization_id,status,last_seen_at DESC);

CREATE TABLE IF NOT EXISTS security_camera_access_grants (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  server_id TEXT NOT NULL,
  camera_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_security_camera_access_grants_server_expiry ON security_camera_access_grants(server_id,expires_at);

CREATE TABLE IF NOT EXISTS security_camera_exports (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  server_id TEXT NOT NULL,
  camera_id TEXT NOT NULL,
  from_at TEXT NOT NULL,
  to_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested',
  local_path TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_security_camera_exports_org_created ON security_camera_exports(organization_id,created_at DESC);
