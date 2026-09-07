-- School Management: R2 file registry, Staff & Teacher Management, and payroll installment accounting.

CREATE TABLE IF NOT EXISTS school_files (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'document',
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, object_key)
);
CREATE INDEX IF NOT EXISTS school_files_org_created_idx ON school_files(organization_id, created_at DESC);

ALTER TABLE school_profiles ADD COLUMN logo_file_id TEXT REFERENCES school_files(id) ON DELETE SET NULL;
ALTER TABLE school_user_profiles ADD COLUMN profile_photo_file_id TEXT REFERENCES school_files(id) ON DELETE SET NULL;
ALTER TABLE school_user_profiles ADD COLUMN signature_file_id TEXT REFERENCES school_files(id) ON DELETE SET NULL;
ALTER TABLE school_document_templates ADD COLUMN file_id TEXT REFERENCES school_files(id) ON DELETE SET NULL;
ALTER TABLE school_student_documents ADD COLUMN file_id TEXT REFERENCES school_files(id) ON DELETE SET NULL;
ALTER TABLE school_students ADD COLUMN profile_photo_file_id TEXT REFERENCES school_files(id) ON DELETE SET NULL;
ALTER TABLE school_guardians ADD COLUMN profile_photo_file_id TEXT REFERENCES school_files(id) ON DELETE SET NULL;
ALTER TABLE school_authorized_pickups ADD COLUMN photo_file_id TEXT REFERENCES school_files(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS school_staff_positions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  department_id TEXT REFERENCES school_departments(id) ON DELETE SET NULL,
  campus_id TEXT REFERENCES school_branches(id) ON DELETE SET NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  job_grade TEXT,
  is_teaching INTEGER NOT NULL DEFAULT 0,
  is_management INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, code)
);
CREATE INDEX IF NOT EXISTS school_staff_positions_org_idx ON school_staff_positions(organization_id, department_id, active);

CREATE TABLE IF NOT EXISTS school_staff_profiles (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  payroll_employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  payable_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  staff_number TEXT NOT NULL,
  first_name TEXT NOT NULL,
  middle_name TEXT,
  last_name TEXT NOT NULL,
  preferred_name TEXT,
  gender TEXT,
  date_of_birth TEXT,
  nationality TEXT,
  national_id TEXT,
  tax_identifier TEXT,
  phone TEXT,
  alternate_phone TEXT,
  email TEXT,
  physical_address TEXT,
  postal_address TEXT,
  department_id TEXT REFERENCES school_departments(id) ON DELETE SET NULL,
  position_id TEXT REFERENCES school_staff_positions(id) ON DELETE SET NULL,
  campus_id TEXT REFERENCES school_branches(id) ON DELETE SET NULL,
  employment_type TEXT NOT NULL DEFAULT 'permanent' CHECK(employment_type IN ('permanent','contract','part_time','casual','intern','volunteer')),
  employment_status TEXT NOT NULL DEFAULT 'active' CHECK(employment_status IN ('active','on_leave','suspended','terminated','resigned','retired','inactive')),
  is_teacher INTEGER NOT NULL DEFAULT 0,
  hire_date TEXT NOT NULL,
  termination_date TEXT,
  base_pay_minor INTEGER NOT NULL DEFAULT 0,
  pay_type TEXT NOT NULL DEFAULT 'salary' CHECK(pay_type IN ('salary','hourly')),
  currency TEXT NOT NULL DEFAULT 'UGX',
  profile_photo_file_id TEXT REFERENCES school_files(id) ON DELETE SET NULL,
  notes TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, staff_number),
  UNIQUE(organization_id, contact_id),
  UNIQUE(organization_id, payroll_employee_id)
);
CREATE INDEX IF NOT EXISTS school_staff_org_name_idx ON school_staff_profiles(organization_id, last_name, first_name);
CREATE INDEX IF NOT EXISTS school_staff_org_assignment_idx ON school_staff_profiles(organization_id, campus_id, department_id, position_id, employment_status);

CREATE TABLE IF NOT EXISTS school_staff_emergency_contacts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES school_staff_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  relationship TEXT,
  phone TEXT NOT NULL,
  alternate_phone TEXT,
  email TEXT,
  physical_address TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS school_staff_primary_emergency_uq ON school_staff_emergency_contacts(organization_id, staff_id) WHERE is_primary=1;

CREATE TABLE IF NOT EXISTS school_staff_qualifications (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES school_staff_profiles(id) ON DELETE CASCADE,
  qualification_type TEXT NOT NULL,
  qualification_name TEXT NOT NULL,
  institution TEXT,
  field_of_study TEXT,
  level TEXT,
  grade TEXT,
  awarded_on TEXT,
  expires_on TEXT,
  registration_number TEXT,
  file_id TEXT REFERENCES school_files(id) ON DELETE SET NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  verified_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS school_staff_qualifications_staff_idx ON school_staff_qualifications(organization_id, staff_id);

CREATE TABLE IF NOT EXISTS school_staff_subjects (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES school_staff_profiles(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES school_subjects(id) ON DELETE RESTRICT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  proficiency_level TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(organization_id, staff_id, subject_id)
);

CREATE TABLE IF NOT EXISTS school_staff_teaching_assignments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES school_staff_profiles(id) ON DELETE CASCADE,
  academic_year_id TEXT REFERENCES school_academic_years(id) ON DELETE SET NULL,
  term_id TEXT REFERENCES school_terms(id) ON DELETE SET NULL,
  campus_id TEXT REFERENCES school_branches(id) ON DELETE SET NULL,
  class_id TEXT NOT NULL REFERENCES school_classes(id) ON DELETE CASCADE,
  stream_id TEXT REFERENCES school_streams(id) ON DELETE SET NULL,
  subject_id TEXT NOT NULL REFERENCES school_subjects(id) ON DELETE RESTRICT,
  assignment_role TEXT NOT NULL DEFAULT 'teacher',
  starts_on TEXT,
  ends_on TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS school_staff_teaching_assignment_uq
  ON school_staff_teaching_assignments(organization_id, staff_id, IFNULL(academic_year_id,''), IFNULL(term_id,''), class_id, IFNULL(stream_id,''), subject_id);
CREATE INDEX IF NOT EXISTS school_staff_teaching_class_idx ON school_staff_teaching_assignments(organization_id, class_id, stream_id, subject_id, active);

CREATE TABLE IF NOT EXISTS school_staff_documents (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES school_staff_profiles(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  name TEXT NOT NULL,
  file_id TEXT NOT NULL REFERENCES school_files(id) ON DELETE RESTRICT,
  issued_on TEXT,
  expires_on TEXT,
  notes TEXT,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS school_staff_documents_staff_idx ON school_staff_documents(organization_id, staff_id, document_type);

CREATE TABLE IF NOT EXISTS school_staff_compensation (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES school_staff_profiles(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  component_type TEXT NOT NULL CHECK(component_type IN ('earning','deduction')),
  category TEXT NOT NULL CHECK(category IN ('salary','commission','allowance','bonus','overtime','benefit','deduction','loan_recovery','salary_advance','other')),
  calculation_type TEXT NOT NULL DEFAULT 'fixed' CHECK(calculation_type IN ('fixed','percentage')),
  amount_minor INTEGER,
  rate_micros INTEGER,
  taxable INTEGER NOT NULL DEFAULT 0,
  pensionable INTEGER NOT NULL DEFAULT 0,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, staff_id, code, effective_from)
);
CREATE INDEX IF NOT EXISTS school_staff_compensation_staff_idx ON school_staff_compensation(organization_id, staff_id, active, effective_from, effective_to);

CREATE TABLE IF NOT EXISTS school_staff_salary_payments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES school_staff_profiles(id) ON DELETE RESTRICT,
  payroll_line_id TEXT NOT NULL REFERENCES payroll_lines(id) ON DELETE RESTRICT,
  payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  payment_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted' CHECK(status IN ('posted','reversed')),
  reversed_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, payment_id)
);
CREATE INDEX IF NOT EXISTS school_staff_salary_payments_line_idx ON school_staff_salary_payments(organization_id, payroll_line_id, status);

ALTER TABLE payroll_lines ADD COLUMN paid_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN balance_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid';

-- Existing payroll lines should begin with their full net amount outstanding.
UPDATE payroll_lines SET balance_minor=net_minor-paid_minor WHERE balance_minor=0 AND net_minor>0;


-- Publish the expanded School Management module capabilities in the registry.
UPDATE app_modules
SET version='1.1.0',
    manifest_json='{"backendModules":["setup","iam","student-management","staff-teacher-management","files"],"plannedModules":["fees","attendance","exams","timetable","library","boarding","transport","discipline","communications"],"accountingIntegration":true,"r2Uploads":true,"salaryInstallments":true}',
    updated_at=CURRENT_TIMESTAMP
WHERE module_key='school-management';
