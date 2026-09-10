import type { Env } from "../../../src/types";

type IceServer={urls:string|string[];username?:string;credential?:string};
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
const list=(value?:string)=>String(value||"").split(",").map(x=>x.trim()).filter(Boolean);

function base64(buffer:ArrayBuffer){
  let binary="";for(const byte of new Uint8Array(buffer))binary+=String.fromCharCode(byte);return btoa(binary);
}

async function restCredential(secret:string,username:string){
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-1"},false,["sign"]);
  return base64(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(username)));
}

export async function buildIceConfig(env:Env,userId:string){
  const stun=list(env.AUDIO_CALL_STUN_URLS),turn=list(env.AUDIO_CALL_TURN_URLS),iceServers:IceServer[]=[];
  iceServers.push({urls:stun.length?stun:["stun:stun.cloudflare.com:3478"]});
  let turnConfigured=false,credentialExpiresAt:string|null=null,credentialMode:"ephemeral"|"static"|"none"="none";
  if(turn.length&&env.AUDIO_CALL_TURN_SECRET){
    const requested=Number(env.AUDIO_CALL_TURN_TTL_SECONDS||3600),ttl=Number.isFinite(requested)?clamp(Math.round(requested),300,86400):3600,expires=Math.floor(Date.now()/1000)+ttl;
    const username=`${expires}:${userId}`,credential=await restCredential(env.AUDIO_CALL_TURN_SECRET,username);
    iceServers.push({urls:turn,username,credential});turnConfigured=true;credentialMode="ephemeral";credentialExpiresAt=new Date(expires*1000).toISOString();
  }else if(turn.length&&env.AUDIO_CALL_TURN_USERNAME&&env.AUDIO_CALL_TURN_CREDENTIAL){
    iceServers.push({urls:turn,username:env.AUDIO_CALL_TURN_USERNAME,credential:env.AUDIO_CALL_TURN_CREDENTIAL});turnConfigured=true;credentialMode="static";
  }
  return{iceServers,turnConfigured,credentialMode,credentialExpiresAt};
}
