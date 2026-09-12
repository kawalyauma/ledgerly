import { applyAcademicsDeliverySync,canReadAcademicsSync } from '../../academics/mobile-sync.mjs';
export async function createCollection({services}){return Object.freeze({moduleKey:'academics',collectionKey:'deliveries',canRead:(input)=>canReadAcademicsSync(services.database,{...input,collectionKey:'deliveries'}),apply:applyAcademicsDeliverySync});}
