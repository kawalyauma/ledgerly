import { ensureAuthCoreSchema } from "../auth-core-schema.mjs";
import { MOBILE_SYNC_CORE_TABLES } from "../mobile-sync-core-manifest.mjs";
import { ensureMobileSyncCoreCompatibility, finalizeMobileSyncCoreSchema } from "../mobile-sync-core-compat.mjs";
import { MOBILE_SYNC_RELATIONSHIP_CHECKS } from "../shared-validators.mjs";
export default {name:"mobile-sync-core",description:"Shared offline device, mutation, cursor, conflict and tombstone infrastructure",prerequisites:["auth-core"],tables:MOBILE_SYNC_CORE_TABLES,ensureSchema:async(database)=>{await ensureAuthCoreSchema(database);await ensureMobileSyncCoreCompatibility(database);},finalizeSchema:finalizeMobileSyncCoreSchema,relationshipChecks:MOBILE_SYNC_RELATIONSHIP_CHECKS};
