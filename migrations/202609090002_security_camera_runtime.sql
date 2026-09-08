-- Security camera runtime: NVR pairing, direct LAN ingest, recording sync and live-session signaling.
ALTER TABLE security_camera_servers ADD COLUMN credential_hash TEXT;
ALTER TABLE security_camera_servers ADD COLUMN capabilities_json TEXT;
ALTER TABLE security_camera_servers ADD COLUMN hostname TEXT;
ALTER TABLE security_camera_servers ADD COLUMN app_version TEXT;
ALTER TABLE security_camera_servers ADD COLUMN paired_at TEXT;
ALTER TABLE security_cameras ADD COLUMN recording_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE security_cameras ADD COLUMN last_recording_at TEXT;
ALTER TABLE security_camera_live_sessions ADD COLUMN offer_sdp TEXT;
ALTER TABLE security_camera_live_sessions ADD COLUMN answer_sdp TEXT;
ALTER TABLE security_camera_live_sessions ADD COLUMN ice_json TEXT;

CREATE TABLE IF NOT EXISTS security_camera_server_pairings (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  name TEXT NOT NULL,
  location TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_security_camera_recording_unique_path
  ON security_camera_recordings(server_id,camera_id,local_path);
CREATE INDEX IF NOT EXISTS idx_security_camera_server_pairings_org
  ON security_camera_server_pairings(organization_id,expires_at);
CREATE INDEX IF NOT EXISTS idx_security_camera_live_status
  ON security_camera_live_sessions(organization_id,status,expires_at);
