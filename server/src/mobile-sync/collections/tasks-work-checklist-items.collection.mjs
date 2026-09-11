import { applyChecklistSync, canReadWorkSync } from '../../tasks-work/mobile-sync-policy.mjs';
export async function createCollection({services}){return Object.freeze({moduleKey:'tasks-work',collectionKey:'checklist-items',canRead:(input)=>canReadWorkSync(services.database,{...input,collectionKey:'checklist-items'}),apply:applyChecklistSync});}
