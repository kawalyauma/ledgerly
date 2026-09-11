export async function ensureModuleRegistrySchema(database) {
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
    CREATE INDEX IF NOT EXISTS app_modules_active_idx ON app_modules(active,category,module_key);

    CREATE TABLE IF NOT EXISTS organization_modules (
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      module_key text NOT NULL REFERENCES app_modules(module_key) ON DELETE CASCADE,
      enabled boolean NOT NULL DEFAULT false,
      configuration_json text NOT NULL DEFAULT '{}',
      enabled_by text REFERENCES users(id) ON DELETE SET NULL,
      enabled_at timestamptz,
      disabled_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(organization_id,module_key)
    );
    CREATE INDEX IF NOT EXISTS organization_modules_enabled_idx ON organization_modules(organization_id,enabled,module_key);
  `);
}
