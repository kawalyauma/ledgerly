import { ensureAuthCoreSchema } from "../auth-core-schema.mjs";
import { ensureSchoolReferenceSchema } from "../school-reference-schema.mjs";
import { SCHOOL_CONFIGURATION_TABLES } from "../school-data-manifest.mjs";
import { ensureSchoolConfigurationSchema, finalizeSchoolConfigurationSchema } from "../school-data-schema.mjs";
import { SCHOOL_CONFIGURATION_RELATIONSHIP_CHECKS } from "../school-data-validators.mjs";
import { SCHOOL_FEE_REFERENCE_TABLES } from "../school-fee-reference-manifest.mjs";
import { ensureSchoolFeeReferenceSchema } from "../school-fee-reference-schema.mjs";
import { SCHOOL_FEE_REFERENCE_RELATIONSHIP_CHECKS } from "../school-fee-reference-validators.mjs";

const SCHOOL_CONFIGURATION_PHASE_TABLES = Object.freeze(
  SCHOOL_CONFIGURATION_TABLES.filter((table) => table.name !== "school_user_profiles"),
);

async function ensureSchema(database) {
  await ensureAuthCoreSchema(database);
  await ensureSchoolReferenceSchema(database);
  await database.query(`ALTER TABLE school_profiles ADD COLUMN IF NOT EXISTS logo_file_id text`);
  await ensureSchoolConfigurationSchema(database);
  await ensureSchoolFeeReferenceSchema(database);
}

export default {
  name: "school-configuration",
  description: "School grading, calendar, fee/payment references, settings, templates, files and school-scoped IAM not owned by auth-core",
  prerequisites: ["auth-core", "module-registry", "school-reference"],
  tables: [...SCHOOL_CONFIGURATION_PHASE_TABLES, ...SCHOOL_FEE_REFERENCE_TABLES],
  ensureSchema,
  finalizeSchema: finalizeSchoolConfigurationSchema,
  relationshipChecks: [...SCHOOL_CONFIGURATION_RELATIONSHIP_CHECKS, ...SCHOOL_FEE_REFERENCE_RELATIONSHIP_CHECKS],
};
