CREATE TABLE IF NOT EXISTS security_camera_zones (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  camera_id TEXT NOT NULL,
  name TEXT NOT NULL,
  zone_type TEXT NOT NULL DEFAULT 'motion',
  polygon_json TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_security_camera_zones_camera ON security_camera_zones(organization_id,camera_id,enabled);

CREATE TABLE IF NOT EXISTS security_camera_schedules (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  camera_id TEXT,
  name TEXT NOT NULL,
  days_json TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
  start_time TEXT NOT NULL DEFAULT '00:00',
  end_time TEXT NOT NULL DEFAULT '23:59',
  timezone TEXT NOT NULL DEFAULT 'Africa/Kampala',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_security_camera_schedules_scope ON security_camera_schedules(organization_id,camera_id,enabled);

CREATE TABLE IF NOT EXISTS security_camera_event_rules (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  camera_id TEXT,
  name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  min_confidence REAL NOT NULL DEFAULT 0,
  severity TEXT NOT NULL DEFAULT 'warning',
  protect_clip INTEGER NOT NULL DEFAULT 1,
  create_alert INTEGER NOT NULL DEFAULT 1,
  schedule_id TEXT,
  zone_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_security_camera_event_rules_scope ON security_camera_event_rules(organization_id,camera_id,event_type,enabled);

CREATE TABLE IF NOT EXISTS security_camera_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  camera_id TEXT NOT NULL,
  server_id TEXT,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  confidence REAL,
  source TEXT NOT NULL DEFAULT 'nvr',
  started_at TEXT NOT NULL,
  ended_at TEXT,
  zone_id TEXT,
  recording_id TEXT,
  snapshot_path TEXT,
  protected INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_security_camera_events_org_time ON security_camera_events(organization_id,started_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_camera_events_camera ON security_camera_events(organization_id,camera_id,started_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_camera_events_type ON security_camera_events(organization_id,event_type,status,started_at DESC);

CREATE TABLE IF NOT EXISTS security_camera_incidents (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  camera_id TEXT NOT NULL,
  event_id TEXT,
  title TEXT NOT NULL,
  notes TEXT,
  from_at TEXT NOT NULL,
  to_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_security_camera_incidents_org ON security_camera_incidents(organization_id,status,created_at DESC);
