import configuration from "./school-configuration.phase.mjs";
import { SCHOOL_STAFF_TABLES } from "../school-data-manifest.mjs";
import { ensureSchoolStaffSchema, finalizeSchoolStaffSchema } from "../school-data-schema.mjs";
import { SCHOOL_STAFF_RELATIONSHIP_CHECKS } from "../school-data-validators.mjs";

export default {
  name: "school-staff",
  description: "Staff and teacher identity, positions, qualifications, files and teaching assignments without payroll postings",
  prerequisites: ["auth-core", "school-reference", "school-configuration", "contacts"],
  tables: SCHOOL_STAFF_TABLES,
  ensureSchema: async (database) => {
    await configuration.ensureSchema(database);
    await ensureSchoolStaffSchema(database);
  },
  finalizeSchema: finalizeSchoolStaffSchema,
  relationshipChecks: SCHOOL_STAFF_RELATIONSHIP_CHECKS,
};
