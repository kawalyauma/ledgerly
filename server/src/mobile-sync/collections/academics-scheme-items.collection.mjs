import { applyAcademicsSchemeItemSync,canReadAcademicsSync } from '../../academics/mobile-sync.mjs';
export async function createCollection({services}){return Object.freeze({moduleKey:'academics',collectionKey:'scheme-items',canRead:(input)=>canReadAcademicsSync(services.database,{...input,collectionKey:'scheme-items'}),apply:applyAcademicsSchemeItemSync});}
