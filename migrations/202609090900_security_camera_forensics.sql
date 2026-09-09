ALTER TABLE security_camera_exports ADD COLUMN content_sha256 TEXT;
ALTER TABLE security_camera_exports ADD COLUMN manifest_sha256 TEXT;
ALTER TABLE security_camera_exports ADD COLUMN integrity_status TEXT NOT NULL DEFAULT 'pending';

CREATE TABLE IF NOT EXISTS security_camera_legal_holds (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  incident_id TEXT,
  camera_id TEXT NOT NULL,
  from_at TEXT NOT NULL,
  to_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','released')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_by TEXT,
  released_at TEXT,
  FOREIGN KEY(camera_id) REFERENCES security_cameras(id),
  FOREIGN KEY(incident_id) REFERENCES security_camera_incidents(id)
);
CREATE INDEX IF NOT EXISTS idx_security_camera_holds_active ON security_camera_legal_holds(organization_id,camera_id,status,from_at,to_at);

CREATE TABLE IF NOT EXISTS security_camera_custody_log (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_user_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_security_camera_custody_evidence ON security_camera_custody_log(organization_id,evidence_type,evidence_id,created_at DESC);

CREATE TABLE IF NOT EXISTS security_camera_export_manifests (
  export_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  camera_id TEXT NOT NULL,
  incident_id TEXT,
  manifest_json TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL,
  hmac_sha256 TEXT,
  signing_status TEXT NOT NULL DEFAULT 'unsigned' CHECK(signing_status IN ('signed','unsigned')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at TEXT,
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK(verification_status IN ('pending','verified','mismatch')),
  FOREIGN KEY(export_id) REFERENCES security_camera_exports(id),
  FOREIGN KEY(camera_id) REFERENCES security_cameras(id),
  FOREIGN KEY(incident_id) REFERENCES security_camera_incidents(id)
);
