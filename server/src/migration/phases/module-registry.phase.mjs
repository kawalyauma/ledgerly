import { ensureAuthCoreSchema } from "../auth-core-schema.mjs";
import { MODULE_REGISTRY_TABLES } from "../module-registry-manifest.mjs";
import { ensureModuleRegistrySchema } from "../module-registry-schema.mjs";
import { MODULE_REGISTRY_RELATIONSHIP_CHECKS } from "../module-registry-validators.mjs";

export default {
  name: "module-registry",
  description: "Application module catalog and organization module enablement/configuration",
  prerequisites: ["auth-core"],
  tables: MODULE_REGISTRY_TABLES,
  ensureSchema: async (database) => {
    await ensureAuthCoreSchema(database);
    await ensureModuleRegistrySchema(database);
  },
  finalizeSchema: null,
  relationshipChecks: MODULE_REGISTRY_RELATIONSHIP_CHECKS,
};
