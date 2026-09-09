import {DeviceManager,OfflineStore} from "../native";
import type {MobileSession} from "./auth";
import {MobileApiError} from "./auth";
import {ledgerlyRequest,type SessionUpdater} from "./apiClient";

const IDENTITY_KEY="mobile.sync.identity.v1";
const ACCESS_SKEW_MS=30_000;

export type MobileSyncIdentity={
  apiUrl:string;
  organizationId?:string;
  deviceId:string;
  installationId:string;
  offlineGrant:string;
  offlineGrantExpiresAt?:string;
  protocolVersion:number;
  accessToken?:string;
  accessExpiresAt?:number;
};

export type MobileSyncCollection={
  moduleKey:string;
  collectionKey:string;
  schemaVersion:number;
  minClientSchemaVersion?:number;
  mode:"read-only"|"read-write"|"append-only";
  sourceOfTruth?:"server"|"client"|"merge";
  conflictPolicy?:string;
};

export type MobileSyncManifest={
  protocolVersion:number;
  maximumPushOperations:number;
  maximumPullLimit:number;
  ordering:string;
  pullCursor:string;
  collections:MobileSyncCollection[];
};

type DeviceRegistrationInput={
  deviceName:string;
  platform:"android"|"ios";
  appVersion:string;
  clientSchemaVersion:number;
  deviceModel?:string|null;
  osVersion?:string|null;
};

type ExchangeResult={
  accessToken:string;
  expiresIn:number;
  deviceId:string;
  organizationId:string;
  offlineGrantExpiresAt?:string;
  protocolVersion:number;
  serverTime:string;
};

type RegistrationResult={
  deviceId:string;
  installationId:string;
  protocolVersion:number;
  offlineGrant:string;
  offlineGrantExpiresAt?:string;
  offlineGrantDays:number;
};

function apiBase(url:string){return url.trim().replace(/\/$/,"")}
async function decode<T>(response:Response):Promise<T>{
  const payload=await response.json().catch(()=>({})) as {data?:T;error?:{code?:string;message?:string;details?:unknown}};
  if(!response.ok)throw new MobileApiError(response.status,payload.error?.code||"REQUEST_FAILED",payload.error?.message||`Request failed (${response.status})`,payload.error?.details);
  return payload.data as T;
}

export async function readMobileSyncIdentity(){
  const raw=await OfflineStore.getSecure(IDENTITY_KEY);
  if(!raw)return null;
  try{return JSON.parse(raw) as MobileSyncIdentity}catch{await OfflineStore.removeSecure(IDENTITY_KEY);return null}
}

export async function saveMobileSyncIdentity(identity:MobileSyncIdentity){
  await OfflineStore.putSecure(IDENTITY_KEY,JSON.stringify(identity));
  return identity;
}

export async function clearMobileSyncIdentity(){await OfflineStore.removeSecure(IDENTITY_KEY)}

export async function registerMobileSyncDevice(session:MobileSession,input:DeviceRegistrationInput,onSession?:SessionUpdater){
  const installationId=(await DeviceManager.deviceFingerprint()).trim();
  if(installationId.length<16)throw new MobileApiError(0,"INVALID_INSTALLATION_ID","Unable to derive a stable mobile installation identifier.");
  const data=await ledgerlyRequest<RegistrationResult>(session,"/mobile-sync/devices",{
    method:"POST",
    body:JSON.stringify({...input,installationId}),
  },onSession);
  return saveMobileSyncIdentity({
    apiUrl:apiBase(session.apiUrl),
    organizationId:session.organizationId,
    deviceId:data.deviceId,
    installationId:data.installationId,
    offlineGrant:data.offlineGrant,
    offlineGrantExpiresAt:data.offlineGrantExpiresAt,
    protocolVersion:data.protocolVersion,
  });
}

async function exchange(identity:MobileSyncIdentity,input?:{appVersion?:string;clientSchemaVersion?:number}){
  let response:Response;
  try{
    response=await fetch(`${apiBase(identity.apiUrl)}/api/v1/mobile-sync/offline/exchange`,{
      method:"POST",
      headers:{Accept:"application/json","Content-Type":"application/json"},
      body:JSON.stringify({deviceId:identity.deviceId,offlineGrant:identity.offlineGrant,...input}),
    });
  }catch{throw new MobileApiError(0,"NETWORK_ERROR","Unable to reach Ledgerly to renew offline synchronization access.")}
  const data=await decode<ExchangeResult>(response);
  const next:MobileSyncIdentity={
    ...identity,
    organizationId:data.organizationId,
    protocolVersion:data.protocolVersion,
    offlineGrantExpiresAt:data.offlineGrantExpiresAt,
    accessToken:data.accessToken,
    accessExpiresAt:Date.now()+Math.max(0,data.expiresIn*1000),
  };
  await saveMobileSyncIdentity(next);
  return next;
}

export async function ensureMobileSyncAccess(input?:{appVersion?:string;clientSchemaVersion?:number}){
  const identity=await readMobileSyncIdentity();
  if(!identity)throw new MobileApiError(401,"MOBILE_SYNC_NOT_REGISTERED","This installation has not been registered for offline synchronization.");
  if(identity.accessToken&&Number(identity.accessExpiresAt||0)-ACCESS_SKEW_MS>Date.now())return identity;
  return exchange(identity,input);
}

async function syncRequest<T>(path:string,init:RequestInit={},retry=true):Promise<T>{
  const identity=await ensureMobileSyncAccess();
  const isForm=typeof FormData!=="undefined"&&init.body instanceof FormData;
  const headers={Accept:"application/json",...(!isForm&&init.body?{"Content-Type":"application/json"}:{}),...(init.headers||{}),Authorization:`Bearer ${identity.accessToken}`};
  let response:Response;
  try{response=await fetch(`${apiBase(identity.apiUrl)}/api/v1/mobile-sync${path}`,{...init,headers})}
  catch{throw new MobileApiError(0,"NETWORK_ERROR","Unable to reach Ledgerly. Synchronization will retry when connectivity returns.")}
  if(response.status===401&&retry){
    const renewed=await exchange({...identity,accessToken:undefined,accessExpiresAt:undefined});
    const retryHeaders={...headers,Authorization:`Bearer ${renewed.accessToken}`};
    try{response=await fetch(`${apiBase(renewed.apiUrl)}/api/v1/mobile-sync${path}`,{...init,headers:retryHeaders})}
    catch{throw new MobileApiError(0,"NETWORK_ERROR","Unable to reach Ledgerly. Synchronization will retry when connectivity returns.")}
  }
  return decode<T>(response);
}

export async function fetchMobileSyncManifest(){return syncRequest<MobileSyncManifest>("/manifest")}

export async function acknowledgeMobileSyncSchemas(manifest:MobileSyncManifest,collections?:Array<{moduleKey:string;collectionKey:string}>){
  const identity=await ensureMobileSyncAccess();
  const wanted=collections?.length?new Set(collections.map(c=>`${c.moduleKey}:${c.collectionKey}`)):null;
  const schemas=manifest.collections.filter(c=>!wanted||wanted.has(`${c.moduleKey}:${c.collectionKey}`)).map(c=>({moduleKey:c.moduleKey,collectionKey:c.collectionKey,schemaVersion:c.schemaVersion}));
  if(!schemas.length)return{deviceId:identity.deviceId,acknowledged:0};
  return syncRequest<any>("/schemas/ack",{method:"POST",body:JSON.stringify({deviceId:identity.deviceId,schemas})});
}

export async function bootstrapMobileSync(collections:Array<{moduleKey:string;collectionKey:string}>){
  const identity=await ensureMobileSyncAccess();
  return syncRequest<any>("/bootstrap",{method:"POST",body:JSON.stringify({deviceId:identity.deviceId,protocolVersion:identity.protocolVersion,collections})});
}

export async function acknowledgeMobileSyncBootstrap(bootstrapId:string){
  const identity=await ensureMobileSyncAccess();
  return syncRequest<any>("/bootstrap/ack",{method:"POST",body:JSON.stringify({deviceId:identity.deviceId,bootstrapId})});
}

export type MobileSyncDependency={operationId:string}|{moduleKey:string;collectionKey:string;recordId:string;minVersion?:number};
export type MobileSyncMutation={
  operationId:string;
  sequence:number;
  moduleKey:string;
  collectionKey:string;
  recordId:string;
  kind:"upsert"|"delete";
  schemaVersion:number;
  baseVersion:number;
  clientTimestamp:string;
  payload?:unknown;
  dependencies?:MobileSyncDependency[];
};

export async function pushMobileSync(batchId:string,operations:MobileSyncMutation[]){
  const identity=await ensureMobileSyncAccess();
  return syncRequest<any>("/push",{method:"POST",body:JSON.stringify({deviceId:identity.deviceId,batchId,protocolVersion:identity.protocolVersion,operations})});
}

export async function pullMobileSync(requestId:string,collections:Array<{moduleKey:string;collectionKey:string;limit?:number}>){
  const identity=await ensureMobileSyncAccess();
  return syncRequest<any>("/pull",{method:"POST",body:JSON.stringify({deviceId:identity.deviceId,requestId,protocolVersion:identity.protocolVersion,collections})});
}

export async function acknowledgeMobileSyncPull(acknowledgements:Array<{deliveryId:string;cursor:number}>){
  const identity=await ensureMobileSyncAccess();
  return syncRequest<any>("/pull/ack",{method:"POST",body:JSON.stringify({deviceId:identity.deviceId,acknowledgements})});
}

export async function mobileSyncRecoveryState(batchId?:string){
  const identity=await ensureMobileSyncAccess();
  const suffix=batchId?`?batchId=${encodeURIComponent(batchId)}`:"";
  return syncRequest<any>(`/recovery/${encodeURIComponent(identity.deviceId)}${suffix}`);
}

export async function initializeMobileSync(session:MobileSession,input:DeviceRegistrationInput,onSession?:SessionUpdater){
  let identity=await readMobileSyncIdentity();
  if(identity&&apiBase(identity.apiUrl)!==apiBase(session.apiUrl)){await clearMobileSyncIdentity();identity=null}
  if(!identity){identity=await registerMobileSyncDevice(session,input,onSession)}
  try{
    identity=await exchange(identity,{appVersion:input.appVersion,clientSchemaVersion:input.clientSchemaVersion});
  }catch(error){
    if(error instanceof MobileApiError&&[401,403,404].includes(error.status))identity=await registerMobileSyncDevice(session,input,onSession);
    else throw error;
  }
  const manifest=await fetchMobileSyncManifest();
  if(manifest.protocolVersion!==identity.protocolVersion)throw new MobileApiError(409,"MOBILE_SYNC_PROTOCOL_MISMATCH","The installed app does not match the server synchronization protocol.");
  return{identity,manifest};
}
