export async function ensureExamsSchema(database) {
  await database.query(`
CREATE TABLE IF NOT EXISTS exm_grading_scales (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, code)
);
CREATE UNIQUE INDEX IF NOT EXISTS exm_default_scale_uq ON exm_grading_scales(organization_id) WHERE is_default AND active;

CREATE TABLE IF NOT EXISTS exm_grade_bands (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  grading_scale_id text NOT NULL REFERENCES exm_grading_scales(id) ON DELETE CASCADE,
  grade text NOT NULL,
  label text NOT NULL,
  min_mark double precision NOT NULL,
  max_mark double precision NOT NULL,
  points integer,
  color_hex text NOT NULL DEFAULT '#64748B',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(min_mark <= max_mark),
  UNIQUE(grading_scale_id, grade)
);

CREATE TABLE IF NOT EXISTS exm_comment_rules (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  comment_type text NOT NULL CHECK(comment_type IN ('class_teacher','head_teacher')),
  min_agg integer NOT NULL,
  max_agg integer NOT NULL,
  comment_text text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(min_agg <= max_agg)
);

CREATE TABLE IF NOT EXISTS exm_exams (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  term_id text REFERENCES school_terms(id) ON DELETE SET NULL,
  academic_year_id text REFERENCES school_academic_years(id) ON DELETE SET NULL,
  name text NOT NULL,
  exam_type text NOT NULL DEFAULT 'end_of_term' CHECK(exam_type IN ('end_of_term','mid_term','mock','internal','continuous_assessment','other')),
  start_date date,
  end_date date,
  grading_scale_id text REFERENCES exm_grading_scales(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','marking','published','archived')),
  remarks text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(end_date IS NULL OR start_date IS NULL OR start_date <= end_date)
);

CREATE TABLE IF NOT EXISTS exm_exam_classes (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  exam_id text NOT NULL REFERENCES exm_exams(id) ON DELETE CASCADE,
  class_id text NOT NULL REFERENCES school_classes(id) ON DELETE RESTRICT,
  stream_id text REFERENCES school_streams(id) ON DELETE SET NULL,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS exm_exam_classes_uq ON exm_exam_classes(exam_id,class_id,COALESCE(stream_id,''));

CREATE TABLE IF NOT EXISTS exm_exam_subjects (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  exam_id text NOT NULL REFERENCES exm_exams(id) ON DELETE CASCADE,
  class_id text NOT NULL REFERENCES school_classes(id) ON DELETE RESTRICT,
  subject_id text NOT NULL REFERENCES school_subjects(id) ON DELETE RESTRICT,
  max_mark double precision NOT NULL DEFAULT 100 CHECK(max_mark > 0),
  passing_mark double precision NOT NULL DEFAULT 50 CHECK(passing_mark >= 0),
  is_gradable boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(passing_mark <= max_mark),
  UNIQUE(exam_id,class_id,subject_id)
);

CREATE TABLE IF NOT EXISTS exm_marks (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  exam_id text NOT NULL REFERENCES exm_exams(id) ON DELETE CASCADE,
  exam_subject_id text NOT NULL REFERENCES exm_exam_subjects(id) ON DELETE RESTRICT,
  student_id text NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  class_id text NOT NULL REFERENCES school_classes(id) ON DELETE RESTRICT,
  subject_id text NOT NULL REFERENCES school_subjects(id) ON DELETE RESTRICT,
  marks_obtained double precision,
  is_absent boolean NOT NULL DEFAULT false,
  is_exempt boolean NOT NULL DEFAULT false,
  percentage double precision,
  grade text,
  grade_points integer,
  remarks text,
  entered_by text REFERENCES users(id) ON DELETE SET NULL,
  entered_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(NOT (is_absent AND is_exempt)),
  CHECK(percentage IS NULL OR percentage BETWEEN 0 AND 100),
  UNIQUE(exam_id,student_id,subject_id)
);

CREATE TABLE IF NOT EXISTS exm_mark_audit (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  mark_id text,
  exam_id text REFERENCES exm_exams(id) ON DELETE CASCADE,
  student_id text REFERENCES school_students(id) ON DELETE SET NULL,
  subject_id text REFERENCES school_subjects(id) ON DELETE SET NULL,
  action text NOT NULL,
  old_mark double precision,
  new_mark double precision,
  changed_by text REFERENCES users(id) ON DELETE SET NULL,
  reason text,
  changes_json text NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exm_report_cards (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  exam_id text NOT NULL REFERENCES exm_exams(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  class_id text NOT NULL REFERENCES school_classes(id) ON DELETE RESTRICT,
  stream_id text REFERENCES school_streams(id) ON DELETE SET NULL,
  total_marks double precision NOT NULL DEFAULT 0,
  max_possible_marks double precision NOT NULL DEFAULT 0,
  subjects_sat integer NOT NULL DEFAULT 0 CHECK(subjects_sat >= 0),
  subjects_missing integer NOT NULL DEFAULT 0 CHECK(subjects_missing >= 0),
  aggregate integer,
  division text,
  grade_summary text NOT NULL DEFAULT '{}',
  class_teacher_comment text,
  head_teacher_comment text,
  class_teacher_id text REFERENCES users(id) ON DELETE SET NULL,
  head_teacher_id text REFERENCES users(id) ON DELETE SET NULL,
  position_in_class integer CHECK(position_in_class IS NULL OR position_in_class > 0),
  total_students_in_class integer CHECK(total_students_in_class IS NULL OR total_students_in_class >= 0),
  attendance_percent double precision CHECK(attendance_percent IS NULL OR attendance_percent BETWEEN 0 AND 100),
  is_published boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  published_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK((is_published AND published_at IS NOT NULL) OR (NOT is_published)),
  UNIQUE(exam_id,student_id)
);

-- PostgreSQL-only operational ledger for durable, idempotent PDF generation.
CREATE TABLE IF NOT EXISTS exm_report_card_artifacts (
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  exam_id text NOT NULL REFERENCES exm_exams(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  version text NOT NULL,
  storage_key text NOT NULL,
  content_sha256 text,
  generated_by text REFERENCES users(id) ON DELETE SET NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,exam_id,student_id,version),
  UNIQUE(organization_id,storage_key)
);

CREATE INDEX IF NOT EXISTS exm_exams_org_idx ON exm_exams(organization_id,academic_year_id,term_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS exm_exam_classes_lookup_idx ON exm_exam_classes(organization_id,exam_id,class_id,stream_id);
CREATE INDEX IF NOT EXISTS exm_exam_subjects_lookup_idx ON exm_exam_subjects(organization_id,exam_id,class_id,subject_id);
CREATE INDEX IF NOT EXISTS exm_marks_exam_idx ON exm_marks(organization_id,exam_id,class_id,subject_id);
CREATE INDEX IF NOT EXISTS exm_marks_student_idx ON exm_marks(organization_id,student_id,exam_id);
CREATE INDEX IF NOT EXISTS exm_mark_audit_exam_idx ON exm_mark_audit(organization_id,exam_id,created_at DESC);
CREATE INDEX IF NOT EXISTS exm_cards_class_idx ON exm_report_cards(organization_id,exam_id,class_id,position_in_class);
CREATE INDEX IF NOT EXISTS exm_artifacts_student_idx ON exm_report_card_artifacts(organization_id,student_id,generated_at DESC);
  `);
}
