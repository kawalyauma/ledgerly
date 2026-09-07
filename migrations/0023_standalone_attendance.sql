-- Ledgerly Attendance: standalone canonical attendance store.
-- Legacy school_* attendance tables are intentionally retained and backfilled below.

CREATE TABLE IF NOT EXISTS att_policies (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  population TEXT NOT NULL DEFAULT 'all' CHECK(population IN ('all','students','staff')),
  school_starts_at TEXT NOT NULL DEFAULT '08:00',
  late_after TEXT NOT NULL DEFAULT '08:10',
  absence_after TEXT NOT NULL DEFAULT '09:00',
  expected_departure_at TEXT NOT NULL DEFAULT '16:30',
  duplicate_cooldown_seconds INTEGER NOT NULL DEFAULT 60 CHECK(duplicate_cooldown_seconds BETWEEN 1 AND 3600),
  early_departure_minutes INTEGER NOT NULL DEFAULT 15 CHECK(early_departure_minutes BETWEEN 0 AND 720),
  timezone TEXT NOT NULL DEFAULT 'Africa/Kampala',
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS att_policies_org_idx ON att_policies(organization_id,active,population);

CREATE TABLE IF NOT EXISTS att_sessions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  academic_year_id TEXT REFERENCES school_academic_years(id) ON DELETE SET NULL,
  term_id TEXT REFERENCES school_terms(id) ON DELETE SET NULL,
  campus_id TEXT REFERENCES school_branches(id) ON DELETE SET NULL,
  attendance_date TEXT NOT NULL,
  session_type TEXT NOT NULL DEFAULT 'daily' CHECK(session_type IN ('daily','class','lesson','assembly','event','trip','boarding','custom')),
  population TEXT NOT NULL DEFAULT 'students' CHECK(population IN ('students','staff','mixed')),
  class_id TEXT REFERENCES school_classes(id) ON DELETE SET NULL,
  stream_id TEXT REFERENCES school_streams(id) ON DELETE SET NULL,
  subject_id TEXT REFERENCES school_subjects(id) ON DELETE SET NULL,
  lesson_period_id TEXT REFERENCES school_lesson_periods(id) ON DELETE SET NULL,
  external_ref TEXT,
  title TEXT,
  starts_at TEXT,
  ends_at TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('draft','open','submitted','finalized','locked','cancelled')),
  expected_count INTEGER NOT NULL DEFAULT 0,
  marked_count INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual',
  notes TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  finalized_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  finalized_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS att_sessions_date_idx ON att_sessions(organization_id,attendance_date,population,status);
CREATE UNIQUE INDEX IF NOT EXISTS att_sessions_scope_uq ON att_sessions(organization_id,attendance_date,session_type,population,IFNULL(class_id,''),IFNULL(stream_id,''),IFNULL(subject_id,''),IFNULL(lesson_period_id,''));

CREATE TABLE IF NOT EXISTS att_records (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES att_sessions(id) ON DELETE CASCADE,
  attendance_date TEXT NOT NULL,
  person_type TEXT NOT NULL CHECK(person_type IN ('student','staff')),
  person_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('present','absent','late','excused','sick','permission','on_leave','official_duty','remote','half_day')),
  first_in_at TEXT,
  last_out_at TEXT,
  minutes_late INTEGER NOT NULL DEFAULT 0 CHECK(minutes_late >= 0),
  worked_minutes INTEGER NOT NULL DEFAULT 0 CHECK(worked_minutes >= 0),
  break_minutes INTEGER NOT NULL DEFAULT 0 CHECK(break_minutes >= 0),
  overtime_minutes INTEGER NOT NULL DEFAULT 0 CHECK(overtime_minutes >= 0),
  reason_code TEXT,
  reason TEXT,
  notes TEXT,
  source_method TEXT NOT NULL DEFAULT 'MANUAL' CHECK(source_method IN ('FACE','QR','NFC','MANUAL','TEACHER_REGISTER','ADMIN_OVERRIDE','IMPORT','API')),
  official INTEGER NOT NULL DEFAULT 1,
  finalized INTEGER NOT NULL DEFAULT 0,
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS att_records_person_session_uq ON att_records(organization_id,session_id,person_type,person_id) WHERE session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS att_records_staff_daily_uq ON att_records(organization_id,attendance_date,person_id) WHERE person_type='staff' AND session_id IS NULL;
CREATE INDEX IF NOT EXISTS att_records_person_idx ON att_records(organization_id,person_type,person_id,attendance_date DESC);
CREATE INDEX IF NOT EXISTS att_records_date_idx ON att_records(organization_id,attendance_date,person_type,status);

CREATE TABLE IF NOT EXISTS att_devices (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  device_code TEXT NOT NULL,
  name TEXT NOT NULL,
  location_name TEXT,
  campus_id TEXT REFERENCES school_branches(id) ON DELETE SET NULL,
  population TEXT NOT NULL DEFAULT 'mixed' CHECK(population IN ('students','staff','mixed')),
  direction TEXT NOT NULL DEFAULT 'IN' CHECK(direction IN ('IN','OUT','BOTH')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','suspended','revoked')),
  platform TEXT NOT NULL DEFAULT 'android',
  app_version TEXT,
  last_seen_at TEXT,
  last_sync_at TEXT,
  registered_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,device_code)
);
CREATE INDEX IF NOT EXISTS att_devices_org_idx ON att_devices(organization_id,status);

CREATE TABLE IF NOT EXISTS att_device_credentials (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES att_devices(id) ON DELETE CASCADE,
  credential_hash TEXT NOT NULL,
  expires_at TEXT,
  last_used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS att_device_sync_batches (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES att_devices(id) ON DELETE CASCADE,
  client_batch_id TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  accepted_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'received' CHECK(status IN ('received','processed','partial','rejected')),
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  UNIQUE(organization_id,device_id,client_batch_id)
);

CREATE TABLE IF NOT EXISTS att_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  device_id TEXT REFERENCES att_devices(id) ON DELETE SET NULL,
  sync_batch_id TEXT REFERENCES att_device_sync_batches(id) ON DELETE SET NULL,
  client_event_id TEXT,
  person_type TEXT NOT NULL CHECK(person_type IN ('student','staff','unknown')),
  person_id TEXT,
  direction TEXT NOT NULL CHECK(direction IN ('IN','OUT')),
  method TEXT NOT NULL CHECK(method IN ('FACE','QR','NFC','MANUAL','TEACHER_REGISTER','ADMIN_OVERRIDE','IMPORT','API')),
  verification_mode TEXT NOT NULL DEFAULT 'STANDARD' CHECK(verification_mode IN ('STANDARD','TEST','SUPERVISED','UNVERIFIED')),
  verification_status TEXT NOT NULL DEFAULT 'verified' CHECK(verification_status IN ('verified','rejected','pending','duplicate','unknown')),
  confidence REAL,
  liveness_score REAL,
  captured_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  synced_at TEXT,
  official INTEGER NOT NULL DEFAULT 1,
  record_id TEXT REFERENCES att_records(id) ON DELETE SET NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS att_events_client_uq ON att_events(organization_id,device_id,client_event_id) WHERE client_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS att_events_recent_idx ON att_events(organization_id,captured_at DESC,verification_status);
CREATE INDEX IF NOT EXISTS att_events_person_idx ON att_events(organization_id,person_type,person_id,captured_at DESC);

CREATE TABLE IF NOT EXISTS att_biometric_profiles (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  person_type TEXT NOT NULL CHECK(person_type IN ('student','staff')),
  person_id TEXT NOT NULL,
  provider_profile_ref TEXT,
  algorithm_version TEXT NOT NULL,
  quality_score REAL,
  consent_status TEXT NOT NULL DEFAULT 'pending' CHECK(consent_status IN ('pending','granted','withdrawn','not_required')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','suspended','deleted','reenroll_required')),
  enrolled_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  enrolled_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,person_type,person_id)
);
CREATE INDEX IF NOT EXISTS att_biometric_profiles_status_idx ON att_biometric_profiles(organization_id,status,person_type);

CREATE TABLE IF NOT EXISTS att_person_identifiers (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  person_type TEXT NOT NULL CHECK(person_type IN ('student','staff')),
  person_id TEXT NOT NULL,
  method TEXT NOT NULL CHECK(method IN ('QR','NFC')),
  identifier TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,method,identifier)
);
CREATE INDEX IF NOT EXISTS att_person_identifiers_person_idx ON att_person_identifiers(organization_id,person_type,person_id,active);

CREATE TABLE IF NOT EXISTS att_biometric_enrollments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES att_biometric_profiles(id) ON DELETE CASCADE,
  provider_enrollment_ref TEXT,
  algorithm_version TEXT NOT NULL,
  pose_count INTEGER NOT NULL DEFAULT 0,
  quality_score REAL,
  liveness_score REAL,
  status TEXT NOT NULL DEFAULT 'completed',
  enrolled_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS att_test_mode_grants (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  device_id TEXT REFERENCES att_devices(id) ON DELETE CASCADE,
  allow_screen_image INTEGER NOT NULL DEFAULT 0,
  allow_printed_image INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  enabled_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  enabled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS att_test_mode_active_idx ON att_test_mode_grants(organization_id,device_id,expires_at,revoked_at);

CREATE TABLE IF NOT EXISTS att_exceptions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  person_type TEXT NOT NULL CHECK(person_type IN ('student','staff')),
  person_id TEXT NOT NULL,
  exception_type TEXT NOT NULL CHECK(exception_type IN ('sick_leave','official_duty','permission','staff_leave','school_trip','medical_appointment','early_departure','other')),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('pending','approved','rejected','cancelled')),
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS att_exceptions_person_idx ON att_exceptions(organization_id,person_type,person_id,starts_at,ends_at);

CREATE TABLE IF NOT EXISTS att_corrections (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  record_id TEXT NOT NULL REFERENCES att_records(id) ON DELETE CASCADE,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('pending','approved','rejected')),
  requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS att_corrections_record_idx ON att_corrections(organization_id,record_id,created_at DESC);

CREATE TABLE IF NOT EXISTS att_notification_rules (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK(trigger_type IN ('absence','late','early_departure','repeated_absence','staff_late','missing_checkout')),
  channels_json TEXT NOT NULL DEFAULT '["sms"]',
  recipient_mode TEXT NOT NULL DEFAULT 'primary_guardian',
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS att_audit (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('user','device','system')),
  actor_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS att_audit_entity_idx ON att_audit(organization_id,entity_type,entity_id,created_at DESC);

-- Historical student registers become canonical sessions and records.
INSERT OR IGNORE INTO att_sessions (id,organization_id,academic_year_id,term_id,campus_id,attendance_date,session_type,population,class_id,stream_id,subject_id,lesson_period_id,title,starts_at,ends_at,status,expected_count,marked_count,source,notes,created_by,finalized_by,finalized_at,created_at,updated_at)
SELECT id,organization_id,academic_year_id,term_id,campus_id,attendance_date,
  CASE session_type WHEN 'period' THEN 'lesson' WHEN 'other' THEN 'custom' ELSE session_type END,
  'students',class_id,stream_id,subject_id,lesson_period_id,title,starts_at,ends_at,
  CASE status WHEN 'locked' THEN 'locked' WHEN 'submitted' THEN 'finalized' ELSE status END,
  expected_count,marked_count,UPPER(source),notes,marked_by,COALESCE(locked_by,submitted_by),COALESCE(locked_at,submitted_at),created_at,updated_at
FROM school_student_attendance_sessions;

INSERT OR IGNORE INTO att_records (id,organization_id,session_id,attendance_date,person_type,person_id,status,first_in_at,last_out_at,minutes_late,reason_code,reason,notes,source_method,official,finalized,created_by,created_at,updated_at)
SELECT r.id,r.organization_id,r.session_id,s.attendance_date,'student',r.student_id,r.status,r.arrival_time,r.departure_time,r.minutes_late,r.reason_code,r.reason,r.remarks,
  CASE r.source WHEN 'manual' THEN 'MANUAL' WHEN 'device' THEN 'API' ELSE UPPER(r.source) END,1,CASE WHEN s.status IN ('submitted','locked') THEN 1 ELSE 0 END,r.marked_by,r.created_at,r.updated_at
FROM school_student_attendance_records r JOIN school_student_attendance_sessions s ON s.id=r.session_id;

-- Staff daily records do not need a synthetic session.
INSERT OR IGNORE INTO att_records (id,organization_id,attendance_date,person_type,person_id,status,first_in_at,last_out_at,minutes_late,worked_minutes,break_minutes,overtime_minutes,reason,notes,source_method,official,finalized,approved_by,created_by,created_at,updated_at)
SELECT id,organization_id,attendance_date,'staff',staff_id,status,first_clock_in,last_clock_out,minutes_late,worked_minutes,break_minutes,overtime_minutes,reason,notes,
  CASE source WHEN 'manual' THEN 'MANUAL' WHEN 'clock' THEN 'MANUAL' WHEN 'device' THEN 'API' ELSE UPPER(source) END,1,locked,approved_by,created_by,created_at,updated_at
FROM school_staff_attendance_records;

INSERT OR IGNORE INTO att_events (id,organization_id,person_type,person_id,direction,method,verification_mode,verification_status,captured_at,received_at,synced_at,official,record_id,metadata_json,created_by)
SELECT e.id,e.organization_id,'staff',e.staff_id,CASE WHEN e.event_type IN ('clock_in','break_in') THEN 'IN' ELSE 'OUT' END,
  CASE e.source WHEN 'device' THEN 'API' WHEN 'api' THEN 'API' WHEN 'import' THEN 'IMPORT' ELSE 'MANUAL' END,
  'STANDARD','verified',e.event_at,e.created_at,e.created_at,1,e.daily_record_id,json_object('legacyEventType',e.event_type,'location',e.location_text,'notes',e.notes),e.recorded_by
FROM school_staff_attendance_events e;

-- Dedicated permissions. Existing attendance roles keep equivalent access.
INSERT OR IGNORE INTO school_role_permissions (organization_id,role_id,permission,effect)
SELECT organization_id,id,'attendance:read','allow' FROM school_roles WHERE code IN ('super_admin','school_admin','head_teacher','deputy_head','director','teacher','class_teacher','registrar','receptionist');
INSERT OR IGNORE INTO school_role_permissions (organization_id,role_id,permission,effect)
SELECT organization_id,id,'attendance:write','allow' FROM school_roles WHERE code IN ('super_admin','school_admin','head_teacher','deputy_head','teacher','class_teacher','registrar','receptionist');
INSERT OR IGNORE INTO school_role_permissions (organization_id,role_id,permission,effect)
SELECT organization_id,id,'attendance:manage','allow' FROM school_roles WHERE code IN ('super_admin','school_admin','head_teacher','deputy_head','director');
INSERT OR IGNORE INTO school_role_permissions (organization_id,role_id,permission,effect)
SELECT organization_id,id,'attendance:biometrics','allow' FROM school_roles WHERE code IN ('super_admin','school_admin','head_teacher');
INSERT OR IGNORE INTO school_role_permissions (organization_id,role_id,permission,effect)
SELECT organization_id,id,'attendance:devices','allow' FROM school_roles WHERE code IN ('super_admin','school_admin');

-- Academics keeps its legacy foreign-key column for safe migration rollback while
-- new integrations point at the canonical Attendance session.
ALTER TABLE acad_lesson_deliveries ADD COLUMN canonical_attendance_session_id TEXT REFERENCES att_sessions(id) ON DELETE SET NULL;
UPDATE acad_lesson_deliveries SET canonical_attendance_session_id=attendance_session_id WHERE attendance_session_id IN (SELECT id FROM att_sessions);
CREATE INDEX IF NOT EXISTS acad_delivery_att_session_idx ON acad_lesson_deliveries(organization_id,canonical_attendance_session_id);
