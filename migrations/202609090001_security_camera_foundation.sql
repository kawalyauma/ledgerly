-- Security camera foundation: local-first CCTV with QR device pairing and NVR metadata.
CREATE TABLE IF NOT EXISTS security_camera_servers (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'offline',
  local_base_url TEXT,
  relay_id TEXT,
  storage_total_bytes INTEGER NOT NULL DEFAULT 0,
  storage_free_bytes INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS security_camera_pairings (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  camera_name TEXT NOT NULL,
  location TEXT,
  server_id TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (server_id) REFERENCES security_camera_servers(id)
);

CREATE TABLE IF NOT EXISTS security_cameras (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  server_id TEXT,
  name TEXT NOT NULL,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'offline',
  credential_hash TEXT NOT NULL,
  device_model TEXT,
  platform TEXT,
  app_version TEXT,
  capabilities_json TEXT,
  battery_level REAL,
  temperature_c REAL,
  wifi_strength REAL,
  paired_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (server_id) REFERENCES security_camera_servers(id)
);

CREATE TABLE IF NOT EXISTS security_camera_recordings (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  camera_id TEXT NOT NULL,
  server_id TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  local_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  checksum TEXT,
  protected INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'recording',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (camera_id) REFERENCES security_cameras(id),
  FOREIGN KEY (server_id) REFERENCES security_camera_servers(id)
);

CREATE TABLE IF NOT EXISTS security_camera_live_sessions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  camera_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested',
  signaling_key TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (camera_id) REFERENCES security_cameras(id)
);

CREATE INDEX IF NOT EXISTS idx_security_camera_servers_org ON security_camera_servers(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_security_camera_pairings_org ON security_camera_pairings(organization_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_security_cameras_org ON security_cameras(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_security_cameras_server ON security_cameras(server_id, status);
CREATE INDEX IF NOT EXISTS idx_security_camera_recordings_timeline ON security_camera_recordings(camera_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_camera_live_sessions_camera ON security_camera_live_sessions(camera_id, created_at DESC);
