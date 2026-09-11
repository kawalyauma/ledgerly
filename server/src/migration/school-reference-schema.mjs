export async function ensureSchoolReferenceSchema(database) {
  await database.query(`
    CREATE TABLE IF NOT EXISTS school_profiles (
      organization_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
      school_code text NOT NULL UNIQUE,
      registration_number text,
      logo_url text,
      motto text,
      school_type text NOT NULL DEFAULT 'day',
      ownership_type text,
      education_level text,
      curriculum text,
      phone_numbers_json text NOT NULL DEFAULT '[]',
      email_addresses_json text NOT NULL DEFAULT '[]',
      website text,
      physical_address text,
      postal_address text,
      country text NOT NULL DEFAULT 'Uganda',
      district_region text,
      location_text text,
      head_teacher_name text,
      head_teacher_phone text,
      head_teacher_email text,
      language text NOT NULL DEFAULT 'en',
      timezone text NOT NULL DEFAULT 'Africa/Kampala',
      date_format text NOT NULL DEFAULT 'DD/MM/YYYY',
      time_format text NOT NULL DEFAULT '24h',
      default_currency text NOT NULL DEFAULT 'UGX',
      multi_campus_enabled boolean NOT NULL DEFAULT false,
      branding_json text NOT NULL DEFAULT '{}',
      system_preferences_json text NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS school_branches (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      code text NOT NULL,
      name text NOT NULL,
      registration_number text,
      phone text,
      email text,
      physical_address text,
      postal_address text,
      district_region text,
      location_text text,
      principal_name text,
      is_main boolean NOT NULL DEFAULT false,
      active boolean NOT NULL DEFAULT true,
      metadata_json text NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(organization_id,code)
    );
    CREATE INDEX IF NOT EXISTS school_branches_org_idx ON school_branches (organization_id,active,name);

    CREATE TABLE IF NOT EXISTS school_academic_years (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      code text NOT NULL,
      name text NOT NULL,
      starts_on date NOT NULL,
      ends_on date NOT NULL,
      status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','active','closed','archived')),
      is_current boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (starts_on <= ends_on),
      UNIQUE(organization_id,code)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS school_academic_year_current_uq ON school_academic_years (organization_id) WHERE is_current=true;
    CREATE INDEX IF NOT EXISTS school_academic_year_dates_idx ON school_academic_years (organization_id,starts_on,ends_on);

    CREATE TABLE IF NOT EXISTS school_terms (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      academic_year_id text NOT NULL REFERENCES school_academic_years(id) ON DELETE CASCADE,
      code text NOT NULL,
      name text NOT NULL,
      sequence_no integer NOT NULL,
      starts_on date NOT NULL,
      ends_on date NOT NULL,
      status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','active','closed','archived')),
      is_current boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (starts_on <= ends_on),
      UNIQUE(organization_id,academic_year_id,code),
      UNIQUE(organization_id,academic_year_id,sequence_no)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS school_term_current_uq ON school_terms (organization_id) WHERE is_current=true;
    CREATE INDEX IF NOT EXISTS school_terms_year_idx ON school_terms (organization_id,academic_year_id,starts_on);

    CREATE TABLE IF NOT EXISTS school_departments (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      campus_id text REFERENCES school_branches(id) ON DELETE SET NULL,
      code text NOT NULL,
      name text NOT NULL,
      description text,
      head_user_id text REFERENCES users(id) ON DELETE SET NULL,
      parent_id text,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(organization_id,code)
    );

    CREATE TABLE IF NOT EXISTS school_class_levels (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      code text NOT NULL,
      name text NOT NULL,
      sequence_no integer NOT NULL,
      education_level text,
      promotion_level_id text,
      terminal boolean NOT NULL DEFAULT false,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(organization_id,code),
      UNIQUE(organization_id,sequence_no)
    );

    CREATE TABLE IF NOT EXISTS school_classes (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      academic_year_id text REFERENCES school_academic_years(id) ON DELETE SET NULL,
      campus_id text REFERENCES school_branches(id) ON DELETE SET NULL,
      class_level_id text NOT NULL REFERENCES school_class_levels(id) ON DELETE RESTRICT,
      department_id text REFERENCES school_departments(id) ON DELETE SET NULL,
      code text NOT NULL,
      name text NOT NULL,
      capacity integer,
      class_teacher_user_id text REFERENCES users(id) ON DELETE SET NULL,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(organization_id,academic_year_id,code)
    );
    CREATE INDEX IF NOT EXISTS school_classes_level_idx ON school_classes (organization_id,class_level_id,academic_year_id);

    CREATE TABLE IF NOT EXISTS school_streams (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      class_id text NOT NULL REFERENCES school_classes(id) ON DELETE CASCADE,
      campus_id text REFERENCES school_branches(id) ON DELETE SET NULL,
      code text NOT NULL,
      name text NOT NULL,
      capacity integer,
      class_teacher_user_id text REFERENCES users(id) ON DELETE SET NULL,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(organization_id,class_id,code)
    );

    CREATE TABLE IF NOT EXISTS school_subjects (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      department_id text REFERENCES school_departments(id) ON DELETE SET NULL,
      code text NOT NULL,
      name text NOT NULL,
      short_name text,
      subject_type text NOT NULL DEFAULT 'compulsory' CHECK (subject_type IN ('compulsory','optional','elective')),
      curriculum_code text,
      pass_mark double precision,
      max_mark double precision NOT NULL DEFAULT 100,
      active boolean NOT NULL DEFAULT true,
      metadata_json text NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(organization_id,code)
    );

    CREATE TABLE IF NOT EXISTS school_class_subjects (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      class_level_id text NOT NULL REFERENCES school_class_levels(id) ON DELETE CASCADE,
      subject_id text NOT NULL REFERENCES school_subjects(id) ON DELETE CASCADE,
      academic_year_id text REFERENCES school_academic_years(id) ON DELETE CASCADE,
      compulsory boolean NOT NULL DEFAULT true,
      periods_per_week integer,
      teacher_user_id text REFERENCES users(id) ON DELETE SET NULL,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(organization_id,class_level_id,subject_id,academic_year_id)
    );

    CREATE TABLE IF NOT EXISTS school_lesson_periods (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      campus_id text REFERENCES school_branches(id) ON DELETE CASCADE,
      code text NOT NULL,
      name text NOT NULL,
      sequence_no integer NOT NULL,
      starts_at text NOT NULL,
      ends_at text NOT NULL,
      period_type text NOT NULL DEFAULT 'lesson' CHECK (period_type IN ('lesson','break','lunch','assembly','other')),
      teaching_period boolean NOT NULL DEFAULT true,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(organization_id,campus_id,code)
    );
  `);
}

export async function finalizeSchoolReferenceSchema(database) {
  await database.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='school_departments_parent_fk') THEN
        ALTER TABLE school_departments ADD CONSTRAINT school_departments_parent_fk FOREIGN KEY (parent_id) REFERENCES school_departments(id) ON DELETE SET NULL;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='school_class_levels_promotion_fk') THEN
        ALTER TABLE school_class_levels ADD CONSTRAINT school_class_levels_promotion_fk FOREIGN KEY (promotion_level_id) REFERENCES school_class_levels(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);
}
