import { applyAcademicsLessonPlanSync,canReadAcademicsSync } from '../../academics/mobile-sync.mjs';
export async function createCollection({services}){return Object.freeze({moduleKey:'academics',collectionKey:'lesson-plans',canRead:(input)=>canReadAcademicsSync(services.database,{...input,collectionKey:'lesson-plans'}),apply:applyAcademicsLessonPlanSync});}
