import {Platform} from "react-native";
import {OfflineStore} from "../../native";
import {DEFAULT_LEDGERLY_API_URL} from "../config";
import type {CameraApplianceHealth,CameraConfig,CameraRegistration,CameraRuntimeState,CameraStreamConfig} from "./types";
const REG_KEY="camera.device.registration";
function base(path:string){return`${DEFAULT_LEDGERLY_API_URL.replace(/\/$/,"")}/api/v1/security-camera${path}`}
function headers(reg:CameraRegistration,body=false){return{Accept:"application/json",Authorization:`Device ${reg.deviceId}.${reg.credential}`,...(body?{"Content-Type":"application/json"}:{})}}
async function data<T>(response:Response):Promise<T>{const payload=await response.json().catch(()=>({})) as {data?:T;error?:{message?:string}};if(!response.ok||payload.data===undefined)throw new Error(payload.error?.message||`Camera service returned ${response.status}`);return payload.data}
export async function pairCamera(raw:string,deviceFingerprint:string){const response=await fetch(base("/device/pair"),{method:"POST",headers:{Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify({token:raw,deviceFingerprint,platform:Platform.OS,appVersion:"0.5.0",capabilities:["video-capture","qr-pairing","heartbeat","whip-publish","whep-live","segmented-mp4-fallback","offline-segment-queue","android-appliance"]})});return data<CameraRegistration>(response)}
export async function cameraHealth(reg:CameraRegistration){return data<{deviceId:string;status:string;serverTime:string}>(await fetch(base("/device/health"),{headers:headers(reg)}))}
export async function cameraConfig(reg:CameraRegistration){return data<CameraConfig>(await fetch(base("/device/config"),{headers:headers(reg)}))}
export async function cameraStreamConfig(reg:CameraRegistration){return data<CameraStreamConfig>(await fetch(base("/device/stream-config"),{headers:headers(reg)}))}
export async function cameraStreamState(reg:CameraRegistration,status:"online"|"connecting"|"offline"|"failed",message?:string){return data<{ok:boolean;status:string;serverTime:string}>(await fetch(base("/device/stream-state"),{method:"POST",headers:headers(reg,true),body:JSON.stringify({status,message})}))}
export async function cameraHeartbeat(reg:CameraRegistration,runtime?:CameraRuntimeState,appliance?:CameraApplianceHealth){return data<{ok:boolean;serverId?:string|null;serverAssigned:boolean;serverTime:string}>(await fetch(base("/device/heartbeat"),{method:"POST",headers:headers(reg,true),body:JSON.stringify({appVersion:"0.5.0",platform:Platform.OS,pendingSegments:runtime?.pendingSegments||0,recording:Boolean(runtime?.recording),batteryLevel:appliance?.batteryLevel,temperatureC:appliance?.temperatureC,thermalStatus:appliance?.thermalStatus,charging:appliance?.charging})}))}
export async function readCameraRegistration():Promise<CameraRegistration|null>{const raw=await OfflineStore.getSecure(REG_KEY);if(!raw)return null;try{return JSON.parse(raw) as CameraRegistration}catch{return null}}
export async function saveCameraRegistration(reg:CameraRegistration){await OfflineStore.putSecure(REG_KEY,JSON.stringify(reg))}
export async function clearCameraRegistration(){await OfflineStore.removeSecure(REG_KEY)}
