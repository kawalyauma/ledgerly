import { ensureAuthCoreSchema } from "../auth-core-schema.mjs";
import { ensureSchoolReferenceSchema } from "../school-reference-schema.mjs";
import { SCHOOL_CONFIGURATION_TABLES } from "../school-data-manifest.mjs";
import { ensureSchoolConfigurationSchema, finalizeSchoolConfigurationSchema } from "../school-data-schema.mjs";
import { SCHOOL_CONFIGURATION_RELATIONSHIP_CHECKS } from "../school-data-validators.mjs";
import { SCHOOL_FEE_REFERENCE_TABLES } from "../school-fee-reference-manifest.mjs";
import { ensureSchoolFeeReferenceSchema } from "../school-fee-reference-schema.mjs";
import { SCHOOL_FEE_REFERENCE_RELATIONSHIP_CHECKS } from "../school-fee-reference-validators.mjs";
import { MODULE_REGISTRY_TABLES } from "../module-registry-manifest.mjs";
import { ensureModuleRegistrySchema } from "../module-registry-schema.mjs";
import { MODULE_REGISTRY_RELATIONSHIP_CHECKS } from "../module-registry-validators.mjs";

async function ensureSchema(database) {
  await ensureAuthCoreSchema(database);
  await ensureSchoolReferenceSchema(database);
  await database.query(`ALTER TABLE school_profiles ADD COLUMN IF NOT EXISTS logo_file_id text`);
  await ensureSchoolConfigurationSchema(database);
  await ensureSchoolFeeReferenceSchema(database);
  await ensureModuleRegistrySchema(database);
}

export default {
  name: "school-configuration",
  description: "School grading, calendar, fee/payment references, settings, templates, module registry, files and school-scoped IAM",
  prerequisites: ["auth-core", "school-reference"],
  tables: [...SCHOOL_CONFIGURATION_TABLES, ...SCHOOL_FEE_REFERENCE_TABLES, ...MODULE_REGISTRY_TABLES],
  ensureSchema,
  finalizeSchema: finalizeSchoolConfigurationSchema,
  relationshipChecks: [...SCHOOL_CONFIGURATION_RELATIONSHIP_CHECKS, ...SCHOOL_FEE_REFERENCE_RELATIONSHIP_CHECKS, ...MODULE_REGISTRY_RELATIONSHIP_CHECKS],
};
