import { applyAcademicsSchemeSync,canReadAcademicsSync } from '../../academics/mobile-sync.mjs';
export async function createCollection({services}){return Object.freeze({moduleKey:'academics',collectionKey:'schemes',canRead:(input)=>canReadAcademicsSync(services.database,{...input,collectionKey:'schemes'}),apply:applyAcademicsSchemeSync});}
