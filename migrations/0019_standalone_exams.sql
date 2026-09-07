-- Standalone Examinations module, linked to School Management shared entities.
-- Reuses school_students, school_classes, school_streams, school_subjects,
-- school_academic_years, school_terms, users and attendance.

CREATE TABLE IF NOT EXISTS exm_grading_scales (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, code)
);
CREATE UNIQUE INDEX IF NOT EXISTS exm_default_scale_uq ON exm_grading_scales(organization_id) WHERE is_default=1 AND active=1;

CREATE TABLE IF NOT EXISTS exm_grade_bands (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  grading_scale_id TEXT NOT NULL REFERENCES exm_grading_scales(id) ON DELETE CASCADE,
  grade TEXT NOT NULL,
  label TEXT NOT NULL,
  min_mark REAL NOT NULL,
  max_mark REAL NOT NULL,
  points INTEGER,
  color_hex TEXT NOT NULL DEFAULT '#64748B',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(min_mark <= max_mark),
  UNIQUE(grading_scale_id, grade)
);
CREATE INDEX IF NOT EXISTS exm_grade_bands_scale_idx ON exm_grade_bands(grading_scale_id, sort_order);

CREATE TABLE IF NOT EXISTS exm_comment_rules (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  comment_type TEXT NOT NULL CHECK(comment_type IN ('class_teacher','head_teacher')),
  min_agg INTEGER NOT NULL,
  max_agg INTEGER NOT NULL,
  comment_text TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(min_agg <= max_agg)
);
CREATE INDEX IF NOT EXISTS exm_comment_rules_org_idx ON exm_comment_rules(organization_id, comment_type, min_agg);

CREATE TABLE IF NOT EXISTS exm_exams (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  term_id TEXT REFERENCES school_terms(id) ON DELETE SET NULL,
  academic_year_id TEXT REFERENCES school_academic_years(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  exam_type TEXT NOT NULL DEFAULT 'end_of_term' CHECK(exam_type IN ('end_of_term','mid_term','mock','internal','continuous_assessment','other')),
  start_date TEXT,
  end_date TEXT,
  grading_scale_id TEXT REFERENCES exm_grading_scales(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','marking','published','archived')),
  remarks TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(end_date IS NULL OR start_date IS NULL OR start_date <= end_date)
);
CREATE INDEX IF NOT EXISTS exm_exams_org_idx ON exm_exams(organization_id, academic_year_id, term_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS exm_exam_classes (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  exam_id TEXT NOT NULL REFERENCES exm_exams(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL REFERENCES school_classes(id) ON DELETE RESTRICT,
  stream_id TEXT REFERENCES school_streams(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS exm_exam_classes_uq ON exm_exam_classes(exam_id, class_id, IFNULL(stream_id,''));
CREATE INDEX IF NOT EXISTS exm_exam_classes_exam_idx ON exm_exam_classes(organization_id, exam_id, class_id);

CREATE TABLE IF NOT EXISTS exm_exam_subjects (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  exam_id TEXT NOT NULL REFERENCES exm_exams(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL REFERENCES school_classes(id) ON DELETE RESTRICT,
  subject_id TEXT NOT NULL REFERENCES school_subjects(id) ON DELETE RESTRICT,
  max_mark REAL NOT NULL DEFAULT 100,
  passing_mark REAL NOT NULL DEFAULT 50,
  is_gradable INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(exam_id, class_id, subject_id)
);
CREATE INDEX IF NOT EXISTS exm_exam_subjects_exam_idx ON exm_exam_subjects(organization_id, exam_id, class_id, sort_order);

CREATE TABLE IF NOT EXISTS exm_marks (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  exam_id TEXT NOT NULL REFERENCES exm_exams(id) ON DELETE CASCADE,
  exam_subject_id TEXT NOT NULL REFERENCES exm_exam_subjects(id) ON DELETE RESTRICT,
  student_id TEXT NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL REFERENCES school_classes(id) ON DELETE RESTRICT,
  subject_id TEXT NOT NULL REFERENCES school_subjects(id) ON DELETE RESTRICT,
  marks_obtained REAL,
  is_absent INTEGER NOT NULL DEFAULT 0,
  is_exempt INTEGER NOT NULL DEFAULT 0,
  percentage REAL,
  grade TEXT,
  grade_points INTEGER,
  remarks TEXT,
  entered_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  entered_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(exam_id, student_id, subject_id)
);
CREATE INDEX IF NOT EXISTS exm_marks_exam_class_idx ON exm_marks(organization_id, exam_id, class_id, subject_id);
CREATE INDEX IF NOT EXISTS exm_marks_student_idx ON exm_marks(organization_id, student_id, exam_id);

CREATE TABLE IF NOT EXISTS exm_mark_audit (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  mark_id TEXT,
  exam_id TEXT REFERENCES exm_exams(id) ON DELETE CASCADE,
  student_id TEXT REFERENCES school_students(id) ON DELETE SET NULL,
  subject_id TEXT REFERENCES school_subjects(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  old_mark REAL,
  new_mark REAL,
  changed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT,
  changes_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS exm_mark_audit_idx ON exm_mark_audit(organization_id, exam_id, student_id, created_at DESC);

CREATE TABLE IF NOT EXISTS exm_report_cards (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  exam_id TEXT NOT NULL REFERENCES exm_exams(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL REFERENCES school_classes(id) ON DELETE RESTRICT,
  stream_id TEXT REFERENCES school_streams(id) ON DELETE SET NULL,
  total_marks REAL NOT NULL DEFAULT 0,
  max_possible_marks REAL NOT NULL DEFAULT 0,
  subjects_sat INTEGER NOT NULL DEFAULT 0,
  subjects_missing INTEGER NOT NULL DEFAULT 0,
  aggregate INTEGER,
  division TEXT,
  grade_summary TEXT NOT NULL DEFAULT '{}',
  class_teacher_comment TEXT,
  head_teacher_comment TEXT,
  class_teacher_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  head_teacher_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  position_in_class INTEGER,
  total_students_in_class INTEGER,
  attendance_percent REAL,
  is_published INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  published_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(exam_id, student_id)
);
CREATE INDEX IF NOT EXISTS exm_report_cards_class_idx ON exm_report_cards(organization_id, exam_id, class_id, position_in_class);
CREATE INDEX IF NOT EXISTS exm_report_cards_student_idx ON exm_report_cards(organization_id, student_id, exam_id, is_published);

-- Granular school role permissions for the standalone Exams module.
INSERT OR IGNORE INTO school_role_permissions (organization_id, role_id, permission, effect)
SELECT organization_id,id,'school.exams:read','allow' FROM school_roles
WHERE code IN ('super_admin','school_admin','head_teacher','deputy_head','director','teacher','class_teacher','registrar');

INSERT OR IGNORE INTO school_role_permissions (organization_id, role_id, permission, effect)
SELECT organization_id,id,'school.exams:write','allow' FROM school_roles
WHERE code IN ('super_admin','school_admin','head_teacher','deputy_head','teacher','class_teacher');

INSERT OR IGNORE INTO school_role_permissions (organization_id, role_id, permission, effect)
SELECT organization_id,id,'school.exams:manage','allow' FROM school_roles
WHERE code IN ('super_admin','school_admin','head_teacher','deputy_head','director');

INSERT OR IGNORE INTO school_role_permissions (organization_id, role_id, permission, effect)
SELECT organization_id,id,'school.exams:publish','allow' FROM school_roles
WHERE code IN ('super_admin','school_admin','head_teacher','deputy_head','director');

-- Backfill shared Ledgerly contacts for guardians created before this release.
INSERT OR IGNORE INTO contacts (id,organization_id,type,code,name,email,active,custom_fields)
SELECT 'con_guardian_' || g.id,g.organization_id,'customer',NULL,
       trim(g.first_name || ' ' || COALESCE(g.middle_name || ' ','') || g.last_name),g.email,1,
       json_object('schoolGuardianId',g.id,'source','school_guardian_backfill')
FROM school_guardians g
WHERE g.contact_id IS NULL AND (g.phone_primary IS NOT NULL OR g.phone_secondary IS NOT NULL OR g.email IS NOT NULL);

UPDATE school_guardians
SET contact_id='con_guardian_' || id,updated_at=CURRENT_TIMESTAMP
WHERE contact_id IS NULL AND (phone_primary IS NOT NULL OR phone_secondary IS NOT NULL OR email IS NOT NULL)
  AND EXISTS(SELECT 1 FROM contacts c WHERE c.id='con_guardian_' || school_guardians.id);

INSERT OR IGNORE INTO contact_people (id,organization_id,contact_id,name,email,phone,role,is_primary)
SELECT 'cpr_guardian_' || g.id,g.organization_id,g.contact_id,
       trim(g.first_name || ' ' || COALESCE(g.middle_name || ' ','') || g.last_name),
       g.email,COALESCE(g.phone_primary,g.phone_secondary),COALESCE(g.relationship_default,'Guardian'),1
FROM school_guardians g
WHERE g.contact_id IS NOT NULL
  AND (g.phone_primary IS NOT NULL OR g.phone_secondary IS NOT NULL OR g.email IS NOT NULL)
  AND NOT EXISTS(
    SELECT 1 FROM contact_people cp
    WHERE cp.organization_id=g.organization_id AND cp.contact_id=g.contact_id
  );
