-- Standalone Attendance face engine: encrypted templates, enrollment jobs and device sync.
CREATE TABLE IF NOT EXISTS att_biometric_templates (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES att_biometric_profiles(id) ON DELETE CASCADE,
  person_type TEXT NOT NULL CHECK(person_type IN ('student','staff')),
  person_id TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  embedding_ciphertext TEXT NOT NULL,
  embedding_iv TEXT NOT NULL,
  embedding_bytes INTEGER NOT NULL DEFAULT 0,
  quality_score REAL,
  liveness_score REAL,
  version INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,person_type,person_id)
);
CREATE INDEX IF NOT EXISTS att_biometric_templates_sync_idx ON att_biometric_templates(organization_id,active,updated_at);

CREATE TABLE IF NOT EXISTS att_biometric_enrollment_jobs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES att_devices(id) ON DELETE CASCADE,
  person_type TEXT NOT NULL CHECK(person_type IN ('student','staff')),
  person_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','claimed','completed','failed','cancelled')),
  consent_status TEXT NOT NULL DEFAULT 'granted' CHECK(consent_status IN ('pending','granted','withdrawn','not_required')),
  requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  claimed_at TEXT,
  completed_at TEXT,
  failure_reason TEXT,
  result_profile_id TEXT REFERENCES att_biometric_profiles(id) ON DELETE SET NULL,
  result_quality_score REAL,
  result_liveness_score REAL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS att_biometric_enrollment_jobs_device_idx ON att_biometric_enrollment_jobs(organization_id,device_id,status,requested_at);
CREATE INDEX IF NOT EXISTS att_biometric_enrollment_jobs_person_idx ON att_biometric_enrollment_jobs(organization_id,person_type,person_id,status);

CREATE TABLE IF NOT EXISTS att_biometric_settings (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  algorithm_version TEXT NOT NULL DEFAULT 'facenet-128-v1',
  match_threshold REAL NOT NULL DEFAULT 0.78,
  ambiguity_margin REAL NOT NULL DEFAULT 0.05,
  liveness_threshold REAL NOT NULL DEFAULT 0.70,
  quality_threshold REAL NOT NULL DEFAULT 0.55,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO att_biometric_settings(organization_id)
SELECT id FROM organizations;
