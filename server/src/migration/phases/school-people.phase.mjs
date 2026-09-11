import configuration from "./school-configuration.phase.mjs";
import { SCHOOL_PEOPLE_TABLES } from "../school-data-manifest.mjs";
import { ensureSchoolPeopleSchema, finalizeSchoolPeopleSchema } from "../school-data-schema.mjs";
import { SCHOOL_PEOPLE_RELATIONSHIP_CHECKS } from "../school-data-validators.mjs";
import { SCHOOL_IMPORT_TABLES } from "../school-import-manifest.mjs";
import { ensureSchoolImportSchema } from "../school-import-schema.mjs";

export default {
  name: "school-people",
  description: "Admissions, students, guardians, enrollment/lifecycle, promotion, discipline and import history",
  prerequisites: ["auth-core", "school-reference", "school-configuration"],
  tables: [...SCHOOL_PEOPLE_TABLES, ...SCHOOL_IMPORT_TABLES],
  ensureSchema: async (database) => {
    await configuration.ensureSchema(database);
    await ensureSchoolPeopleSchema(database);
    await ensureSchoolImportSchema(database);
  },
  finalizeSchema: finalizeSchoolPeopleSchema,
  relationshipChecks: SCHOOL_PEOPLE_RELATIONSHIP_CHECKS,
};
