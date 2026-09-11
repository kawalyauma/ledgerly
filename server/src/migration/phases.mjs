import { AUTH_CORE_TABLES } from "./auth-core-manifest.mjs";
import { ensureAuthCoreSchema } from "./auth-core-schema.mjs";
import { SCHOOL_REFERENCE_TABLES } from "./school-reference-manifest.mjs";
import { ensureSchoolReferenceSchema, finalizeSchoolReferenceSchema } from "./school-reference-schema.mjs";
import { SCHOOL_REFERENCE_RELATIONSHIP_CHECKS } from "./school-reference-validators.mjs";
import { AUTH_CORE_RELATIONSHIP_CHECKS } from "./validators.mjs";
import { EXAMS_TABLES } from "./exams-manifest.mjs";
import { ensureExamsSchema } from "./exams-schema.mjs";
import { EXAMS_RELATIONSHIP_CHECKS } from "./exams-validators.mjs";
import { TASKS_WORK_TABLES } from "./tasks-work-manifest.mjs";
import { ensureTasksWorkSchema } from "./tasks-work-schema.mjs";
import { TASKS_WORK_RELATIONSHIP_CHECKS } from "./tasks-work-validators.mjs";

const PHASES = Object.freeze({
  "auth-core": Object.freeze({name:"auth-core",description:"Organizations, users, memberships, accounts and authentication/security data",prerequisites:Object.freeze([]),tables:AUTH_CORE_TABLES,ensureSchema:ensureAuthCoreSchema,finalizeSchema:null,relationshipChecks:AUTH_CORE_RELATIONSHIP_CHECKS}),
  "school-reference": Object.freeze({name:"school-reference",description:"School profile and academic reference graph used by dynamic year/term/class/subject selection",prerequisites:Object.freeze(["auth-core"]),tables:SCHOOL_REFERENCE_TABLES,ensureSchema:async(database)=>{await ensureAuthCoreSchema(database);await ensureSchoolReferenceSchema(database);},finalizeSchema:finalizeSchoolReferenceSchema,relationshipChecks:SCHOOL_REFERENCE_RELATIONSHIP_CHECKS}),
  "exams": Object.freeze({name:"exams",description:"Standalone examinations, marks, grading and report-card records",prerequisites:Object.freeze(["auth-core","school-reference"]),tables:EXAMS_TABLES,ensureSchema:async(database)=>{await ensureAuthCoreSchema(database);await ensureSchoolReferenceSchema(database);await ensureExamsSchema(database);},finalizeSchema:null,relationshipChecks:EXAMS_RELATIONSHIP_CHECKS}),
  "tasks-work": Object.freeze({name:"tasks-work",description:"Tasks, projects, collaboration, notifications and Work Chat",prerequisites:Object.freeze(["auth-core"]),tables:TASKS_WORK_TABLES,ensureSchema:async(database)=>{await ensureAuthCoreSchema(database);await ensureTasksWorkSchema(database);},finalizeSchema:null,relationshipChecks:TASKS_WORK_RELATIONSHIP_CHECKS}),
});
export function getMigrationPhase(name="auth-core"){const phase=PHASES[name];if(!phase)throw new Error(`Unknown migration phase: ${name}. Available phases: ${Object.keys(PHASES).join(", ")}`);return phase;}
export function listMigrationPhases(){return Object.values(PHASES).map(({name,description,prerequisites,tables})=>({name,description,prerequisites,tables:tables.map(t=>t.name)}));}
