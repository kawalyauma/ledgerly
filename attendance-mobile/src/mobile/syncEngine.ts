import {MobileSyncStore} from "../native";
import {MobileApiError,type MobileSession} from "./auth";
import {
  acknowledgeMobileSyncBootstrap,
  acknowledgeMobileSyncPull,
  acknowledgeMobileSyncSchemas,
  bootstrapMobileSync,
  initializeMobileSync,
  pullMobileSync,
  pushMobileSync,
  type MobileSyncCollection,
  type MobileSyncDependency,
  type MobileSyncManifest,
  type MobileSyncMutation,
} from "./syncClient";
import type {SessionUpdater} from "./apiClient";

type CollectionRef={moduleKey:string;collectionKey:string};
type SyncOptions={maxPushBatches?:number;maxPullRounds?:number;pullLimit?:number};
type QueueMutationInput={operationId?:string;moduleKey:string;collectionKey:string;recordId:string;kind?:"upsert"|"delete";payload?:unknown;dependencies?:MobileSyncDependency[];baseVersion?:number;clientTimestamp?:string};
type PendingRow={operationId:string;sequence:number;moduleKey:string;collectionKey:string;recordId:string;kind:"upsert"|"delete";schemaVersion:number;baseVersion:number;clientTimestamp:string;payloadJson?:string|null;dependenciesJson:string};

function id(prefix:string){
  const cryptoRef=(globalThis as any)?.crypto;
  const random=typeof cryptoRef?.randomUUID==="function"?cryptoRef.randomUUID().replace(/-/g,""):`${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  return`${prefix}_${random}`;
}
function parse<T>(value?:string|null,fallback?:T):T|undefined{if(!value)return fallback;try{return JSON.parse(value) as T}catch{return fallback}}
function key(c:CollectionRef){return`${c.moduleKey}:${c.collectionKey}`}
function wantedManifest(manifest:MobileSyncManifest,collections:CollectionRef[]){const wanted=new Set(collections.map(key));return manifest.collections.filter(c=>wanted.has(key(c)))}

export async function queueMobileMutation(input:QueueMutationInput){
  const states=await MobileSyncStore.collectionStates();
  const state=states.find(s=>s.moduleKey===input.moduleKey&&s.collectionKey===input.collectionKey);
  if(!state||state.schemaVersion<1)throw new MobileApiError(409,"MOBILE_COLLECTION_NOT_BOOTSTRAPPED",`Synchronize ${input.moduleKey}/${input.collectionKey} before creating offline changes.`);
  const record=input.baseVersion===undefined?await MobileSyncStore.getRecord(input.moduleKey,input.collectionKey,input.recordId):null;
  const operation={operationId:input.operationId||id("mop"),moduleKey:input.moduleKey,collectionKey:input.collectionKey,recordId:input.recordId,kind:input.kind||"upsert",schemaVersion:state.schemaVersion,baseVersion:input.baseVersion??record?.version??0,clientTimestamp:input.clientTimestamp||new Date().toISOString(),payload:input.payload,dependencies:input.dependencies||[]};
  const sequence=await MobileSyncStore.enqueueOperation(JSON.stringify(operation));
  return{...operation,sequence};
}

async function pendingMutations(limit=250):Promise<MobileSyncMutation[]>{
  const rows=await MobileSyncStore.pendingOperations(limit) as PendingRow[];
  return rows.map(row=>({operationId:row.operationId,sequence:Number(row.sequence),moduleKey:row.moduleKey,collectionKey:row.collectionKey,recordId:row.recordId,kind:row.kind,schemaVersion:Number(row.schemaVersion),baseVersion:Number(row.baseVersion),clientTimestamp:row.clientTimestamp,payload:parse(row.payloadJson),dependencies:parse<MobileSyncDependency[]>(row.dependenciesJson,[])||[]}));
}

async function flushBootstrapAcks(){const pending=await MobileSyncStore.pendingBootstrapAcks();for(const bootstrapId of pending){await acknowledgeMobileSyncBootstrap(bootstrapId);await MobileSyncStore.clearBootstrapAck(bootstrapId)}return pending.length}
async function flushPullAcks(){let total=0;while(true){const pending=await MobileSyncStore.pendingPullAcks();if(!pending.length)return total;const chunk=pending.slice(0,100);await acknowledgeMobileSyncPull(chunk);await MobileSyncStore.clearPullAcks(chunk.map(a=>a.deliveryId));total+=chunk.length;if(chunk.length<100)return total}}

async function validateQueuedSchemas(manifest:MobileSyncManifest){
  const map=new Map(manifest.collections.map(c=>[key(c),c.schemaVersion]));
  const rows=await MobileSyncStore.pendingOperations(250) as PendingRow[];
  const stale=rows.filter(row=>map.has(key(row))&&map.get(key(row))!==Number(row.schemaVersion));
  if(stale.length)throw new MobileApiError(409,"LOCAL_OPERATION_SCHEMA_MIGRATION_REQUIRED",`${stale.length} queued offline operation(s) were created with an older collection schema. Migrate or resolve them before acknowledging the new schema.`,stale.map(s=>({operationId:s.operationId,moduleKey:s.moduleKey,collectionKey:s.collectionKey,fromSchemaVersion:s.schemaVersion,toSchemaVersion:map.get(key(s))})));
}

async function prepareCollections(manifest:MobileSyncManifest,collections:CollectionRef[]){
  const definitions=wantedManifest(manifest,collections);
  if(definitions.length!==collections.length){const known=new Set(definitions.map(key));throw new MobileApiError(422,"MOBILE_COLLECTION_NOT_AVAILABLE","One or more requested mobile collections are not registered by the server.",collections.filter(c=>!known.has(key(c))))}
  await validateQueuedSchemas(manifest);
  const states=await MobileSyncStore.collectionStates();
  const stateMap=new Map(states.map(s=>[key(s),s]));
  const needsBootstrap=definitions.filter(def=>stateMap.get(key(def))?.schemaVersion!==def.schemaVersion).map(def=>({moduleKey:def.moduleKey,collectionKey:def.collectionKey}));
  // Server schema acknowledgement happens before bootstrap, but local schema state is advanced only by applyBootstrap().
  // If the network fails here, the next attempt still sees the old local schema and cannot accidentally skip bootstrap.
  await acknowledgeMobileSyncSchemas(manifest,collections);
  return{definitions,needsBootstrap};
}

async function bootstrapCollections(collections:CollectionRef[]){if(!collections.length)return 0;const data=await bootstrapMobileSync(collections);await MobileSyncStore.applyBootstrap(JSON.stringify(data));await flushBootstrapAcks();return collections.length}

async function pushPending(maxBatches:number){
  let batches=0,operations=0;
  while(batches<maxBatches){const pending=await pendingMutations(250);if(!pending.length)break;const response=await pushMobileSync(id("mbat"),pending) as any;const results=Array.isArray(response?.operations)?response.operations:[];await MobileSyncStore.applyPushResults(JSON.stringify(results));batches+=1;operations+=results.length;if(response?.status!=="completed"||results.length===0)break}
  return{batches,operations,pending:await MobileSyncStore.pendingOperationCount()};
}

async function pullCollections(collections:CollectionRef[],maxRounds:number,pullLimit:number){
  let rounds=0,changes=0;
  while(rounds<maxRounds){const response=await pullMobileSync(id("mpr"),collections.map(c=>({...c,limit:pullLimit}))) as any;await MobileSyncStore.applyPull(JSON.stringify(response));const delivered=(response?.collections||[]) as Array<{changes?:unknown[];hasMore?:boolean}>;changes+=delivered.reduce((n,c)=>n+(Array.isArray(c.changes)?c.changes.length:0),0);await flushPullAcks();rounds+=1;if(!delivered.some(c=>Boolean(c.hasMore)))break}
  return{rounds,changes};
}

export async function syncMobileNow(session:MobileSession,registration:{deviceName:string;platform:"android"|"ios";appVersion:string;clientSchemaVersion:number;deviceModel?:string|null;osVersion?:string|null},collections:CollectionRef[],onSession?:SessionUpdater,options:SyncOptions={}){
  if(!collections.length)return{bootstrapped:0,pushed:{batches:0,operations:0,pending:0},pulled:{rounds:0,changes:0},manifest:null};
  const initialized=await initializeMobileSync(session,registration,onSession);
  const manifest=initialized.manifest;
  await flushBootstrapAcks();await flushPullAcks();
  const prepared=await prepareCollections(manifest,collections);
  const bootstrapped=await bootstrapCollections(prepared.needsBootstrap);
  const pushed=await pushPending(Math.max(1,options.maxPushBatches??10));
  const pulled=await pullCollections(collections,Math.max(1,options.maxPullRounds??20),Math.min(1000,Math.max(1,options.pullLimit??500)));
  return{bootstrapped,pushed,pulled,manifest,identity:initialized.identity};
}

export async function localMobileRecord<T=unknown>(moduleKey:string,collectionKey:string,recordId:string){const row=await MobileSyncStore.getRecord(moduleKey,collectionKey,recordId);if(!row||row.deleted)return null;return{id:row.id,version:row.version,updatedAt:row.updatedAt??null,payload:parse<T>(row.payloadJson)}}
export async function localMobileRecords<T=unknown>(moduleKey:string,collectionKey:string,limit=200,offset=0){const rows=await MobileSyncStore.listRecords(moduleKey,collectionKey,Math.min(1000,Math.max(1,limit)),Math.max(0,offset));return rows.map(row=>({id:row.id,version:row.version,updatedAt:row.updatedAt??null,payload:parse<T>(row.payloadJson)}))}
export function mobileCollection(manifest:MobileSyncManifest,moduleKey:string,collectionKey:string):MobileSyncCollection|undefined{return manifest.collections.find(c=>c.moduleKey===moduleKey&&c.collectionKey===collectionKey)}
