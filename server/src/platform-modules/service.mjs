function fail(status, code, message, details = undefined) {
  throw Object.assign(new Error(message), { status, code, ...(details === undefined ? {} : { details }) });
}

function parseJson(value, fallback = {}) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function moduleDependencies(module) {
  const manifest = parseJson(module?.manifest_json ?? module?.manifestJson, {});
  const raw = Array.isArray(manifest.requiresModules)
    ? manifest.requiresModules
    : Array.isArray(manifest.requiresDataFrom)
      ? manifest.requiresDataFrom
      : [];
  return [...new Set(raw.map(String).map((value) => value.trim()).filter(Boolean))];
}

export class PlatformModulesService {
  constructor({ database, audit = null }) {
    if (!database || typeof database.query !== "function" || typeof database.transaction !== "function") {
      throw new TypeError("PlatformModulesService requires database query/transaction support");
    }
    this.database = database;
    this.audit = audit;
    this.provider = "postgresql-module-registry";
  }

  describe() {
    return { provider: this.provider, authoritativeStore: "postgresql" };
  }

  async readiness() {
    try {
      const result = await this.database.query(
        "SELECT to_regclass('public.app_modules') AS modules, to_regclass('public.organization_modules') AS organization_modules",
      );
      const row = result.rows[0] ?? {};
      const missing = Object.entries(row).filter(([, value]) => !value).map(([key]) => key);
      return { ok: missing.length === 0, provider: this.provider, missing };
    } catch (error) {
      return { ok: false, provider: this.provider, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async enabled(organizationId) {
    const result = await this.database.query(
      `SELECT m.module_key AS "moduleKey",m.name,m.version,m.category,m.core
       FROM app_modules m
       LEFT JOIN organization_modules om ON om.module_key=m.module_key AND om.organization_id=$1
       WHERE m.active=true AND (m.core=true OR om.enabled=true)
       ORDER BY m.core DESC,m.name`,
      [organizationId],
    );
    return result.rows.map((row) => ({ ...row, core: Boolean(row.core) }));
  }

  async list(organizationId) {
    const result = await this.database.query(
      `SELECT m.module_key AS "moduleKey",m.name,m.version,m.description,m.category,m.core,
              m.manifest_json AS "manifestJson",m.active,
              COALESCE(om.enabled,m.core) AS enabled,
              om.configuration_json AS "configurationJson",om.enabled_at AS "enabledAt",om.disabled_at AS "disabledAt"
       FROM app_modules m
       LEFT JOIN organization_modules om ON om.module_key=m.module_key AND om.organization_id=$1
       WHERE m.active=true
       ORDER BY m.core DESC,m.name`,
      [organizationId],
    );
    return result.rows.map((row) => ({
      ...row,
      core: Boolean(row.core),
      active: Boolean(row.active),
      enabled: Boolean(row.enabled),
      manifest: parseJson(row.manifestJson, {}),
      configuration: parseJson(row.configurationJson, {}),
    }));
  }

  async isEnabled(organizationId, key) {
    const result = await this.database.query(
      `SELECT m.core,COALESCE(om.enabled,false) AS enabled
       FROM app_modules m
       LEFT JOIN organization_modules om ON om.module_key=m.module_key AND om.organization_id=$1
       WHERE m.module_key=$2 AND m.active=true`,
      [organizationId, key],
    );
    const row = result.rows[0];
    return Boolean(row && (row.core || row.enabled));
  }

  async requireEnabled(organizationId, key) {
    if (!await this.isEnabled(organizationId, key)) fail(404, "MODULE_DISABLED", `${key} is not enabled for this organization`);
  }

  async enable({ organizationId, userId, key, configuration = {}, requestId = null }) {
    const moduleResult = await this.database.query(
      "SELECT module_key,name,core,active,manifest_json FROM app_modules WHERE module_key=$1",
      [key],
    );
    const module = moduleResult.rows[0];
    if (!module || !module.active) fail(404, "MODULE_NOT_FOUND", "Module not found");

    const missing = [];
    for (const dependency of moduleDependencies(module)) {
      if (!await this.isEnabled(organizationId, dependency)) missing.push(dependency);
    }
    if (missing.length) {
      fail(409, "MODULE_DEPENDENCY_REQUIRED", `${module.name || key} requires ${missing.join(", ")} to be enabled first.`, { requiresModules: missing });
    }

    await this.database.query(
      `INSERT INTO organization_modules (organization_id,module_key,enabled,configuration_json,enabled_by,enabled_at,disabled_at)
       VALUES ($1,$2,true,$3,$4,CURRENT_TIMESTAMP,NULL)
       ON CONFLICT(organization_id,module_key) DO UPDATE SET
         enabled=true,configuration_json=EXCLUDED.configuration_json,enabled_by=EXCLUDED.enabled_by,
         enabled_at=CURRENT_TIMESTAMP,disabled_at=NULL,updated_at=CURRENT_TIMESTAMP`,
      [organizationId, key, JSON.stringify(configuration ?? {}), userId],
    );
    await this.audit?.write({
      organizationId, actorType: "human", actorId: userId, action: "module.enabled",
      entityType: "module", entityId: key, after: { configuration }, requestId,
    });
    return { moduleKey: key, enabled: true, configuration };
  }

  async disable({ organizationId, userId, key, requestId = null }) {
    const moduleResult = await this.database.query(
      "SELECT module_key,name,core,active FROM app_modules WHERE module_key=$1",
      [key],
    );
    const module = moduleResult.rows[0];
    if (!module) fail(404, "MODULE_NOT_FOUND", "Module not found");
    if (module.core) fail(409, "CORE_MODULE", "Core modules cannot be disabled");

    const enabledModules = await this.database.query(
      `SELECT m.module_key,m.name,m.manifest_json
       FROM app_modules m JOIN organization_modules om ON om.module_key=m.module_key
       WHERE om.organization_id=$1 AND om.enabled=true AND m.active=true`,
      [organizationId],
    );
    const dependents = enabledModules.rows
      .filter((candidate) => candidate.module_key !== key && moduleDependencies(candidate).includes(key))
      .map((candidate) => candidate.name || candidate.module_key);
    if (dependents.length) {
      fail(409, "MODULE_IN_USE", `Disable ${dependents.join(", ")} before disabling ${module.name || key}.`, { dependentModules: dependents });
    }

    await this.database.query(
      `UPDATE organization_modules SET enabled=false,disabled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
       WHERE organization_id=$1 AND module_key=$2`,
      [organizationId, key],
    );
    await this.audit?.write({
      organizationId, actorType: "human", actorId: userId, action: "module.disabled",
      entityType: "module", entityId: key, requestId,
    });
    return { moduleKey: key, enabled: false };
  }
}

export function createPlatformModulesService(input) { return new PlatformModulesService(input); }
