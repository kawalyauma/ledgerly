import { AUTH_CORE_TABLES } from "./auth-core-manifest.mjs";
import { ensureAuthCoreSchema } from "./auth-core-schema.mjs";
import { SCHOOL_REFERENCE_TABLES } from "./school-reference-manifest.mjs";
import { ensureSchoolReferenceSchema, finalizeSchoolReferenceSchema } from "./school-reference-schema.mjs";
import { SCHOOL_REFERENCE_RELATIONSHIP_CHECKS } from "./school-reference-validators.mjs";
import { AUTH_CORE_RELATIONSHIP_CHECKS } from "./validators.mjs";
import { SCHOOL_CONFIGURATION_TABLES, SCHOOL_PEOPLE_TABLES, SCHOOL_STAFF_TABLES } from "./school-data-manifest.mjs";
import { ensureSchoolConfigurationSchema, finalizeSchoolConfigurationSchema, ensureSchoolPeopleSchema, finalizeSchoolPeopleSchema, ensureSchoolStaffSchema, finalizeSchoolStaffSchema } from "./school-data-schema.mjs";
import { SCHOOL_CONFIGURATION_RELATIONSHIP_CHECKS, SCHOOL_PEOPLE_RELATIONSHIP_CHECKS, SCHOOL_STAFF_RELATIONSHIP_CHECKS } from "./school-data-validators.mjs";
import { SCHOOL_FEE_REFERENCE_TABLES } from "./school-fee-reference-manifest.mjs";
import { ensureSchoolFeeReferenceSchema } from "./school-fee-reference-schema.mjs";
import { SCHOOL_FEE_REFERENCE_RELATIONSHIP_CHECKS } from "./school-fee-reference-validators.mjs";
import { SCHOOL_IMPORT_TABLES } from "./school-import-manifest.mjs";
import { ensureSchoolImportSchema } from "./school-import-schema.mjs";
import { MODULE_REGISTRY_TABLES } from "./module-registry-manifest.mjs";
import { ensureModuleRegistrySchema } from "./module-registry-schema.mjs";
import { MODULE_REGISTRY_RELATIONSHIP_CHECKS } from "./module-registry-validators.mjs";
import { ATTENDANCE_TABLES } from "./attendance-manifest.mjs";
import { ensureAttendanceSchema, finalizeAttendanceSchema } from "./attendance-schema.mjs";
import { ATTENDANCE_RELATIONSHIP_CHECKS } from "./attendance-validators.mjs";
import { ACADEMICS_TABLES } from "./academics-manifest.mjs";
import { ensureAcademicsSchema, finalizeAcademicsSchema } from "./academics-schema.mjs";
import { ACADEMICS_RELATIONSHIP_CHECKS } from "./academics-validators.mjs";
import { BOOKS_TABLES } from "./books-manifest.mjs";
import { ensureBooksSchema, finalizeBooksSchema } from "./books-schema.mjs";
import { BOOKS_RELATIONSHIP_CHECKS } from "./books-validators.mjs";

const ensureReferenceWithLateColumns=async(database)=>{await ensureSchoolReferenceSchema(database);await database.query(`ALTER TABLE school_profiles ADD COLUMN IF NOT EXISTS logo_file_id text`);};
const ensureSchoolBase=async(database)=>{await ensureAuthCoreSchema(database);await ensureReferenceWithLateColumns(database);await ensureSchoolConfigurationSchema(database);await ensureSchoolFeeReferenceSchema(database);await ensureModuleRegistrySchema(database);};
const ensurePeople=async(database)=>{await ensureSchoolBase(database);await ensureSchoolPeopleSchema(database);await ensureSchoolImportSchema(database);};
const ensureStaff=async(database)=>{await ensureSchoolBase(database);await ensureSchoolStaffSchema(database);};
const finalizeConfiguration=async(database)=>{await finalizeSchoolConfigurationSchema(database);};

const PHASES=Object.freeze({
 "auth-core":Object.freeze({name:"auth-core",description:"Organizations, users, memberships, accounts and authentication/security data",prerequisites:Object.freeze([]),tables:AUTH_CORE_TABLES,ensureSchema:ensureAuthCoreSchema,finalizeSchema:null,relationshipChecks:AUTH_CORE_RELATIONSHIP_CHECKS}),
 "school-reference":Object.freeze({name:"school-reference",description:"School profile and academic reference graph used by dynamic year/term/class/subject selection",prerequisites:Object.freeze(["auth-core"]),tables:SCHOOL_REFERENCE_TABLES,ensureSchema:async(database)=>{await ensureAuthCoreSchema(database);await ensureReferenceWithLateColumns(database);},finalizeSchema:finalizeSchoolReferenceSchema,relationshipChecks:SCHOOL_REFERENCE_RELATIONSHIP_CHECKS}),
 "school-configuration":Object.freeze({name:"school-configuration",description:"School grading, calendar, fee/payment references, settings, templates, module registry, files and school-scoped IAM",prerequisites:Object.freeze(["auth-core","school-reference"]),tables:Object.freeze([...SCHOOL_CONFIGURATION_TABLES,...SCHOOL_FEE_REFERENCE_TABLES,...MODULE_REGISTRY_TABLES]),ensureSchema:ensureSchoolBase,finalizeSchema:finalizeConfiguration,relationshipChecks:Object.freeze([...SCHOOL_CONFIGURATION_RELATIONSHIP_CHECKS,...SCHOOL_FEE_REFERENCE_RELATIONSHIP_CHECKS,...MODULE_REGISTRY_RELATIONSHIP_CHECKS])}),
 "school-people":Object.freeze({name:"school-people",description:"Admissions, students, guardians, enrollment/lifecycle, promotion, discipline and import history",prerequisites:Object.freeze(["auth-core","school-reference","school-configuration"]),tables:Object.freeze([...SCHOOL_PEOPLE_TABLES,...SCHOOL_IMPORT_TABLES]),ensureSchema:ensurePeople,finalizeSchema:finalizeSchoolPeopleSchema,relationshipChecks:SCHOOL_PEOPLE_RELATIONSHIP_CHECKS}),
 "school-staff":Object.freeze({name:"school-staff",description:"Staff and teacher identity, positions, qualifications, files and teaching assignments without payroll postings",prerequisites:Object.freeze(["auth-core","school-reference","school-configuration"]),tables:SCHOOL_STAFF_TABLES,ensureSchema:ensureStaff,finalizeSchema:finalizeSchoolStaffSchema,relationshipChecks:SCHOOL_STAFF_RELATIONSHIP_CHECKS}),
 "attendance":Object.freeze({name:"attendance",description:"Legacy and canonical school attendance, devices, offline batches, QR identifiers and biometric metadata",prerequisites:Object.freeze(["auth-core","school-reference","school-configuration","school-people","school-staff"]),tables:ATTENDANCE_TABLES,ensureSchema:async(database)=>{await ensurePeople(database);await ensureStaff(database);await ensureAttendanceSchema(database);},finalizeSchema:finalizeAttendanceSchema,relationshipChecks:ATTENDANCE_RELATIONSHIP_CHECKS}),
 "academics":Object.freeze({name:"academics",description:"Scheduling, schemes of work, lesson planning/delivery, resources and academic supervision",prerequisites:Object.freeze(["auth-core","school-reference","school-configuration","school-people","school-staff","attendance"]),tables:ACADEMICS_TABLES,ensureSchema:async(database)=>{await ensurePeople(database);await ensureStaff(database);await ensureAttendanceSchema(database);await ensureAcademicsSchema(database);},finalizeSchema:finalizeAcademicsSchema,relationshipChecks:ACADEMICS_RELATIONSHIP_CHECKS}),
 "books":Object.freeze({name:"books",description:"School exercise-book stock, learner distribution and offline operation intents",prerequisites:Object.freeze(["auth-core","school-reference","school-configuration","school-people"]),tables:BOOKS_TABLES,ensureSchema:async(database)=>{await ensurePeople(database);await ensureBooksSchema(database);},finalizeSchema:finalizeBooksSchema,relationshipChecks:BOOKS_RELATIONSHIP_CHECKS}),
});
export function getMigrationPhase(name="auth-core"){const phase=PHASES[name];if(!phase)throw new Error(`Unknown migration phase: ${name}. Available phases: ${Object.keys(PHASES).join(", ")}`);return phase;}
export function listMigrationPhases(){return Object.values(PHASES).map(({name,description,prerequisites,tables})=>({name,description,prerequisites,tables:tables.map(table=>table.name)}));}
