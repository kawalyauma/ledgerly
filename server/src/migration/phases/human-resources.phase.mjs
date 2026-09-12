import { HUMAN_RESOURCES_TABLES } from "../human-resources-manifest.mjs";
import { ensureHumanResourcesSchema } from "../human-resources-schema.mjs";
import { HUMAN_RESOURCES_RELATIONSHIP_CHECKS } from "../shared-validators.mjs";

export default {
  name: "human-resources",
  description: "Non-payroll HR employment, leave, onboarding and retry-safe mobile intents",
  prerequisites: ["auth-core", "module-registry", "mobile-sync-core", "contacts"],
  tables: HUMAN_RESOURCES_TABLES,
  ensureSchema: ensureHumanResourcesSchema,
  finalizeSchema: null,
  relationshipChecks: HUMAN_RESOURCES_RELATIONSHIP_CHECKS,
};
