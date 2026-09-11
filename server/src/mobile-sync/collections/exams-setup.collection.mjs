import { canReadExamSync } from '../../exams/mobile-sync.mjs';
export async function createCollection({services}){return Object.freeze({moduleKey:'exams',collectionKey:'setup',canRead:(input)=>canReadExamSync(services.database,{...input,collectionKey:'setup'})});}
