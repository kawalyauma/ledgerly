import { applyExamMarkSync, canReadExamSync } from '../../exams/mobile-sync.mjs';
export async function createCollection({services}){return Object.freeze({moduleKey:'exams',collectionKey:'marks',canRead:(input)=>canReadExamSync(services.database,{...input,collectionKey:'marks'}),apply:applyExamMarkSync});}
