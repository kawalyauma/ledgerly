import { MOBILE_SYNC_CORE_TABLES } from "./mobile-sync-core-manifest.mjs";
import { ensureMobileSyncCoreSchema } from "./mobile-sync-core-schema.mjs";
import { CONTACTS_TABLES } from "./contacts-manifest.mjs";
import { ensureContactsSchema } from "./contacts-schema.mjs";
import { COMMUNICATIONS_TABLES } from "./communications-manifest.mjs";
import { ensureCommunicationsSchema } from "./communications-schema.mjs";
import { HUMAN_RESOURCES_TABLES } from "./human-resources-manifest.mjs";
import { ensureHumanResourcesSchema } from "./human-resources-schema.mjs";

export const SHARED_MIGRATION_PHASES = Object.freeze({
  "mobile-sync-core": Object.freeze({name:"mobile-sync-core",description:"Shared offline device, mutation, cursor, conflict and tombstone infrastructure",prerequisites:Object.freeze(["auth-core"]),tables:MOBILE_SYNC_CORE_TABLES,ensureSchema:ensureMobileSyncCoreSchema,finalizeSchema:null,relationshipChecks:Object.freeze([])}),
  contacts: Object.freeze({name:"contacts",description:"Stable shared contact, person and address identities used across finance, school, tasks and communications",prerequisites:Object.freeze(["auth-core"]),tables:CONTACTS_TABLES,ensureSchema:ensureContactsSchema,finalizeSchema:null,relationshipChecks:Object.freeze([])}),
  communications: Object.freeze({name:"communications",description:"Templates, campaigns, recipient snapshots, delivery history, preferences and provider events",prerequisites:Object.freeze(["auth-core","mobile-sync-core","contacts"]),tables:COMMUNICATIONS_TABLES,ensureSchema:ensureCommunicationsSchema,finalizeSchema:null,relationshipChecks:Object.freeze([])}),
  "human-resources": Object.freeze({name:"human-resources",description:"Non-payroll HR departments/employment links, leave, onboarding and retry-safe mobile intents",prerequisites:Object.freeze(["auth-core","mobile-sync-core","contacts"]),tables:HUMAN_RESOURCES_TABLES,ensureSchema:ensureHumanResourcesSchema,finalizeSchema:null,relationshipChecks:Object.freeze([])}),
});
