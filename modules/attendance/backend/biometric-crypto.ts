import type { Env } from "../../../src/types";
import { AppError } from "../../../src/lib/errors";

function bytesToBase64(bytes:Uint8Array){let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s)}
function decodeBase64(value:string,code="INVALID_FACE_TEMPLATE"){
  try{
    const s=atob(value);
    const out=new Uint8Array(s.length);
    for(let i=0;i<s.length;i++)out[i]=s.charCodeAt(i);
    return out;
  }catch{
    throw new AppError(422,code,"Value must be valid base64");
  }
}
function configuredKeyBytes(env:Env){
  const raw=String(env.BIOMETRIC_ENCRYPTION_KEY||"").trim();
  if(!raw)throw new AppError(503,"BIOMETRIC_KEY_REQUIRED","BIOMETRIC_ENCRYPTION_KEY is not configured");
  let bytes:Uint8Array;
  try{bytes=decodeBase64(raw,"BIOMETRIC_KEY_INVALID")}catch(error){
    if(error instanceof AppError)throw new AppError(503,"BIOMETRIC_KEY_INVALID","BIOMETRIC_ENCRYPTION_KEY must be valid base64");
    throw error;
  }
  if(bytes.length!==32)throw new AppError(503,"BIOMETRIC_KEY_INVALID","BIOMETRIC_ENCRYPTION_KEY must decode to exactly 32 bytes");
  return bytes;
}
async function key(env:Env){return crypto.subtle.importKey("raw",configuredKeyBytes(env),{name:"AES-GCM"},false,["encrypt","decrypt"])}
function aad(context:string){return new TextEncoder().encode(`ledgerly-attendance-face-v1:${context}`)}

export function biometricEncryptionReady(env:Env){try{return configuredKeyBytes(env).length===32}catch{return false}}

export async function encryptEmbedding(env:Env,plainBase64:string,context:string,expectedBytes?:number){
  const plain=decodeBase64(plainBase64);
  if(!plain.length||plain.length>8192)throw new AppError(422,"INVALID_FACE_TEMPLATE","Face embedding is empty or too large");
  if(expectedBytes!=null&&plain.length!==expectedBytes)throw new AppError(422,"INVALID_FACE_TEMPLATE",`Face embedding must contain exactly ${expectedBytes} bytes`);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:aad(context)},await key(env),plain);
  return{ciphertext:bytesToBase64(new Uint8Array(encrypted)),iv:bytesToBase64(iv),bytes:plain.length};
}
export async function decryptEmbedding(env:Env,ciphertext:string,iv:string,context:string){
  try{
    const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:decodeBase64(iv,"BIOMETRIC_DECRYPT_FAILED"),additionalData:aad(context)},await key(env),decodeBase64(ciphertext,"BIOMETRIC_DECRYPT_FAILED"));
    return bytesToBase64(new Uint8Array(plain));
  }catch(error){
    if(error instanceof AppError&&["BIOMETRIC_KEY_REQUIRED","BIOMETRIC_KEY_INVALID"].includes(error.code))throw error;
    throw new AppError(500,"BIOMETRIC_DECRYPT_FAILED","Unable to decrypt biometric template");
  }
}
