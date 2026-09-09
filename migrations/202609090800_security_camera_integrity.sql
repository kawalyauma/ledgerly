ALTER TABLE security_camera_recordings ADD COLUMN content_sha256 TEXT;
ALTER TABLE security_camera_recordings ADD COLUMN previous_chain_sha256 TEXT;
ALTER TABLE security_camera_recordings ADD COLUMN chain_sha256 TEXT;
ALTER TABLE security_camera_recordings ADD COLUMN integrity_status TEXT NOT NULL DEFAULT 'unverified';
ALTER TABLE security_camera_recordings ADD COLUMN integrity_computed_at TEXT;
ALTER TABLE security_camera_recordings ADD COLUMN integrity_verified_at TEXT;
ALTER TABLE security_camera_recordings ADD COLUMN integrity_mismatch_at TEXT;

CREATE TABLE IF NOT EXISTS security_camera_recording_integrity_checks (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  recording_id TEXT NOT NULL,
  camera_id TEXT NOT NULL,
  server_id TEXT,
  expected_sha256 TEXT,
  observed_sha256 TEXT,
  expected_previous_chain_sha256 TEXT,
  observed_previous_chain_sha256 TEXT,
  observed_chain_sha256 TEXT,
  status TEXT NOT NULL CHECK(status IN ('accepted','verified','tampered','chain_broken','unverified')),
  checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(recording_id) REFERENCES security_camera_recordings(id),
  FOREIGN KEY(camera_id) REFERENCES security_cameras(id),
  FOREIGN KEY(server_id) REFERENCES security_camera_servers(id)
);
CREATE INDEX IF NOT EXISTS idx_security_camera_integrity_recording ON security_camera_recording_integrity_checks(organization_id,recording_id,checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_camera_integrity_camera ON security_camera_recording_integrity_checks(organization_id,camera_id,checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_camera_recordings_integrity ON security_camera_recordings(organization_id,integrity_status,started_at DESC);
