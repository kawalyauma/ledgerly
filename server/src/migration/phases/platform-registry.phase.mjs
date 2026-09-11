import {PLATFORM_REGISTRY_TABLES} from '../platform-registry-manifest.mjs';
import {ensurePlatformRegistrySchema} from '../platform-registry-schema.mjs';
export default Object.freeze({name:'platform-registry',description:'Canonical application module catalog and per-organization module enablement migrated from D1',prerequisites:Object.freeze(['auth-core']),tables:PLATFORM_REGISTRY_TABLES,ensureSchema:ensurePlatformRegistrySchema,finalizeSchema:null,relationshipChecks:Object.freeze([])});
