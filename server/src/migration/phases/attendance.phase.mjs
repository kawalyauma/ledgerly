import people from "./school-people.phase.mjs";
import staff from "./school-staff.phase.mjs";
import { ATTENDANCE_TABLES } from "../attendance-manifest.mjs";
import { ensureAttendanceSchema, finalizeAttendanceSchema } from "../attendance-schema.mjs";
import { ATTENDANCE_RELATIONSHIP_CHECKS } from "../attendance-validators.mjs";

export default {
  name: "attendance",
  description: "Legacy and canonical school attendance, devices, offline batches, QR identifiers and biometric metadata",
  prerequisites: ["auth-core", "school-reference", "school-configuration", "contacts", "mobile-sync-core", "school-people", "school-staff"],
  tables: ATTENDANCE_TABLES,
  ensureSchema: async (database) => {
    await people.ensureSchema(database);
    await staff.ensureSchema(database);
    await ensureAttendanceSchema(database);
  },
  finalizeSchema: finalizeAttendanceSchema,
  relationshipChecks: ATTENDANCE_RELATIONSHIP_CHECKS,
};
