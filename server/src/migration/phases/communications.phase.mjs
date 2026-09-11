import { COMMUNICATIONS_TABLES } from "../communications-manifest.mjs";
import { ensureCommunicationsSchema, finalizeCommunicationsSchema } from "../communications-schema.mjs";
import { COMMUNICATIONS_RELATIONSHIP_CHECKS } from "../shared-validators.mjs";
export default {name:"communications",description:"Templates, campaigns, recipient snapshots, deliveries, preferences and provider events",prerequisites:["auth-core","mobile-sync-core","contacts"],tables:COMMUNICATIONS_TABLES,ensureSchema:ensureCommunicationsSchema,finalizeSchema:finalizeCommunicationsSchema,relationshipChecks:COMMUNICATIONS_RELATIONSHIP_CHECKS};
