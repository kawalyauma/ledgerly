import { canReadWorkSync } from '../../tasks-work/mobile-sync-policy.mjs';
export async function createCollection({services}){return Object.freeze({moduleKey:'tasks-work',collectionKey:'projects',canRead:(input)=>canReadWorkSync(services.database,{...input,collectionKey:'projects'})});}
