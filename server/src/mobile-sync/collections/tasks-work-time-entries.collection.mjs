import { applyTimeEntrySync, canReadWorkSync } from '../../tasks-work/mobile-sync-policy.mjs';
export async function createCollection({services}){return Object.freeze({moduleKey:'tasks-work',collectionKey:'time-entries',canRead:(input)=>canReadWorkSync(services.database,{...input,collectionKey:'time-entries'}),apply:applyTimeEntrySync});}
