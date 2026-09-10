CREATE TABLE IF NOT EXISTS audio_calls (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  caller_user_id TEXT NOT NULL,
  callee_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ringing' CHECK(status IN ('ringing','accepted','declined','missed','cancelled','ended','failed')),
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  answered_at TEXT,
  ended_at TEXT,
  ended_by_user_id TEXT,
  end_reason TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(caller_user_id <> callee_user_id)
);
CREATE INDEX IF NOT EXISTS audio_calls_org_started_idx ON audio_calls(organization_id, started_at DESC);
CREATE INDEX IF NOT EXISTS audio_calls_caller_idx ON audio_calls(organization_id, caller_user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS audio_calls_callee_idx ON audio_calls(organization_id, callee_user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS audio_calls_active_idx ON audio_calls(organization_id, status, caller_user_id, callee_user_id);

CREATE TABLE IF NOT EXISTS audio_call_signals (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  organization_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  from_user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  signal_type TEXT NOT NULL CHECK(signal_type IN ('offer','answer','ice','hangup','renegotiate')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  consumed_at TEXT
);
CREATE INDEX IF NOT EXISTS audio_call_signals_delivery_idx ON audio_call_signals(organization_id, call_id, to_user_id, sequence);
CREATE INDEX IF NOT EXISTS audio_call_signals_cleanup_idx ON audio_call_signals(created_at);

CREATE TABLE IF NOT EXISTS audio_call_presence (
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  availability TEXT NOT NULL DEFAULT 'available' CHECK(availability IN ('available','busy','do_not_disturb','offline')),
  active_call_id TEXT,
  device_id TEXT,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(organization_id, user_id)
);
CREATE INDEX IF NOT EXISTS audio_call_presence_seen_idx ON audio_call_presence(organization_id, last_seen_at DESC);
