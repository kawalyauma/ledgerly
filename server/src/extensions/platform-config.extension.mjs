import { PostgresPlatformConfigRepository } from "../platform-config/repository.mjs";
import { PlatformConfigService } from "../platform-config/service.mjs";

export default {
  name: "platform-config",
  required: false,
  configure(env) {
    return { enabled: String(env.SELFHOST_PLATFORM_CONFIG_ENABLED ?? "").toLowerCase() === "true" };
  },
  enabled(config) {
    return config.enabled === true;
  },
  async create({ services }) {
    const repository = new PostgresPlatformConfigRepository({ database: services.database });
    await repository.ensureSchema();
    const service = new PlatformConfigService({ repository, audit: services.audit });
    return {
      value: Object.freeze({ repository, service }),
      readiness: async () => {
        const result = await services.database.query(`
          SELECT
            to_regclass('public.app_modules') IS NOT NULL AS catalog,
            to_regclass('public.organization_modules') IS NOT NULL AS modules,
            to_regclass('public.platform_feature_overrides') IS NOT NULL AS features
        `);
        return {
          ok: result.rows[0]?.catalog === true && result.rows[0]?.modules === true && result.rows[0]?.features === true,
          provider: "postgresql-platform-config",
        };
      },
      describe() {
        return {
          provider: "postgresql-platform-config",
          canonicalCatalog: "app_modules migrated from modules/catalog.generated.ts/D1",
          tenantModuleTable: "organization_modules",
          featureOverrides: true,
          cloudflareFallbackPreserved: true,
        };
      },
    };
  },
};
