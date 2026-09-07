PRAGMA foreign_keys=ON;

-- Standalone Academics module. It depends on School Management and reuses its
-- classes, subjects, terms, academic years, staff/users, departments and files.
CREATE TABLE IF NOT EXISTS acad_rooms (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campus_id TEXT REFERENCES school_branches(id) ON DELETE SET NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  capacity INTEGER,
  room_type TEXT NOT NULL DEFAULT 'classroom',
  location_text TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, code)
);
CREATE INDEX IF NOT EXISTS acad_rooms_org_idx ON acad_rooms(organization_id, active, name);

CREATE TABLE IF NOT EXISTS acad_teacher_availability (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  teacher_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  academic_year_id TEXT REFERENCES school_academic_years(id) ON DELETE CASCADE,
  term_id TEXT REFERENCES school_terms(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK(weekday BETWEEN 1 AND 7),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  availability TEXT NOT NULL DEFAULT 'available' CHECK(availability IN ('available','unavailable','preferred')),
  reason TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(starts_at < ends_at)
);
CREATE INDEX IF NOT EXISTS acad_teacher_availability_idx ON acad_teacher_availability(organization_id, teacher_user_id, term_id, weekday, starts_at);

CREATE TABLE IF NOT EXISTS acad_timetables (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  academic_year_id TEXT NOT NULL REFERENCES school_academic_years(id) ON DELETE RESTRICT,
  term_id TEXT NOT NULL REFERENCES school_terms(id) ON DELETE RESTRICT,
  campus_id TEXT REFERENCES school_branches(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','published','archived')),
  notes TEXT,
  submitted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TEXT,
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_at TEXT,
  published_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  published_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, academic_year_id, term_id, name)
);
CREATE INDEX IF NOT EXISTS acad_timetables_period_idx ON acad_timetables(organization_id, academic_year_id, term_id, status);

CREATE TABLE IF NOT EXISTS acad_timetable_entries (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  timetable_id TEXT NOT NULL REFERENCES acad_timetables(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL REFERENCES school_classes(id) ON DELETE CASCADE,
  stream_id TEXT REFERENCES school_streams(id) ON DELETE SET NULL,
  subject_id TEXT NOT NULL REFERENCES school_subjects(id) ON DELETE RESTRICT,
  teacher_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  department_id TEXT REFERENCES school_departments(id) ON DELETE SET NULL,
  room_id TEXT REFERENCES acad_rooms(id) ON DELETE SET NULL,
  weekday INTEGER NOT NULL CHECK(weekday BETWEEN 1 AND 7),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  lesson_type TEXT NOT NULL DEFAULT 'single' CHECK(lesson_type IN ('single','double')),
  lesson_count INTEGER NOT NULL DEFAULT 1 CHECK(lesson_count IN (1,2)),
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(starts_at < ends_at)
);
CREATE INDEX IF NOT EXISTS acad_tt_class_idx ON acad_timetable_entries(organization_id,timetable_id,class_id,stream_id,weekday,starts_at);
CREATE INDEX IF NOT EXISTS acad_tt_teacher_idx ON acad_timetable_entries(organization_id,timetable_id,teacher_user_id,weekday,starts_at);
CREATE INDEX IF NOT EXISTS acad_tt_room_idx ON acad_timetable_entries(organization_id,timetable_id,room_id,weekday,starts_at);

CREATE TABLE IF NOT EXISTS acad_timetable_changes (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  timetable_entry_id TEXT NOT NULL REFERENCES acad_timetable_entries(id) ON DELETE CASCADE,
  change_date TEXT NOT NULL,
  changed_teacher_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  changed_room_id TEXT REFERENCES acad_rooms(id) ON DELETE SET NULL,
  changed_starts_at TEXT,
  changed_ends_at TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('draft','approved','cancelled')),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS acad_tt_changes_date_idx ON acad_timetable_changes(organization_id,change_date,status);

CREATE TABLE IF NOT EXISTS acad_substitute_lessons (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  timetable_entry_id TEXT REFERENCES acad_timetable_entries(id) ON DELETE SET NULL,
  lesson_date TEXT NOT NULL,
  original_teacher_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  substitute_teacher_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  notes TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS acad_substitute_date_idx ON acad_substitute_lessons(organization_id,lesson_date,substitute_teacher_user_id);

CREATE TABLE IF NOT EXISTS acad_schemes (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  academic_year_id TEXT NOT NULL REFERENCES school_academic_years(id) ON DELETE RESTRICT,
  term_id TEXT NOT NULL REFERENCES school_terms(id) ON DELETE RESTRICT,
  class_id TEXT NOT NULL REFERENCES school_classes(id) ON DELETE RESTRICT,
  stream_id TEXT REFERENCES school_streams(id) ON DELETE SET NULL,
  subject_id TEXT NOT NULL REFERENCES school_subjects(id) ON DELETE RESTRICT,
  teacher_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted_hod','hod_approved','submitted_dos','approved','rejected','archived')),
  version_no INTEGER NOT NULL DEFAULT 1,
  coverage_percent REAL NOT NULL DEFAULT 0,
  teacher_reflection TEXT,
  hod_feedback TEXT,
  dos_feedback TEXT,
  hod_reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  hod_reviewed_at TEXT,
  dos_approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  dos_approved_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS acad_schemes_period_idx ON acad_schemes(organization_id,term_id,class_id,subject_id,status);

CREATE TABLE IF NOT EXISTS acad_scheme_items (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scheme_id TEXT NOT NULL REFERENCES acad_schemes(id) ON DELETE CASCADE,
  sequence_no INTEGER NOT NULL DEFAULT 1,
  week_no INTEGER NOT NULL,
  lesson_no INTEGER,
  topic TEXT NOT NULL,
  subtopic TEXT,
  learning_objectives TEXT,
  competencies TEXT,
  teaching_methods TEXT,
  learning_materials TEXT,
  references_text TEXT,
  planned_activities TEXT,
  assessment_activities TEXT,
  planned_date TEXT,
  coverage_status TEXT NOT NULL DEFAULT 'planned' CHECK(coverage_status IN ('planned','in_progress','covered','carried_forward','skipped')),
  teacher_reflection TEXT,
  covered_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(scheme_id, sequence_no)
);
CREATE INDEX IF NOT EXISTS acad_scheme_items_week_idx ON acad_scheme_items(organization_id,scheme_id,week_no,sequence_no);

CREATE TABLE IF NOT EXISTS acad_scheme_versions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scheme_id TEXT NOT NULL REFERENCES acad_schemes(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  change_note TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(scheme_id, version_no)
);

CREATE TABLE IF NOT EXISTS acad_lesson_plan_templates (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  template_json TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, name)
);

CREATE TABLE IF NOT EXISTS acad_lesson_plans (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  academic_year_id TEXT NOT NULL REFERENCES school_academic_years(id) ON DELETE RESTRICT,
  term_id TEXT NOT NULL REFERENCES school_terms(id) ON DELETE RESTRICT,
  class_id TEXT NOT NULL REFERENCES school_classes(id) ON DELETE RESTRICT,
  stream_id TEXT REFERENCES school_streams(id) ON DELETE SET NULL,
  subject_id TEXT NOT NULL REFERENCES school_subjects(id) ON DELETE RESTRICT,
  teacher_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  timetable_entry_id TEXT REFERENCES acad_timetable_entries(id) ON DELETE SET NULL,
  scheme_item_id TEXT REFERENCES acad_scheme_items(id) ON DELETE SET NULL,
  template_id TEXT REFERENCES acad_lesson_plan_templates(id) ON DELETE SET NULL,
  lesson_date TEXT NOT NULL,
  week_no INTEGER,
  lesson_no INTEGER,
  topic TEXT NOT NULL,
  subtopic TEXT,
  lesson_objectives TEXT,
  prior_knowledge TEXT,
  introduction_text TEXT,
  lesson_development TEXT,
  teacher_activities TEXT,
  learner_activities TEXT,
  teaching_methods TEXT,
  required_materials TEXT,
  differentiated_instruction TEXT,
  special_needs_accommodations TEXT,
  lesson_assessment TEXT,
  lesson_conclusion TEXT,
  homework TEXT,
  teacher_reflection TEXT,
  hod_feedback TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','rejected','delivered')),
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS acad_lesson_plan_date_idx ON acad_lesson_plans(organization_id,lesson_date,teacher_user_id,status);

CREATE TABLE IF NOT EXISTS acad_lesson_deliveries (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  timetable_entry_id TEXT REFERENCES acad_timetable_entries(id) ON DELETE SET NULL,
  lesson_plan_id TEXT REFERENCES acad_lesson_plans(id) ON DELETE SET NULL,
  academic_year_id TEXT NOT NULL REFERENCES school_academic_years(id) ON DELETE RESTRICT,
  term_id TEXT NOT NULL REFERENCES school_terms(id) ON DELETE RESTRICT,
  class_id TEXT NOT NULL REFERENCES school_classes(id) ON DELETE RESTRICT,
  stream_id TEXT REFERENCES school_streams(id) ON DELETE SET NULL,
  subject_id TEXT NOT NULL REFERENCES school_subjects(id) ON DELETE RESTRICT,
  teacher_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  substitute_teacher_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  attendance_session_id TEXT REFERENCES school_student_attendance_sessions(id) ON DELETE SET NULL,
  scheduled_date TEXT NOT NULL,
  scheduled_starts_at TEXT,
  scheduled_ends_at TEXT,
  actual_starts_at TEXT,
  actual_ends_at TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'scheduled' CHECK(delivery_status IN ('scheduled','taught','missed','postponed','recovery')),
  actual_topic TEXT,
  actual_subtopic TEXT,
  student_attendance_summary TEXT,
  lesson_notes TEXT,
  missed_reason TEXT,
  recovery_date TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS acad_delivery_date_idx ON acad_lesson_deliveries(organization_id,scheduled_date,class_id,teacher_user_id,delivery_status);

CREATE TABLE IF NOT EXISTS acad_delivery_attachments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  delivery_id TEXT NOT NULL REFERENCES acad_lesson_deliveries(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES school_files(id) ON DELETE RESTRICT,
  caption TEXT,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(delivery_id,file_id)
);

CREATE TABLE IF NOT EXISTS acad_observations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  observation_type TEXT NOT NULL CHECK(observation_type IN ('classroom','walkthrough','formal')),
  scheduled_for TEXT,
  observed_at TEXT,
  teacher_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  observer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  class_id TEXT REFERENCES school_classes(id) ON DELETE SET NULL,
  stream_id TEXT REFERENCES school_streams(id) ON DELETE SET NULL,
  subject_id TEXT REFERENCES school_subjects(id) ON DELETE SET NULL,
  lesson_plan_id TEXT REFERENCES acad_lesson_plans(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','in_progress','completed','acknowledged','followup_due','closed')),
  rubric_json TEXT NOT NULL DEFAULT '{}',
  preparation_score REAL,
  teaching_methods_score REAL,
  classroom_management_score REAL,
  learner_participation_score REAL,
  materials_use_score REAL,
  time_management_score REAL,
  strengths TEXT,
  areas_for_improvement TEXT,
  recommendations TEXT,
  confidential_notes TEXT,
  teacher_acknowledged_at TEXT,
  teacher_response TEXT,
  followup_date TEXT,
  followup_observation_id TEXT REFERENCES acad_observations(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS acad_observations_teacher_idx ON acad_observations(organization_id,teacher_user_id,scheduled_for,status);

CREATE TABLE IF NOT EXISTS acad_observation_attachments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  observation_id TEXT NOT NULL REFERENCES acad_observations(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES school_files(id) ON DELETE RESTRICT,
  caption TEXT,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(observation_id,file_id)
);

CREATE TABLE IF NOT EXISTS acad_inspections (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  inspection_type TEXT NOT NULL CHECK(inspection_type IN ('exercise_books','teacher_records','lesson_plans','schemes','attendance_register','mark_book')),
  inspected_on TEXT NOT NULL,
  inspector_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  teacher_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  class_id TEXT REFERENCES school_classes(id) ON DELETE SET NULL,
  stream_id TEXT REFERENCES school_streams(id) ON DELETE SET NULL,
  subject_id TEXT REFERENCES school_subjects(id) ON DELETE SET NULL,
  sample_size INTEGER,
  quantity_of_work TEXT,
  quality_of_marking TEXT,
  correction_feedback_checks TEXT,
  date_of_last_marking TEXT,
  findings TEXT NOT NULL,
  recommendations TEXT,
  teacher_response TEXT,
  followup_date TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','responded','followup_due','closed')),
  confidential_notes TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS acad_inspection_teacher_idx ON acad_inspections(organization_id,teacher_user_id,inspected_on,status);

CREATE TABLE IF NOT EXISTS acad_inspection_samples (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  inspection_id TEXT NOT NULL REFERENCES acad_inspections(id) ON DELETE CASCADE,
  student_id TEXT REFERENCES school_students(id) ON DELETE SET NULL,
  sample_label TEXT,
  findings TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS acad_inspection_attachments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  inspection_id TEXT NOT NULL REFERENCES acad_inspections(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES school_files(id) ON DELETE RESTRICT,
  caption TEXT,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(inspection_id,file_id)
);

-- Prevent duplicate lesson-register rows even under concurrent timetable syncs.
CREATE UNIQUE INDEX IF NOT EXISTS acad_delivery_schedule_uq
  ON acad_lesson_deliveries(organization_id, timetable_entry_id, scheduled_date)
  WHERE timetable_entry_id IS NOT NULL;

-- Upgrade academic permissions for roles that already exist in older schools.
INSERT OR IGNORE INTO school_role_permissions(organization_id,role_id,permission,effect)
SELECT organization_id,id,'school.academics:read','allow' FROM school_roles
WHERE code IN ('super_admin','school_admin','head_teacher','deputy_head','director','teacher','class_teacher');
INSERT OR IGNORE INTO school_role_permissions(organization_id,role_id,permission,effect)
SELECT organization_id,id,'school.academics:write','allow' FROM school_roles
WHERE code IN ('super_admin','school_admin','head_teacher','deputy_head','director','teacher','class_teacher');
INSERT OR IGNORE INTO school_role_permissions(organization_id,role_id,permission,effect)
SELECT organization_id,id,'school.academics:approve','allow' FROM school_roles
WHERE code IN ('super_admin','school_admin','head_teacher','deputy_head','director');
INSERT OR IGNORE INTO school_role_permissions(organization_id,role_id,permission,effect)
SELECT organization_id,id,'school.academics:supervise','allow' FROM school_roles
WHERE code IN ('super_admin','school_admin','head_teacher','deputy_head','director');
