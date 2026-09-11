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
  },
  finalizeSchema: finalizeSchoolReferenceSchema,
  relationshipChecks: SCHOOL_REFERENCE_RELATIONSHIP_CHECKS,
};
