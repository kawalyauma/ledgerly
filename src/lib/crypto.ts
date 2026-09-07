import { pbkdf2, scrypt, timingSafeEqual } from "node:crypto";

const encoder=new TextEncoder();
const hex=(bytes:ArrayBuffer|ArrayBufferView)=>{
  const view=bytes instanceof ArrayBuffer
    ? new Uint8Array(bytes)
    : new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  return Array.from(view,b=>b.toString(16).padStart(2,"0")).join("");
};

const fromHex=(value:string):Uint8Array|null=>{
  if(!value||value.length%2!==0||!/^[0-9a-f]+$/i.test(value))return null;
  const out=new Uint8Array(value.length/2);
  for(let i=0;i<out.length;i++)out[i]=parseInt(value.slice(i*2,i*2+2),16);
  return out;
};

// Password hashing standard for Ledgerly v9.9.2+.
// scrypt is intentionally used instead of WebCrypto PBKDF2 so password hashing
// does not depend on Cloudflare's WebCrypto PBKDF2 iteration ceiling.
const PASSWORD_SCRYPT_N=16384;
const PASSWORD_SCRYPT_R=8;
const PASSWORD_SCRYPT_P=1;
const PASSWORD_KEY_BYTES=32;
const PASSWORD_SALT_BYTES=16;
const PASSWORD_SCRYPT_MAXMEM=64*1024*1024;

function deriveScrypt(password:string,salt:Uint8Array,n=PASSWORD_SCRYPT_N,r=PASSWORD_SCRYPT_R,p=PASSWORD_SCRYPT_P):Promise<Uint8Array>{
  return new Promise((resolve,reject)=>{
    scrypt(password,salt,PASSWORD_KEY_BYTES,{N:n,r,p,maxmem:PASSWORD_SCRYPT_MAXMEM},(error,derivedKey)=>{
      if(error){reject(error);return;}
      resolve(new Uint8Array(derivedKey.buffer,derivedKey.byteOffset,derivedKey.byteLength));
    });
  });
}

// Legacy verifier only. No new PBKDF2 hashes are created. Successful login with
// a legacy hash is upgraded to scrypt by the auth route.
function deriveLegacyPbkdf2(password:string,salt:Uint8Array,iterations:number):Promise<Uint8Array>{
  return new Promise((resolve,reject)=>{
    pbkdf2(password,salt,iterations,PASSWORD_KEY_BYTES,"sha256",(error,derivedKey)=>{
      if(error){reject(error);return;}
      resolve(new Uint8Array(derivedKey.buffer,derivedKey.byteOffset,derivedKey.byteLength));
    });
  });
}

function sameBytes(actual:Uint8Array,expected:Uint8Array):boolean{
  if(actual.byteLength!==expected.byteLength)return false;
  return timingSafeEqual(actual,expected);
}

export async function sha256(value:string):Promise<string>{return hex(await crypto.subtle.digest("SHA-256",encoder.encode(value)))}

export async function hashPassword(password:string):Promise<string>{
  const salt=crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES));
  const derived=await deriveScrypt(password,salt);
  return `scrypt-v1:${PASSWORD_SCRYPT_N}:${PASSWORD_SCRYPT_R}:${PASSWORD_SCRYPT_P}:${hex(salt)}:${hex(derived)}`;
}

export function passwordNeedsRehash(encoded:string):boolean{
  if(!encoded)return true;
  const [algorithm,rawN,rawR,rawP]=encoded.split(":");
  if(algorithm!=="scrypt-v1")return true;
  return Number(rawN)!==PASSWORD_SCRYPT_N||Number(rawR)!==PASSWORD_SCRYPT_R||Number(rawP)!==PASSWORD_SCRYPT_P;
}

export async function verifyPassword(password:string,encoded:string):Promise<boolean>{
  if(!encoded)return false;
  const parts=encoded.split(":");
  const algorithm=parts[0];

  if(algorithm==="scrypt-v1"){
    const [,rawN,rawR,rawP,saltHex,expectedHex]=parts;
    const n=Number(rawN),r=Number(rawR),p=Number(rawP);
    if(!Number.isSafeInteger(n)||!Number.isSafeInteger(r)||!Number.isSafeInteger(p)||n<2||r<1||p<1)return false;
    // Bound parameters read from storage so a malformed DB value cannot cause
    // an excessive memory/CPU request in the Worker.
    if(n>65536||r>32||p>16)return false;
    const salt=fromHex(saltHex||""),expected=fromHex(expectedHex||"");
    if(!salt||!expected||expected.byteLength!==PASSWORD_KEY_BYTES)return false;
    try{return sameBytes(await deriveScrypt(password,salt,n,r,p),expected)}catch{return false;}
  }

  if(algorithm==="pbkdf2-sha256"){
    const [,rawIterations,saltHex,expectedHex]=parts;
    const iterations=Number(rawIterations);
    if(!Number.isSafeInteger(iterations)||iterations<1||iterations>2_000_000)return false;
    const salt=fromHex(saltHex||""),expected=fromHex(expectedHex||"");
    if(!salt||!expected||expected.byteLength!==PASSWORD_KEY_BYTES)return false;
    try{return sameBytes(await deriveLegacyPbkdf2(password,salt,iterations),expected)}catch{return false;}
  }

  return false;
}

export function randomToken(bytes=32):string{const value=crypto.getRandomValues(new Uint8Array(bytes));return btoa(String.fromCharCode(...value)).replaceAll("+","-").replaceAll("/","_").replaceAll("=","")}
export async function encryptSensitive(value:string,secret:string):Promise<string>{const keyBytes=await crypto.subtle.digest("SHA-256",encoder.encode(secret)),key=await crypto.subtle.importKey("raw",keyBytes,{name:"AES-GCM"},false,["encrypt"]),iv=crypto.getRandomValues(new Uint8Array(12)),cipher=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,encoder.encode(value));return `${btoa(String.fromCharCode(...iv))}.${btoa(String.fromCharCode(...new Uint8Array(cipher)))}`}
