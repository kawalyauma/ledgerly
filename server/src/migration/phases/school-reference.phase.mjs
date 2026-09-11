import { ensureAuthCoreSchema } from "../auth-core-schema.mjs";
import { SCHOOL_REFERENCE_TABLES } from "../school-reference-manifest.mjs";
import { ensureSchoolReferenceSchema, finalizeSchoolReferenceSchema } from "../school-reference-schema.mjs";
import { SCHOOL_REFERENCE_RELATIONSHIP_CHECKS } from "../school-reference-validators.mjs";

export default {
  name: "school-reference",
  description: "School profile and academic reference graph used by dynamic year/term/class/subject selection",
  prerequisites: ["auth-core"],
  tables: SCHOOL_REFERENCE_TABLES,
  ensureSchema: async (database) => {
    await ensureAuthCoreSchema(database);
    await ensureSchoolReferenceSchema(database);
    // D1 0010 extends the profile after the original school-reference DDL.
    await database.query(`ALTER TABLE school_profiles ADD COLUMN IF NOT EXISTS logo_file_id text`);
  },
  finalizeSchema: finalizeSchoolReferenceSchema,
  relationshipChecks: SCHOOL_REFERENCE_RELATIONSHIP_CHECKS,
};
