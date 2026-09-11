import { ensureAuthCoreSchema } from "../auth-core-schema.mjs";
import { CONTACTS_TABLES } from "../contacts-manifest.mjs";
import { ensureContactsSchema } from "../contacts-schema.mjs";
import { CONTACTS_RELATIONSHIP_CHECKS } from "../shared-validators.mjs";
export default {name:"contacts",description:"Stable shared contacts, addresses and contact-person identities",prerequisites:["auth-core"],tables:CONTACTS_TABLES,ensureSchema:async(database)=>{await ensureAuthCoreSchema(database);await ensureContactsSchema(database);},finalizeSchema:null,relationshipChecks:CONTACTS_RELATIONSHIP_CHECKS};
