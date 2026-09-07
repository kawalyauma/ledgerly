PRAGMA foreign_keys=ON;

-- School Management plugin: setup/configuration, school IAM, admissions and student master data.
CREATE TABLE IF NOT EXISTS school_profiles (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  school_code TEXT NOT NULL,
  registration_number TEXT,
  logo_url TEXT,
  motto TEXT,
  school_type TEXT NOT NULL DEFAULT 'day',
  ownership_type TEXT,
  education_level TEXT,
  curriculum TEXT,
  phone_numbers_json TEXT NOT NULL DEFAULT '[]',
  email_addresses_json TEXT NOT NULL DEFAULT '[]',
  website TEXT,
  physical_address TEXT,
  postal_address TEXT,
  country TEXT NOT NULL DEFAULT 'Uganda',
  district_region TEXT,
  location_text TEXT,
  head_teacher_name TEXT,
  head_teacher_phone TEXT,
  head_teacher_email TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  timezone TEXT NOT NULL DEFAULT 'Africa/Kampala',
  date_format TEXT NOT NULL DEFAULT 'DD/MM/YYYY',
  time_format TEXT NOT NULL DEFAULT '24h',
  default_currency TEXT NOT NULL DEFAULT 'UGX',
  multi_campus_enabled INTEGER NOT NULL DEFAULT 0,
  branding_json TEXT NOT NULL DEFAULT '{}',
  system_preferences_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS school_profiles_code_uq ON school_profiles(school_code);

CREATE TABLE IF NOT EXISTS school_branches (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  registration_number TEXT,
  phone TEXT,
  email TEXT,
  physical_address TEXT,
  postal_address TEXT,
  district_region TEXT,
  location_text TEXT,
  principal_name TEXT,
  is_main INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, code)
);
CREATE INDEX IF NOT EXISTS school_branches_org_idx ON school_branches(organization_id, active, name);

CREATE TABLE IF NOT EXISTS school_academic_years (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','active','closed','archived')),
  is_current INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(starts_on <= ends_on),
  UNIQUE(organization_id, code)
);
CREATE UNIQUE INDEX IF NOT EXISTS school_academic_year_current_uq ON school_academic_years(organization_id) WHERE is_current=1;
CREATE INDEX IF NOT EXISTS school_academic_year_dates_idx ON school_academic_years(organization_id, starts_on, ends_on);

CREATE TABLE IF NOT EXISTS school_terms (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  academic_year_id TEXT NOT NULL REFERENCES school_academic_years(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  sequence_no INTEGER NOT NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','active','closed','archived')),
  is_current INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(starts_on <= ends_on),
  UNIQUE(organization_id, academic_year_id, code),
  UNIQUE(organization_id, academic_year_id, sequence_no)
);
CREATE UNIQUE INDEX IF NOT EXISTS school_term_current_uq ON school_terms(organization_id) WHERE is_current=1;
CREATE INDEX IF NOT EXISTS school_terms_year_idx ON school_terms(organization_id, academic_year_id, starts_on);

CREATE TABLE IF NOT EXISTS school_departments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campus_id TEXT REFERENCES school_branches(id) ON DELETE SET NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  head_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  parent_id TEXT REFERENCES school_departments(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, code)
);

CREATE TABLE IF NOT EXISTS school_class_levels (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  sequence_no INTEGER NOT NULL,
  education_level TEXT,
  promotion_level_id TEXT REFERENCES school_class_levels(id) ON DELETE SET NULL,
  terminal INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, code),
  UNIQUE(organization_id, sequence_no)
);

CREATE TABLE IF NOT EXISTS school_classes (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  academic_year_id TEXT REFERENCES school_academic_years(id) ON DELETE SET NULL,
  campus_id TEXT REFERENCES school_branches(id) ON DELETE SET NULL,
  class_level_id TEXT NOT NULL REFERENCES school_class_levels(id) ON DELETE RESTRICT,
  department_id TEXT REFERENCES school_departments(id) ON DELETE SET NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  capacity INTEGER,
  class_teacher_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, academic_year_id, code)
);
CREATE INDEX IF NOT EXISTS school_classes_level_idx ON school_classes(organization_id, class_level_id, academic_year_id);

CREATE TABLE IF NOT EXISTS school_streams (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL REFERENCES school_classes(id) ON DELETE CASCADE,
  campus_id TEXT REFERENCES school_branches(id) ON DELETE SET NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  capacity INTEGER,
  class_teacher_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, class_id, code)
);

CREATE TABLE IF NOT EXISTS school_subjects (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  department_id TEXT REFERENCES school_departments(id) ON DELETE SET NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  short_name TEXT,
  subject_type TEXT NOT NULL DEFAULT 'compulsory' CHECK(subject_type IN ('compulsory','optional','elective')),
  curriculum_code TEXT,
  pass_mark REAL,
  max_mark REAL NOT NULL DEFAULT 100,
  active INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, code)
);

CREATE TABLE IF NOT EXISTS school_class_subjects (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  class_level_id TEXT NOT NULL REFERENCES school_class_levels(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES school_subjects(id) ON DELETE CASCADE,
  academic_year_id TEXT REFERENCES school_academic_years(id) ON DELETE CASCADE,
  compulsory INTEGER NOT NULL DEFAULT 1,
  periods_per_week INTEGER,
  teacher_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, class_level_id, subject_id, academic_year_id)
);

CREATE TABLE IF NOT EXISTS school_grading_scales (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  curriculum TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, code)
);
CREATE UNIQUE INDEX IF NOT EXISTS school_grading_default_uq ON school_grading_scales(organization_id) WHERE is_default=1 AND active=1;

CREATE TABLE IF NOT EXISTS school_grade_boundaries (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  grading_scale_id TEXT NOT NULL REFERENCES school_grading_scales(id) ON DELETE CASCADE,
  grade TEXT NOT NULL,
  min_score REAL NOT NULL,
  max_score REAL NOT NULL,
  points REAL,
  aggregate_points INTEGER,
  remark TEXT,
  color_hex TEXT,
  sequence_no INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(min_score <= max_score),
  UNIQUE(organization_id, grading_scale_id, grade)
);

CREATE TABLE IF NOT EXISTS school_divisions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  grading_scale_id TEXT REFERENCES school_grading_scales(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  min_aggregate INTEGER,
  max_aggregate INTEGER,
  min_subjects INTEGER,
  rule_json TEXT NOT NULL DEFAULT '{}',
  sequence_no INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, code)
);

CREATE TABLE IF NOT EXISTS school_assessment_types (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  weight_percent REAL NOT NULL DEFAULT 100,
  max_score REAL NOT NULL DEFAULT 100,
  sequence_no INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, code)
);

CREATE TABLE IF NOT EXISTS school_promotion_rules (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  class_level_id TEXT REFERENCES school_class_levels(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  minimum_average REAL,
  maximum_failed_subjects INTEGER,
  minimum_attendance_percent REAL,
  target_class_level_id TEXT REFERENCES school_class_levels(id) ON DELETE SET NULL,
  allow_manual_override INTEGER NOT NULL DEFAULT 1,
  rule_json TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS school_calendar_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campus_id TEXT REFERENCES school_branches(id) ON DELETE CASCADE,
  academic_year_id TEXT REFERENCES school_academic_years(id) ON DELETE CASCADE,
  term_id TEXT REFERENCES school_terms(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK(event_type IN ('holiday','weekend','school_event','teaching_day_override','closure','other')),
  title TEXT NOT NULL,
  description TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 1,
  teaching_day INTEGER NOT NULL DEFAULT 0,
  recurrence_rule TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(starts_at <= ends_at)
);
CREATE INDEX IF NOT EXISTS school_calendar_range_idx ON school_calendar_events(organization_id, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS school_lesson_periods (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campus_id TEXT REFERENCES school_branches(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  sequence_no INTEGER NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  period_type TEXT NOT NULL DEFAULT 'lesson' CHECK(period_type IN ('lesson','break','lunch','assembly','other')),
  teaching_period INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, campus_id, code)
);

CREATE TABLE IF NOT EXISTS school_fee_categories (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  income_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  receivable_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  taxable INTEGER NOT NULL DEFAULT 0,
  tax_code TEXT,
  refundable INTEGER NOT NULL DEFAULT 0,
  mandatory INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, code)
);

CREATE TABLE IF NOT EXISTS school_payment_methods (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  method_type TEXT NOT NULL CHECK(method_type IN ('cash','bank','mobile_money','card','cheque','online','other')),
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  configuration_json TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, code)
);

CREATE TABLE IF NOT EXISTS school_settings (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  setting_group TEXT NOT NULL,
  setting_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(organization_id, setting_group, setting_key)
);
CREATE INDEX IF NOT EXISTS school_settings_group_idx ON school_settings(organization_id, setting_group);

CREATE TABLE IF NOT EXISTS school_document_templates (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campus_id TEXT REFERENCES school_branches(id) ON DELETE SET NULL,
  template_type TEXT NOT NULL CHECK(template_type IN ('letterhead','receipt','invoice','report_card','id_card','admission','transfer','other')),
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  content_json TEXT NOT NULL DEFAULT '{}',
  is_default INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS school_templates_type_idx ON school_document_templates(organization_id, template_type, active);

-- School IAM. Core users/memberships/sessions remain authoritative for authentication.
CREATE TABLE IF NOT EXISTS school_roles (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  role_category TEXT NOT NULL DEFAULT 'custom',
  system_role INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, code)
);

CREATE TABLE IF NOT EXISTS school_role_permissions (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES school_roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  effect TEXT NOT NULL DEFAULT 'allow' CHECK(effect IN ('allow','deny')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(organization_id, role_id, permission)
);

CREATE TABLE IF NOT EXISTS school_user_profiles (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username TEXT,
  phone TEXT,
  profile_photo_url TEXT,
  signature_url TEXT,
  staff_number TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive','suspended','locked')),
  force_password_change INTEGER NOT NULL DEFAULT 0,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  notification_preferences_json TEXT NOT NULL DEFAULT '{}',
  recovery_json TEXT NOT NULL DEFAULT '{}',
  security_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(organization_id, user_id),
  UNIQUE(organization_id, username),
  UNIQUE(organization_id, phone),
  UNIQUE(organization_id, staff_number)
);

CREATE TABLE IF NOT EXISTS school_login_aliases (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alias_type TEXT NOT NULL CHECK(alias_type IN ('username','phone')),
  alias_normalized TEXT NOT NULL,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, alias_type, alias_normalized)
);
CREATE INDEX IF NOT EXISTS school_login_alias_user_idx ON school_login_aliases(user_id, organization_id);

CREATE TABLE IF NOT EXISTS school_user_roles (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES school_roles(id) ON DELETE CASCADE,
  starts_at TEXT,
  ends_at TEXT,
  assigned_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(organization_id, user_id, role_id)
);

CREATE TABLE IF NOT EXISTS school_user_access (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_type TEXT NOT NULL CHECK(access_type IN ('campus','department','class','stream','subject','student','parent')),
  resource_id TEXT NOT NULL,
  access_level TEXT NOT NULL DEFAULT 'manage' CHECK(access_level IN ('view','manage','approve','financial')),
  starts_at TEXT,
  ends_at TEXT,
  assigned_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, user_id, access_type, resource_id, access_level)
);
CREATE INDEX IF NOT EXISTS school_user_access_lookup_idx ON school_user_access(organization_id, user_id, access_type, resource_id);

CREATE TABLE IF NOT EXISTS school_temporary_permissions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  reason TEXT,
  granted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(starts_at < ends_at)
);

CREATE TABLE IF NOT EXISTS school_login_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  identifier TEXT,
  event_type TEXT NOT NULL CHECK(event_type IN ('success','failure','logout','lock','unlock','password_change','password_reset')),
  ip_address TEXT,
  user_agent TEXT,
  device_json TEXT NOT NULL DEFAULT '{}',
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS school_login_events_user_idx ON school_login_events(organization_id, user_id, created_at);

CREATE TABLE IF NOT EXISTS school_security_policies (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  minimum_password_length INTEGER NOT NULL DEFAULT 12,
  require_uppercase INTEGER NOT NULL DEFAULT 1,
  require_lowercase INTEGER NOT NULL DEFAULT 1,
  require_number INTEGER NOT NULL DEFAULT 1,
  require_symbol INTEGER NOT NULL DEFAULT 0,
  password_expiry_days INTEGER,
  password_history_count INTEGER NOT NULL DEFAULT 5,
  max_failed_logins INTEGER NOT NULL DEFAULT 5,
  lockout_minutes INTEGER NOT NULL DEFAULT 15,
  session_timeout_minutes INTEGER NOT NULL DEFAULT 30,
  require_2fa_for_admins INTEGER NOT NULL DEFAULT 0,
  allow_impersonation INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS school_impersonation_sessions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  administrator_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  starts_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ends_at TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Admissions and student master data.
CREATE TABLE IF NOT EXISTS school_admission_applications (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campus_id TEXT REFERENCES school_branches(id) ON DELETE SET NULL,
  academic_year_id TEXT REFERENCES school_academic_years(id) ON DELETE SET NULL,
  application_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('draft','submitted','screening','waitlisted','approved','rejected','enrolled','withdrawn')),
  desired_class_level_id TEXT REFERENCES school_class_levels(id) ON DELETE SET NULL,
  applicant_json TEXT NOT NULL DEFAULT '{}',
  guardian_json TEXT NOT NULL DEFAULT '{}',
  screening_json TEXT NOT NULL DEFAULT '{}',
  decision_notes TEXT,
  submitted_at TEXT,
  decided_at TEXT,
  decided_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, application_number)
);
CREATE INDEX IF NOT EXISTS school_admissions_status_idx ON school_admission_applications(organization_id, status, academic_year_id);

CREATE TABLE IF NOT EXISTS school_students (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  campus_id TEXT REFERENCES school_branches(id) ON DELETE SET NULL,
  admission_application_id TEXT REFERENCES school_admission_applications(id) ON DELETE SET NULL,
  admission_number TEXT NOT NULL,
  student_number TEXT NOT NULL,
  first_name TEXT NOT NULL,
  middle_name TEXT,
  last_name TEXT NOT NULL,
  preferred_name TEXT,
  gender TEXT,
  date_of_birth TEXT,
  nationality TEXT,
  place_of_birth TEXT,
  religion TEXT,
  home_language TEXT,
  phone TEXT,
  email TEXT,
  physical_address TEXT,
  previous_school TEXT,
  previous_class TEXT,
  admission_date TEXT NOT NULL,
  admission_class_level_id TEXT REFERENCES school_class_levels(id) ON DELETE SET NULL,
  current_academic_year_id TEXT REFERENCES school_academic_years(id) ON DELETE SET NULL,
  current_class_id TEXT REFERENCES school_classes(id) ON DELETE SET NULL,
  current_stream_id TEXT REFERENCES school_streams(id) ON DELETE SET NULL,
  student_category TEXT,
  residency_status TEXT NOT NULL DEFAULT 'day' CHECK(residency_status IN ('day','boarding','hybrid')),
  house TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('applicant','active','inactive','graduated','transferred','withdrawn','suspended','deceased','alumni')),
  financial_sponsor_contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  profile_photo_url TEXT,
  barcode_value TEXT,
  qr_code_value TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  custom_fields_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  deleted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, admission_number),
  UNIQUE(organization_id, student_number)
);
CREATE INDEX IF NOT EXISTS school_students_name_idx ON school_students(organization_id, last_name, first_name);
CREATE INDEX IF NOT EXISTS school_students_class_idx ON school_students(organization_id, current_academic_year_id, current_class_id, current_stream_id, status);

CREATE TABLE IF NOT EXISTS school_guardians (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  first_name TEXT NOT NULL,
  middle_name TEXT,
  last_name TEXT NOT NULL,
  phone_primary TEXT,
  phone_secondary TEXT,
  email TEXT,
  relationship_default TEXT,
  occupation TEXT,
  employer TEXT,
  physical_address TEXT,
  national_id TEXT,
  profile_photo_url TEXT,
  notification_preferences_json TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS school_guardians_contact_idx ON school_guardians(organization_id, phone_primary, email);

CREATE TABLE IF NOT EXISTS school_student_guardians (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  guardian_id TEXT NOT NULL REFERENCES school_guardians(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  is_emergency_contact INTEGER NOT NULL DEFAULT 0,
  is_authorized_pickup INTEGER NOT NULL DEFAULT 0,
  is_financially_responsible INTEGER NOT NULL DEFAULT 0,
  receives_academic_updates INTEGER NOT NULL DEFAULT 1,
  receives_financial_updates INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(organization_id, student_id, guardian_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS school_student_primary_guardian_uq ON school_student_guardians(organization_id, student_id) WHERE is_primary=1;

CREATE TABLE IF NOT EXISTS school_authorized_pickups (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  relationship TEXT,
  phone TEXT,
  national_id TEXT,
  photo_url TEXT,
  starts_on TEXT,
  ends_on TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS school_student_medical (
  student_id TEXT PRIMARY KEY REFERENCES school_students(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  blood_group TEXT,
  allergies_json TEXT NOT NULL DEFAULT '[]',
  conditions_json TEXT NOT NULL DEFAULT '[]',
  medications_json TEXT NOT NULL DEFAULT '[]',
  disabilities_json TEXT NOT NULL DEFAULT '[]',
  special_education_needs_json TEXT NOT NULL DEFAULT '[]',
  doctor_name TEXT,
  doctor_phone TEXT,
  insurance_json TEXT NOT NULL DEFAULT '{}',
  notes TEXT,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS school_enrollments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  academic_year_id TEXT NOT NULL REFERENCES school_academic_years(id) ON DELETE RESTRICT,
  class_id TEXT NOT NULL REFERENCES school_classes(id) ON DELETE RESTRICT,
  stream_id TEXT REFERENCES school_streams(id) ON DELETE SET NULL,
  campus_id TEXT REFERENCES school_branches(id) ON DELETE SET NULL,
  enrolled_on TEXT NOT NULL,
  left_on TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','transferred','withdrawn','repeated')),
  reason TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, student_id, academic_year_id)
);
CREATE INDEX IF NOT EXISTS school_enrollment_class_idx ON school_enrollments(organization_id, academic_year_id, class_id, stream_id, status);

CREATE TABLE IF NOT EXISTS school_student_status_history (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason TEXT,
  effective_on TEXT NOT NULL,
  changed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS school_student_promotions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  from_academic_year_id TEXT REFERENCES school_academic_years(id) ON DELETE SET NULL,
  to_academic_year_id TEXT REFERENCES school_academic_years(id) ON DELETE SET NULL,
  from_class_id TEXT REFERENCES school_classes(id) ON DELETE SET NULL,
  to_class_id TEXT REFERENCES school_classes(id) ON DELETE SET NULL,
  from_stream_id TEXT REFERENCES school_streams(id) ON DELETE SET NULL,
  to_stream_id TEXT REFERENCES school_streams(id) ON DELETE SET NULL,
  decision TEXT NOT NULL CHECK(decision IN ('promoted','repeated','graduated','manual_override')),
  reason TEXT,
  rule_snapshot_json TEXT NOT NULL DEFAULT '{}',
  effective_on TEXT NOT NULL,
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS school_student_transfers (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  transfer_type TEXT NOT NULL CHECK(transfer_type IN ('class','stream','campus','school_out','school_in')),
  from_class_id TEXT REFERENCES school_classes(id) ON DELETE SET NULL,
  to_class_id TEXT REFERENCES school_classes(id) ON DELETE SET NULL,
  from_stream_id TEXT REFERENCES school_streams(id) ON DELETE SET NULL,
  to_stream_id TEXT REFERENCES school_streams(id) ON DELETE SET NULL,
  from_campus_id TEXT REFERENCES school_branches(id) ON DELETE SET NULL,
  to_campus_id TEXT REFERENCES school_branches(id) ON DELETE SET NULL,
  destination_school TEXT,
  reason TEXT,
  effective_on TEXT NOT NULL,
  document_template_id TEXT REFERENCES school_document_templates(id) ON DELETE SET NULL,
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS school_student_documents (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id TEXT REFERENCES school_students(id) ON DELETE CASCADE,
  admission_application_id TEXT REFERENCES school_admission_applications(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  name TEXT NOT NULL,
  object_key TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  checksum TEXT,
  issued_on TEXT,
  expires_on TEXT,
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK(verification_status IN ('unverified','verified','rejected')),
  verified_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS school_student_docs_idx ON school_student_documents(organization_id, student_id, document_type);

CREATE TABLE IF NOT EXISTS school_student_notes (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  note_type TEXT NOT NULL DEFAULT 'general',
  body TEXT NOT NULL,
  confidential INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS school_student_tags (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  color_hex TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(organization_id, code)
);
CREATE TABLE IF NOT EXISTS school_student_tag_links (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES school_student_tags(id) ON DELETE CASCADE,
  PRIMARY KEY(organization_id, student_id, tag_id)
);

CREATE TABLE IF NOT EXISTS school_student_siblings (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  sibling_student_id TEXT NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(organization_id, student_id, sibling_student_id),
  CHECK(student_id <> sibling_student_id)
);

CREATE TABLE IF NOT EXISTS school_student_timeline (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  source_type TEXT,
  source_id TEXT,
  event_at TEXT NOT NULL,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS school_student_timeline_idx ON school_student_timeline(organization_id, student_id, event_at DESC);

CREATE TABLE IF NOT EXISTS school_import_jobs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  import_type TEXT NOT NULL,
  file_name TEXT,
  object_key TEXT,
  mapping_json TEXT NOT NULL DEFAULT '{}',
  options_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','validating','ready','processing','completed','failed','cancelled')),
  total_rows INTEGER NOT NULL DEFAULT 0,
  valid_rows INTEGER NOT NULL DEFAULT 0,
  invalid_rows INTEGER NOT NULL DEFAULT 0,
  processed_rows INTEGER NOT NULL DEFAULT 0,
  errors_json TEXT NOT NULL DEFAULT '[]',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS school_user_mfa (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method TEXT NOT NULL DEFAULT 'totp' CHECK(method IN ('totp')),
  secret_encrypted TEXT NOT NULL,
  recovery_code_hashes_json TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 0,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(organization_id,user_id,method)
);

-- Generic module registry used by optional Ledgerly application modules.
CREATE TABLE IF NOT EXISTS app_modules (
  module_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'business',
  core INTEGER NOT NULL DEFAULT 0,
  manifest_json TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS organization_modules (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL REFERENCES app_modules(module_key) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0,
  configuration_json TEXT NOT NULL DEFAULT '{}',
  enabled_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  enabled_at TEXT,
  disabled_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(organization_id,module_key)
);
INSERT OR IGNORE INTO app_modules (module_key,name,version,description,category,core,manifest_json,active)
VALUES ('school-management','School Management','1.0.0','Professional multi-campus school administration integrated with Ledgerly accounting.','education',0,'{"backendModules":["setup","iam","student-management"],"accountingIntegration":true}',1);
