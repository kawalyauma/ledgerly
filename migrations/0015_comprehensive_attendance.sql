-- Comprehensive School Attendance: student session attendance, staff daily attendance,
-- clock events, correction history, locking and reporting support.

CREATE TABLE IF NOT EXISTS school_student_attendance_sessions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  academic_year_id TEXT NOT NULL REFERENCES school_academic_years(id) ON DELETE RESTRICT,
  term_id TEXT REFERENCES school_terms(id) ON DELETE SET NULL,
  campus_id TEXT REFERENCES school_branches(id) ON DELETE SET NULL,
  attendance_date TEXT NOT NULL,
  session_type TEXT NOT NULL DEFAULT 'daily' CHECK(session_type IN ('daily','period','assembly','event','other')),
  class_id TEXT NOT NULL REFERENCES school_classes(id) ON DELETE RESTRICT,
  stream_id TEXT REFERENCES school_streams(id) ON DELETE SET NULL,
  subject_id TEXT REFERENCES school_subjects(id) ON DELETE SET NULL,
  lesson_period_id TEXT REFERENCES school_lesson_periods(id) ON DELETE SET NULL,
  title TEXT,
  starts_at TEXT,
  ends_at TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('draft','open','submitted','locked','cancelled')),
  expected_count INTEGER NOT NULL DEFAULT 0,
  marked_count INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','import','api','device')),
  notes TEXT,
  marked_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  submitted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TEXT,
  locked_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  locked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(ends_at IS NULL OR starts_at IS NULL OR starts_at <= ends_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS school_student_attendance_session_uq
  ON school_student_attendance_sessions(
    organization_id, attendance_date, session_type, class_id,
    IFNULL(stream_id,''), IFNULL(subject_id,''), IFNULL(lesson_period_id,'')
  );
CREATE INDEX IF NOT EXISTS school_student_attendance_session_date_idx
  ON school_student_attendance_sessions(organization_id, attendance_date, class_id, stream_id, status);

CREATE TABLE IF NOT EXISTS school_student_attendance_records (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES school_student_attendance_sessions(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('present','absent','late','excused','sick','permission')),
  arrival_time TEXT,
  departure_time TEXT,
  minutes_late INTEGER NOT NULL DEFAULT 0 CHECK(minutes_late >= 0),
  reason_code TEXT,
  reason TEXT,
  remarks TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','import','api','device')),
  marked_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  marked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  corrected_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  correction_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, session_id, student_id)
);
CREATE INDEX IF NOT EXISTS school_student_attendance_record_student_idx
  ON school_student_attendance_records(organization_id, student_id, status, marked_at DESC);
CREATE INDEX IF NOT EXISTS school_student_attendance_record_session_idx
  ON school_student_attendance_records(organization_id, session_id, status);

CREATE TABLE IF NOT EXISTS school_student_attendance_changes (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  record_id TEXT NOT NULL REFERENCES school_student_attendance_records(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES school_student_attendance_sessions(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  previous_status TEXT,
  new_status TEXT NOT NULL,
  before_json TEXT NOT NULL DEFAULT '{}',
  after_json TEXT NOT NULL DEFAULT '{}',
  reason TEXT NOT NULL,
  changed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS school_student_attendance_change_record_idx
  ON school_student_attendance_changes(organization_id, record_id, changed_at DESC);

CREATE TABLE IF NOT EXISTS school_staff_attendance_day_locks (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  attendance_date TEXT NOT NULL,
  locked_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  locked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason TEXT,
  UNIQUE(organization_id, attendance_date)
);
CREATE INDEX IF NOT EXISTS school_staff_attendance_day_lock_idx
  ON school_staff_attendance_day_locks(organization_id, attendance_date);

CREATE TABLE IF NOT EXISTS school_staff_attendance_records (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES school_staff_profiles(id) ON DELETE CASCADE,
  attendance_date TEXT NOT NULL,
  campus_id TEXT REFERENCES school_branches(id) ON DELETE SET NULL,
  department_id TEXT REFERENCES school_departments(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'present' CHECK(status IN ('present','absent','late','on_leave','sick','official_duty','remote','half_day')),
  scheduled_start TEXT,
  scheduled_end TEXT,
  first_clock_in TEXT,
  last_clock_out TEXT,
  worked_minutes INTEGER NOT NULL DEFAULT 0 CHECK(worked_minutes >= 0),
  break_minutes INTEGER NOT NULL DEFAULT 0 CHECK(break_minutes >= 0),
  overtime_minutes INTEGER NOT NULL DEFAULT 0 CHECK(overtime_minutes >= 0),
  minutes_late INTEGER NOT NULL DEFAULT 0 CHECK(minutes_late >= 0),
  leave_type TEXT,
  reason TEXT,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','clock','import','api','device')),
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  corrected_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  correction_reason TEXT,
  locked INTEGER NOT NULL DEFAULT 0,
  locked_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  locked_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, staff_id, attendance_date)
);
CREATE INDEX IF NOT EXISTS school_staff_attendance_date_idx
  ON school_staff_attendance_records(organization_id, attendance_date, status, campus_id, department_id);
CREATE INDEX IF NOT EXISTS school_staff_attendance_staff_idx
  ON school_staff_attendance_records(organization_id, staff_id, attendance_date DESC);

CREATE TABLE IF NOT EXISTS school_staff_attendance_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES school_staff_profiles(id) ON DELETE CASCADE,
  daily_record_id TEXT NOT NULL REFERENCES school_staff_attendance_records(id) ON DELETE CASCADE,
  attendance_date TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('clock_in','clock_out','break_out','break_in')),
  event_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'clock' CHECK(source IN ('manual','clock','api','device','import')),
  device_id TEXT,
  location_text TEXT,
  notes TEXT,
  recorded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS school_staff_attendance_event_staff_idx
  ON school_staff_attendance_events(organization_id, staff_id, attendance_date, event_at);

CREATE TABLE IF NOT EXISTS school_staff_attendance_changes (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  record_id TEXT NOT NULL REFERENCES school_staff_attendance_records(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES school_staff_profiles(id) ON DELETE CASCADE,
  attendance_date TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT NOT NULL,
  before_json TEXT NOT NULL DEFAULT '{}',
  after_json TEXT NOT NULL DEFAULT '{}',
  reason TEXT NOT NULL,
  changed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS school_staff_attendance_change_record_idx
  ON school_staff_attendance_changes(organization_id, record_id, changed_at DESC);

-- Existing built-in roles receive sensible attendance access immediately.
INSERT OR IGNORE INTO school_role_permissions (organization_id, role_id, permission, effect)
SELECT organization_id, id, 'school.attendance:read', 'allow'
FROM school_roles
WHERE code IN ('super_admin','school_admin','head_teacher','deputy_head','director','teacher','class_teacher','registrar','receptionist');

INSERT OR IGNORE INTO school_role_permissions (organization_id, role_id, permission, effect)
SELECT organization_id, id, 'school.attendance.student:write', 'allow'
FROM school_roles
WHERE code IN ('super_admin','school_admin','head_teacher','deputy_head','teacher','class_teacher','registrar');

INSERT OR IGNORE INTO school_role_permissions (organization_id, role_id, permission, effect)
SELECT organization_id, id, 'school.attendance.staff:write', 'allow'
FROM school_roles
WHERE code IN ('super_admin','school_admin','head_teacher','deputy_head','receptionist');

INSERT OR IGNORE INTO school_role_permissions (organization_id, role_id, permission, effect)
SELECT organization_id, id, 'school.attendance:manage', 'allow'
FROM school_roles
WHERE code IN ('super_admin','school_admin','head_teacher','deputy_head','director');

INSERT OR IGNORE INTO school_role_permissions (organization_id, role_id, permission, effect)
SELECT organization_id, id, 'school.attendance:export', 'allow'
FROM school_roles
WHERE code IN ('super_admin','school_admin','head_teacher','deputy_head','director','registrar');
