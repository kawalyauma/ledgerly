import { ensureAuthCoreSchema } from "../auth-core-schema.mjs";
import { ensureSchoolReferenceSchema } from "../school-reference-schema.mjs";
import { EXAMS_TABLES } from "../exams-manifest.mjs";
import { ensureExamStudentCompatibilitySchema } from "../exams-student-schema.mjs";
import { ensureExamsSchema } from "../exams-schema.mjs";
import { EXAMS_RELATIONSHIP_CHECKS } from "../exams-validators.mjs";

export default {
  name: "exams",
  description: "Standalone examinations, marks, grading and report-card records",
  prerequisites: ["auth-core", "school-reference"],
  tables: EXAMS_TABLES,
  ensureSchema: async (database) => {
    await ensureAuthCoreSchema(database);
    await ensureSchoolReferenceSchema(database);
    await ensureExamStudentCompatibilitySchema(database);
    await ensureExamsSchema(database);
  },
  finalizeSchema: null,
  relationshipChecks: EXAMS_RELATIONSHIP_CHECKS,
};
