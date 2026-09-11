export class PostgresPlatformConfigRepository {
  constructor({ database }) {
    if (!database?.query) throw new TypeError("platform config repository requires database");
    this.database = database;
  }

  async ensureSchema() {
    await this.database.query(`
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

      CREATE TABLE IF NOT EXISTS platform_feature_overrides (
        organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        module_key text NOT NULL,
        feature_key text NOT NULL,
        enabled boolean NOT NULL,
        config_json text NOT NULL DEFAULT '{}',
        version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
        updated_by text REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (organization_id, module_key, feature_key)
      );
      CREATE INDEX IF NOT EXISTS platform_feature_overrides_org_module_idx
        ON platform_feature_overrides (organization_id, module_key, feature_key);
    `);
  }

  async listModules(organizationId) {
    return (await this.database.query(`
      SELECT organization_id,module_key,enabled,
             configuration_json AS settings_json,
             config_version AS version,
             enabled_by AS updated_by,
             enabled_at,disabled_at,created_at,updated_at
      FROM organization_modules
      WHERE organization_id=$1
      ORDER BY module_key
    `, [organizationId])).rows;
  }

  async getModule(organizationId, moduleKey) {
    return (await this.database.query(`
      SELECT organization_id,module_key,enabled,
             configuration_json AS settings_json,
             config_version AS version,
             enabled_by AS updated_by,
             enabled_at,disabled_at,created_at,updated_at
      FROM organization_modules
      WHERE organization_id=$1 AND module_key=$2
    `, [organizationId, moduleKey])).rows[0] ?? null;
  }

  async setModule({ organizationId, moduleKey, enabled, settingsJson, updatedBy, expectedVersion = 0 }) {
    const expected = Number(expectedVersion) || 0;
    const known = await this.database.query(
      `SELECT module_key FROM app_modules WHERE module_key=$1 AND active=true`,
      [moduleKey],
    );
    if (!known.rows[0]) {
      throw Object.assign(new Error("unknown or inactive module key"), {
        code: "PLATFORM_MODULE_UNKNOWN",
        status: 404,
      });
    }

    if (expected === 0) {
      const result = await this.database.query(`
        INSERT INTO organization_modules
          (organization_id,module_key,enabled,configuration_json,enabled_by,enabled_at,disabled_at,config_version,created_at,updated_at)
        VALUES
          ($1,$2,$3,$4,$5,CASE WHEN $3 THEN now() ELSE NULL END,CASE WHEN $3 THEN NULL ELSE now() END,1,now(),now())
        ON CONFLICT (organization_id,module_key) DO NOTHING
        RETURNING *,configuration_json AS settings_json,config_version AS version,enabled_by AS updated_by
      `, [organizationId, moduleKey, enabled, settingsJson, updatedBy]);
      if (result.rows[0]) return result.rows[0];
    } else {
      const result = await this.database.query(`
        UPDATE organization_modules
        SET enabled=$3,
            configuration_json=$4,
            enabled_by=$5,
            enabled_at=CASE WHEN $3 THEN COALESCE(enabled_at,now()) ELSE enabled_at END,
            disabled_at=CASE WHEN $3 THEN NULL ELSE now() END,
            config_version=config_version+1,
            updated_at=now()
        WHERE organization_id=$1 AND module_key=$2 AND config_version=$6
        RETURNING *,configuration_json AS settings_json,config_version AS version,enabled_by AS updated_by
      `, [organizationId, moduleKey, enabled, settingsJson, updatedBy, expected]);
      if (result.rows[0]) return result.rows[0];
    }

    const current = await this.getModule(organizationId, moduleKey);
    throw Object.assign(new Error("module override version conflict"), {
      code: "PLATFORM_CONFIG_VERSION_CONFLICT",
      status: 409,
      current,
    });
  }

  async clearModule({ organizationId, moduleKey, expectedVersion }) {
    const result = await this.database.query(`
      DELETE FROM organization_modules
      WHERE organization_id=$1 AND module_key=$2 AND config_version=$3
      RETURNING *,configuration_json AS settings_json,config_version AS version,enabled_by AS updated_by
    `, [organizationId, moduleKey, Number(expectedVersion)]);
    if (result.rows[0]) return result.rows[0];
    const current = await this.getModule(organizationId, moduleKey);
    if (!current) return null;
    throw Object.assign(new Error("module override version conflict"), {
      code: "PLATFORM_CONFIG_VERSION_CONFLICT",
      status: 409,
      current,
    });
  }

  async listFeatures({ organizationId, moduleKey = null }) {
    const values = [organizationId];
    let filter = "";
    if (moduleKey) {
      values.push(moduleKey);
      filter = " AND module_key=$2";
    }
    return (await this.database.query(`
      SELECT organization_id,module_key,feature_key,enabled,config_json,version,updated_by,created_at,updated_at
      FROM platform_feature_overrides
      WHERE organization_id=$1${filter}
      ORDER BY module_key,feature_key
    `, values)).rows;
  }

  async getFeature(organizationId, moduleKey, featureKey) {
    return (await this.database.query(`
      SELECT organization_id,module_key,feature_key,enabled,config_json,version,updated_by,created_at,updated_at
      FROM platform_feature_overrides
      WHERE organization_id=$1 AND module_key=$2 AND feature_key=$3
    `, [organizationId, moduleKey, featureKey])).rows[0] ?? null;
  }

  async setFeature({ organizationId, moduleKey, featureKey, enabled, configJson, updatedBy, expectedVersion = 0 }) {
    const expected = Number(expectedVersion) || 0;
    if (expected === 0) {
      const result = await this.database.query(`
        INSERT INTO platform_feature_overrides
          (organization_id,module_key,feature_key,enabled,config_json,version,updated_by,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,1,$6,now(),now())
        ON CONFLICT (organization_id,module_key,feature_key) DO NOTHING
        RETURNING *
      `, [organizationId, moduleKey, featureKey, enabled, configJson, updatedBy]);
      if (result.rows[0]) return result.rows[0];
    } else {
      const result = await this.database.query(`
        UPDATE platform_feature_overrides
        SET enabled=$4,config_json=$5,version=version+1,updated_by=$6,updated_at=now()
        WHERE organization_id=$1 AND module_key=$2 AND feature_key=$3 AND version=$7
        RETURNING *
      `, [organizationId, moduleKey, featureKey, enabled, configJson, updatedBy, expected]);
      if (result.rows[0]) return result.rows[0];
    }
    const current = await this.getFeature(organizationId, moduleKey, featureKey);
    throw Object.assign(new Error("feature override version conflict"), {
      code: "PLATFORM_CONFIG_VERSION_CONFLICT",
      status: 409,
      current,
    });
  }

  async clearFeature({ organizationId, moduleKey, featureKey, expectedVersion }) {
    const result = await this.database.query(`
      DELETE FROM platform_feature_overrides
      WHERE organization_id=$1 AND module_key=$2 AND feature_key=$3 AND version=$4
      RETURNING *
    `, [organizationId, moduleKey, featureKey, Number(expectedVersion)]);
    if (result.rows[0]) return result.rows[0];
    const current = await this.getFeature(organizationId, moduleKey, featureKey);
    if (!current) return null;
    throw Object.assign(new Error("feature override version conflict"), {
      code: "PLATFORM_CONFIG_VERSION_CONFLICT",
      status: 409,
      current,
    });
  }
}
