CREATE TABLE IF NOT EXISTS audio_call_participant_locks (
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  acquired_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS audio_call_participant_locks_call_idx
  ON audio_call_participant_locks(organization_id, call_id);
