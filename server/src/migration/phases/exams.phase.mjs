import { EXAMS_TABLES } from "../exams-manifest.mjs";
import { ensureExamsSchema } from "../exams-schema.mjs";
import { EXAMS_RELATIONSHIP_CHECKS } from "../exams-validators.mjs";

export default {
  name: "exams",
  description: "Standalone examinations, marks, grading and report-card records",
  prerequisites: ["auth-core", "school-reference", "school-people"],
  tables: EXAMS_TABLES,
  ensureSchema: ensureExamsSchema,
  finalizeSchema: null,
  relationshipChecks: EXAMS_RELATIONSHIP_CHECKS,
};
