export async function ensureHumanResourcesSchema(database) {
  await database.query(`
    CREATE TABLE IF NOT EXISTS hr_departments (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      code text NOT NULL, name text NOT NULL, manager_employee_id text, active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,code)
    );
    CREATE TABLE IF NOT EXISTS hr_employees (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id text REFERENCES users(id) ON DELETE SET NULL, contact_id text REFERENCES contacts(id) ON DELETE SET NULL,
      school_staff_id text, department_id text REFERENCES hr_departments(id) ON DELETE SET NULL, employee_number text NOT NULL,
      job_title text, employment_type text NOT NULL DEFAULT 'permanent', employment_status text NOT NULL DEFAULT 'active',
      hire_date date NOT NULL, termination_date date, manager_employee_id text REFERENCES hr_employees(id) ON DELETE SET NULL,
      work_email text, work_phone text, metadata_json text NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(organization_id,employee_number), UNIQUE(organization_id,user_id), UNIQUE(organization_id,contact_id), UNIQUE(organization_id,school_staff_id)
    );
    ALTER TABLE hr_departments DROP CONSTRAINT IF EXISTS hr_departments_manager_fk;
    ALTER TABLE hr_departments ADD CONSTRAINT hr_departments_manager_fk FOREIGN KEY(manager_employee_id) REFERENCES hr_employees(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS hr_employees_org_status_idx ON hr_employees(organization_id,employment_status,department_id);
    CREATE INDEX IF NOT EXISTS hr_employees_staff_idx ON hr_employees(organization_id,school_staff_id) WHERE school_staff_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS hr_leave_types (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      code text NOT NULL, name text NOT NULL, paid boolean NOT NULL DEFAULT true, annual_days_micros bigint NOT NULL DEFAULT 0,
      active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,code)
    );
    CREATE TABLE IF NOT EXISTS hr_leave_requests (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      employee_id text NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE, leave_type_id text NOT NULL REFERENCES hr_leave_types(id) ON DELETE RESTRICT,
      starts_on date NOT NULL, ends_on date NOT NULL, days_micros bigint NOT NULL CHECK(days_micros >= 0), reason text,
      status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
      requested_by text REFERENCES users(id) ON DELETE SET NULL, reviewed_by text REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at timestamptz, review_notes text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CHECK(ends_on >= starts_on)
    );
    CREATE INDEX IF NOT EXISTS hr_leave_org_status_idx ON hr_leave_requests(organization_id,status,starts_on);
    CREATE TABLE IF NOT EXISTS hr_onboarding_tasks (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      employee_id text NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE, title text NOT NULL, due_date date,
      status text NOT NULL DEFAULT 'pending', assigned_user_id text REFERENCES users(id) ON DELETE SET NULL, completed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS hr_mobile_leave_intents (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      device_id text REFERENCES mobile_sync_devices(id) ON DELETE SET NULL, employee_id text NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
      leave_type_id text NOT NULL REFERENCES hr_leave_types(id) ON DELETE RESTRICT, starts_on date NOT NULL, ends_on date NOT NULL,
      days_micros bigint NOT NULL CHECK(days_micros >= 0), reason text, requested_by text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      client_created_at timestamptz NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','applied','rejected')),
      server_leave_request_id text, error_message text, applied_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(), attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
      last_attempt_at timestamptz, next_attempt_at timestamptz, CHECK(ends_on >= starts_on)
    );
    CREATE INDEX IF NOT EXISTS hr_mobile_leave_retry_idx ON hr_mobile_leave_intents(status,next_attempt_at,created_at);
    CREATE TABLE IF NOT EXISTS hr_mobile_onboarding_intents (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      device_id text REFERENCES mobile_sync_devices(id) ON DELETE SET NULL, task_id text NOT NULL REFERENCES hr_onboarding_tasks(id) ON DELETE CASCADE,
      completed_by text NOT NULL REFERENCES users(id) ON DELETE RESTRICT, client_completed_at timestamptz NOT NULL,
      status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied','rejected')), error_message text, applied_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
      last_attempt_at timestamptz, next_attempt_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS hr_mobile_onboarding_retry_idx ON hr_mobile_onboarding_intents(status,next_attempt_at,created_at);
  `);
}
