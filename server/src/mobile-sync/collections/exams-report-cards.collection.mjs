import { canReadExamSync } from '../../exams/mobile-sync.mjs';
export async function createCollection({services}){return Object.freeze({moduleKey:'exams',collectionKey:'report-cards',canRead:(input)=>canReadExamSync(services.database,{...input,collectionKey:'report-cards'})});}
