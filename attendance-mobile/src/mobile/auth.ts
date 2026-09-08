import {OfflineStore} from "../native";
import {DEFAULT_LEDGERLY_API_URL} from "./config";

export type MobileSession={
  accessToken:string;
  refreshToken:string;
  expiresIn:number;
  sessionId:string;
  apiUrl:string;
  identifier:string;
  organizationId?:string;
};

type LoginInput={identifier:string;password:string;organizationId?:string;mfaCode?:string};
type ErrorPayload={error?:{code?:string;message?:string;details?:unknown}};
const SESSION_KEY="mobile.auth.session";
const ONBOARDING_KEY="mobile.onboarding.complete";

export class MobileApiError extends Error{
  constructor(public status:number,public code:string,message:string,public details?:unknown){super(message)}
}
function base(url:string){return(url||DEFAULT_LEDGERLY_API_URL).trim().replace(/\/$/,"")}
async function jsonRequest<T>(url:string,init:RequestInit):Promise<T>{
  let response:Response;
  try{response=await fetch(url,init)}catch{throw new MobileApiError(0,"NETWORK_ERROR","Unable to reach Ledgerly. Check your connection and server address.")}
  const payload=await response.json().catch(()=>({})) as ErrorPayload&{data?:T};
  if(!response.ok)throw new MobileApiError(response.status,payload.error?.code||"REQUEST_FAILED",payload.error?.message||`Request failed (${response.status})`,payload.error?.details);
  return payload.data as T;
}
export async function loginMobile(apiUrl:string,input:LoginInput):Promise<MobileSession>{
  const data=await jsonRequest<Omit<MobileSession,"apiUrl"|"identifier"|"organizationId">>(`${base(apiUrl)}/auth/login`,{method:"POST",headers:{Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify(input)});
  return{...data,apiUrl:base(apiUrl),identifier:input.identifier.trim(),organizationId:input.organizationId?.trim()||undefined};
}
export async function refreshMobile(session:MobileSession):Promise<MobileSession>{
  const data=await jsonRequest<Omit<MobileSession,"apiUrl"|"identifier"|"organizationId">>(`${base(session.apiUrl)}/auth/refresh`,{method:"POST",headers:{Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify({refreshToken:session.refreshToken})});
  return{...data,apiUrl:session.apiUrl,identifier:session.identifier,organizationId:session.organizationId};
}
export async function logoutMobile(session:MobileSession){
  try{await fetch(`${base(session.apiUrl)}/auth/logout`,{method:"POST",headers:{Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify({refreshToken:session.refreshToken})})}catch{}
}
export async function saveMobileSession(session:MobileSession){await OfflineStore.putSecure(SESSION_KEY,JSON.stringify(session))}
export async function readMobileSession(){const raw=await OfflineStore.getSecure(SESSION_KEY);if(!raw)return null;try{return JSON.parse(raw) as MobileSession}catch{await OfflineStore.removeSecure(SESSION_KEY);return null}}
export async function clearMobileSession(){await OfflineStore.removeSecure(SESSION_KEY)}
export async function onboardingComplete(){return(await OfflineStore.getSecure(ONBOARDING_KEY))==="1"}
export async function completeOnboarding(){await OfflineStore.putSecure(ONBOARDING_KEY,"1")}
