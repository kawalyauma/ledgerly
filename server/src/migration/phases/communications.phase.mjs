import { COMMUNICATIONS_TABLES } from "../communications-manifest.mjs";
import { ensureCommunicationsSchema } from "../communications-schema.mjs";
import { COMMUNICATIONS_RELATIONSHIP_CHECKS } from "../shared-validators.mjs";
export default {name:"communications",description:"Templates, campaigns, recipient snapshots, deliveries, preferences and provider events",prerequisites:["auth-core","mobile-sync-core","contacts"],tables:COMMUNICATIONS_TABLES,ensureSchema:ensureCommunicationsSchema,finalizeSchema:null,relationshipChecks:COMMUNICATIONS_RELATIONSHIP_CHECKS};
