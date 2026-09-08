-- Multiple pose samples per biometric profile for faster, more tolerant on-device matching.
CREATE TABLE IF NOT EXISTS att_biometric_template_samples (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES att_biometric_profiles(id) ON DELETE CASCADE,
  person_type TEXT NOT NULL CHECK(person_type IN ('student','staff')),
  person_id TEXT NOT NULL,
  sample_index INTEGER NOT NULL,
  algorithm_version TEXT NOT NULL,
  embedding_ciphertext TEXT NOT NULL,
  embedding_iv TEXT NOT NULL,
  embedding_bytes INTEGER NOT NULL DEFAULT 0,
  quality_score REAL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,person_type,person_id,sample_index)
);
CREATE INDEX IF NOT EXISTS att_biometric_template_samples_sync_idx
  ON att_biometric_template_samples(organization_id,active,updated_at);
