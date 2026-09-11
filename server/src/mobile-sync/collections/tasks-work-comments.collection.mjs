import { applyCommentSync, canReadWorkSync } from '../../tasks-work/mobile-sync-policy.mjs';
export async function createCollection({services}){return Object.freeze({moduleKey:'tasks-work',collectionKey:'comments',canRead:(input)=>canReadWorkSync(services.database,{...input,collectionKey:'comments'}),apply:applyCommentSync});}
