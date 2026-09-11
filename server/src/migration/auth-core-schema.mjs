export async function ensureAuthCoreSchema(database) {
  await database.query(`
    CREATE TABLE IF NOT EXISTS organizations (
      id text PRIMARY KEY,
      name text NOT NULL,
      legal_name text,
      base_currency text NOT NULL DEFAULT 'UGX',
      timezone text NOT NULL DEFAULT 'Africa/Kampala',
      fiscal_year_start_month integer NOT NULL DEFAULT 1,
      status text NOT NULL DEFAULT 'active',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      branding_json text NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS users (
      id text PRIMARY KEY,
      email text NOT NULL UNIQUE,
      display_name text NOT NULL,
      password_hash text,
      status text NOT NULL DEFAULT 'active',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      email_verified_at timestamptz
    );

    CREATE TABLE IF NOT EXISTS memberships (
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role text NOT NULL,
      scopes text NOT NULL DEFAULT '[]',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (organization_id,user_id)
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      code text NOT NULL,
      name text NOT NULL,
      type text NOT NULL,
      subtype text,
      normal_balance text NOT NULL,
      currency text,
      allow_posting boolean NOT NULL DEFAULT true,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (organization_id,code)
    );
    CREATE INDEX IF NOT EXISTS accounts_org_type_idx ON accounts (organization_id,type);

    CREATE TABLE IF NOT EXISTS api_keys (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name text NOT NULL,
      prefix text NOT NULL,
      key_hash text NOT NULL UNIQUE,
      scopes text NOT NULL DEFAULT '[]',
      expires_at timestamptz,
      last_used_at timestamptz,
      revoked_at timestamptz,
      created_by text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS api_keys_org_idx ON api_keys (organization_id);

    CREATE TABLE IF NOT EXISTS sessions (
      id text PRIMARY KEY,
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      refresh_token_hash text NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz,
      ip_address text,
      user_agent text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id,expires_at);

    CREATE TABLE IF NOT EXISTS school_user_profiles (
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username text,
      phone text,
      profile_photo_url text,
      signature_url text,
      staff_number text,
      status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','suspended','locked')),
      force_password_change boolean NOT NULL DEFAULT false,
      failed_login_count integer NOT NULL DEFAULT 0,
      locked_until timestamptz,
      last_login_at timestamptz,
      notification_preferences_json text NOT NULL DEFAULT '{}',
      recovery_json text NOT NULL DEFAULT '{}',
      security_json text NOT NULL DEFAULT '{}',
      created_by text REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (organization_id,user_id),
      UNIQUE (organization_id,username),
      UNIQUE (organization_id,phone),
      UNIQUE (organization_id,staff_number)
    );

    CREATE TABLE IF NOT EXISTS school_login_aliases (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      alias_type text NOT NULL CHECK (alias_type IN ('username','phone')),
      alias_normalized text NOT NULL,
      verified_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (organization_id,alias_type,alias_normalized)
    );
    CREATE INDEX IF NOT EXISTS school_login_alias_user_idx ON school_login_aliases (user_id,organization_id);

    CREATE TABLE IF NOT EXISTS school_user_mfa (
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      method text NOT NULL DEFAULT 'totp' CHECK (method IN ('totp')),
      secret_encrypted text NOT NULL,
      recovery_code_hashes_json text NOT NULL DEFAULT '[]',
      enabled boolean NOT NULL DEFAULT false,
      verified_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (organization_id,user_id,method)
    );

    CREATE TABLE IF NOT EXISTS school_login_events (
      id text PRIMARY KEY,
      organization_id text REFERENCES organizations(id) ON DELETE CASCADE,
      user_id text REFERENCES users(id) ON DELETE SET NULL,
      identifier text,
      event_type text NOT NULL CHECK (event_type IN ('success','failure','logout','lock','unlock','password_change','password_reset')),
      ip_address text,
      user_agent text,
      device_json text NOT NULL DEFAULT '{}',
      reason text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS school_login_events_user_idx ON school_login_events (organization_id,user_id,created_at);
  `);
}
