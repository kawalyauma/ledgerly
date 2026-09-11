export async function ensurePlatformRegistrySchema(database) {
  await database.query(`
    CREATE TABLE IF NOT EXISTS app_modules (
      module_key text PRIMARY KEY,
      name text NOT NULL,
      version text NOT NULL,
      description text,
      category text NOT NULL DEFAULT 'business',
      core boolean NOT NULL DEFAULT false,
      manifest_json text NOT NULL DEFAULT '{}',
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS organization_modules (
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      module_key text NOT NULL REFERENCES app_modules(module_key) ON DELETE CASCADE,
      enabled boolean NOT NULL DEFAULT false,
      configuration_json text NOT NULL DEFAULT '{}',
      enabled_by text REFERENCES users(id) ON DELETE SET NULL,
      enabled_at timestamptz,
      disabled_at timestamptz,
      config_version bigint NOT NULL DEFAULT 1 CHECK (config_version >= 1),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (organization_id, module_key)
    );

    ALTER TABLE organization_modules
      ADD COLUMN IF NOT EXISTS config_version bigint NOT NULL DEFAULT 1;
  `);
}
