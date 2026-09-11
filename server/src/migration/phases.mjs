import { AUTH_CORE_TABLES } from "./auth-core-manifest.mjs";
import { ensureAuthCoreSchema } from "./auth-core-schema.mjs";
import { SCHOOL_REFERENCE_TABLES } from "./school-reference-manifest.mjs";
import { ensureSchoolReferenceSchema, finalizeSchoolReferenceSchema } from "./school-reference-schema.mjs";
import { SCHOOL_REFERENCE_RELATIONSHIP_CHECKS } from "./school-reference-validators.mjs";
import { AUTH_CORE_RELATIONSHIP_CHECKS } from "./validators.mjs";
import { SCHOOL_CONFIGURATION_TABLES, SCHOOL_PEOPLE_TABLES, SCHOOL_STAFF_TABLES } from "./school-data-manifest.mjs";
import { ensureSchoolConfigurationSchema, finalizeSchoolConfigurationSchema, ensureSchoolPeopleSchema, finalizeSchoolPeopleSchema, ensureSchoolStaffSchema, finalizeSchoolStaffSchema } from "./school-data-schema.mjs";
import { SCHOOL_CONFIGURATION_RELATIONSHIP_CHECKS, SCHOOL_PEOPLE_RELATIONSHIP_CHECKS, SCHOOL_STAFF_RELATIONSHIP_CHECKS } from "./school-data-validators.mjs";
import { ATTENDANCE_TABLES } from "./attendance-manifest.mjs";
import { ensureAttendanceSchema, finalizeAttendanceSchema } from "./attendance-schema.mjs";
import { ATTENDANCE_RELATIONSHIP_CHECKS } from "./attendance-validators.mjs";

const ensureReferenceWithLateColumns = async (database) => {
  await ensureSchoolReferenceSchema(database);
  // 0010 adds this after the original school-reference DDL. Keep the reference
  // phase independently runnable while its FK is finalized by school-configuration.
  await database.query(`ALTER TABLE school_profiles ADD COLUMN IF NOT EXISTS logo_file_id text`);
};

const PHASES = Object.freeze({
  "auth-core": Object.freeze({ name: "auth-core", description: "Organizations, users, memberships, accounts and authentication/security data", prerequisites: Object.freeze([]), tables: AUTH_CORE_TABLES, ensureSchema: ensureAuthCoreSchema, finalizeSchema: null, relationshipChecks: AUTH_CORE_RELATIONSHIP_CHECKS }),
  "school-reference": Object.freeze({ name: "school-reference", description: "School profile and academic reference graph used by dynamic year/term/class/subject selection", prerequisites: Object.freeze(["auth-core"]), tables: SCHOOL_REFERENCE_TABLES, ensureSchema: async (database) => { await ensureAuthCoreSchema(database); await ensureReferenceWithLateColumns(database); }, finalizeSchema: finalizeSchoolReferenceSchema, relationshipChecks: SCHOOL_REFERENCE_RELATIONSHIP_CHECKS }),
  "school-configuration": Object.freeze({ name: "school-configuration", description: "School grading, calendar, fee/payment references, settings, templates, files and school-scoped IAM", prerequisites: Object.freeze(["auth-core","school-reference"]), tables: SCHOOL_CONFIGURATION_TABLES, ensureSchema: async (database) => { await ensureAuthCoreSchema(database); await ensureReferenceWithLateColumns(database); await ensureSchoolConfigurationSchema(database); }, finalizeSchema: finalizeSchoolConfigurationSchema, relationshipChecks: SCHOOL_CONFIGURATION_RELATIONSHIP_CHECKS }),
  "school-people": Object.freeze({ name: "school-people", description: "Admissions, students, guardians, enrollment/lifecycle, promotion and discipline data", prerequisites: Object.freeze(["auth-core","school-reference","school-configuration"]), tables: SCHOOL_PEOPLE_TABLES, ensureSchema: async (database) => { await ensureAuthCoreSchema(database); await ensureReferenceWithLateColumns(database); await ensureSchoolConfigurationSchema(database); await ensureSchoolPeopleSchema(database); }, finalizeSchema: finalizeSchoolPeopleSchema, relationshipChecks: SCHOOL_PEOPLE_RELATIONSHIP_CHECKS }),
  "school-staff": Object.freeze({ name: "school-staff", description: "Staff and teacher identity, positions, qualifications, files and teaching assignments without payroll postings", prerequisites: Object.freeze(["auth-core","school-reference","school-configuration"]), tables: SCHOOL_STAFF_TABLES, ensureSchema: async (database) => { await ensureAuthCoreSchema(database); await ensureReferenceWithLateColumns(database); await ensureSchoolConfigurationSchema(database); await ensureSchoolStaffSchema(database); }, finalizeSchema: finalizeSchoolStaffSchema, relationshipChecks: SCHOOL_STAFF_RELATIONSHIP_CHECKS }),
  "attendance": Object.freeze({ name: "attendance", description: "Legacy and canonical school attendance, devices, offline batches, QR identifiers and biometric metadata", prerequisites: Object.freeze(["auth-core","school-reference","school-configuration","school-people","school-staff"]), tables: ATTENDANCE_TABLES, ensureSchema: async (database) => { await ensureAuthCoreSchema(database); await ensureReferenceWithLateColumns(database); await ensureSchoolConfigurationSchema(database); await ensureSchoolPeopleSchema(database); await ensureSchoolStaffSchema(database); await ensureAttendanceSchema(database); }, finalizeSchema: finalizeAttendanceSchema, relationshipChecks: ATTENDANCE_RELATIONSHIP_CHECKS }),
});

export function getMigrationPhase(name = "auth-core") {
  const phase = PHASES[name];
  if (!phase) throw new Error(`Unknown migration phase: ${name}. Available phases: ${Object.keys(PHASES).join(", ")}`);
  return phase;
}

export function listMigrationPhases() {
  return Object.values(PHASES).map(({ name, description, prerequisites, tables }) => ({ name, description, prerequisites, tables: tables.map((table) => table.name) }));
}
