import { canReadAcademicsSync } from '../../academics/mobile-sync.mjs';
export async function createCollection({services}){return Object.freeze({moduleKey:'academics',collectionKey:'templates',canRead:(input)=>canReadAcademicsSync(services.database,{...input,collectionKey:'templates'})});}
