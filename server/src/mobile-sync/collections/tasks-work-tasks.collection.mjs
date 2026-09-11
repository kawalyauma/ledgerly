import { applyTaskSync, canReadWorkSync } from '../../tasks-work/mobile-sync-policy.mjs';
export async function createCollection({services}){return Object.freeze({moduleKey:'tasks-work',collectionKey:'tasks',canRead:(input)=>canReadWorkSync(services.database,{...input,collectionKey:'tasks'}),apply:applyTaskSync});}
