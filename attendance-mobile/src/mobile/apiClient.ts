import {MobileApiError,refreshMobile,saveMobileSession,type MobileSession} from "./auth";

export type SessionUpdater=(session:MobileSession)=>void|Promise<void>;

type ErrorPayload={error?:{code?:string;message?:string;details?:unknown};data?:unknown};
function apiBase(url:string){return url.trim().replace(/\/$/,"")}
async function decode<T>(response:Response):Promise<T>{
  const payload=await response.json().catch(()=>({})) as ErrorPayload&{data?:T};
  if(!response.ok)throw new MobileApiError(response.status,payload.error?.code||"REQUEST_FAILED",payload.error?.message||`Request failed (${response.status})`,payload.error?.details);
  return payload.data as T;
}
export async function ledgerlyRequest<T>(session:MobileSession,path:string,init:RequestInit={},onSession?:SessionUpdater,retry=true):Promise<T>{
  const headers={Accept:"application/json",...(init.body?{"Content-Type":"application/json"}:{}),...(init.headers||{}),Authorization:`Bearer ${session.accessToken}`};
  let response:Response;
  try{response=await fetch(`${apiBase(session.apiUrl)}/api/v1${path}`,{...init,headers})}
  catch{throw new MobileApiError(0,"NETWORK_ERROR","Unable to reach Ledgerly. Check your network and retry.")}
  if(response.status===401&&retry){
    const renewed=await refreshMobile(session);
    await saveMobileSession(renewed);
    await onSession?.(renewed);
    return ledgerlyRequest<T>(renewed,path,init,onSession,false);
  }
  return decode<T>(response);
}
export function query(params:Record<string,string|number|boolean|undefined|null>){
  const entries=Object.entries(params).filter(([,v])=>v!==undefined&&v!==null&&String(v)!=="");
  return entries.length?`?${entries.map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&")}`:"";
}
