import {OfflineStore} from "./native";
import type {AttendanceEvent,Bootstrap} from "./types";
export function eventId(){return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,12)}`}
export async function enqueue(event:AttendanceEvent){await OfflineStore.enqueue(event.clientEventId,JSON.stringify(event));return OfflineStore.count()}
export async function pending(){return(await OfflineStore.pending(500)).map(row=>({id:row.id,event:JSON.parse(row.payload) as AttendanceEvent,attempts:row.attempts,lastError:row.lastError}))}
export async function failed(){return(await OfflineStore.failed(500)).map(row=>({id:row.id,event:JSON.parse(row.payload) as AttendanceEvent,attempts:row.attempts,lastError:row.lastError}))}
export async function cacheBootstrap(value:Bootstrap){await OfflineStore.putSecure("bootstrap",JSON.stringify(value))}
export async function cachedBootstrap(){const raw=await OfflineStore.getSecure("bootstrap");return raw?JSON.parse(raw) as Bootstrap:null}
