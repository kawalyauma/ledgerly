import { applyAcademicsActionSync,canReadAcademicsSync } from '../../academics/mobile-sync.mjs';
export async function createCollection({services}){return Object.freeze({moduleKey:'academics',collectionKey:'actions',canRead:(input)=>canReadAcademicsSync(services.database,{...input,collectionKey:'actions'}),apply:applyAcademicsActionSync});}
