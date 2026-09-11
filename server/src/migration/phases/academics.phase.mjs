import attendance from "./attendance.phase.mjs";
import { ACADEMICS_TABLES } from "../academics-manifest.mjs";
import { ensureAcademicsSchema, finalizeAcademicsSchema } from "../academics-schema.mjs";
import { ACADEMICS_RELATIONSHIP_CHECKS } from "../academics-validators.mjs";

export default {
  name: "academics",
  description: "Scheduling, schemes of work, lesson planning/delivery, resources and academic supervision",
  prerequisites: ["auth-core", "school-reference", "school-configuration", "school-people", "school-staff", "attendance"],
  tables: ACADEMICS_TABLES,
  ensureSchema: async (database) => {
    await attendance.ensureSchema(database);
    await ensureAcademicsSchema(database);
  },
  finalizeSchema: finalizeAcademicsSchema,
  relationshipChecks: ACADEMICS_RELATIONSHIP_CHECKS,
};
