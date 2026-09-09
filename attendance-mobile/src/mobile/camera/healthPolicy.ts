import type {CameraApplianceHealth,CameraRuntimeState} from "./types";

const MIB=1024*1024;
export type CameraProtectionReason="thermal"|"low-battery"|"storage"|null;
export type CameraProtectionState={thermal:boolean;battery:boolean;storage:boolean;paused:boolean;reason:CameraProtectionReason};
export const EMPTY_CAMERA_PROTECTION:CameraProtectionState={thermal:false,battery:false,storage:false,paused:false,reason:null};

export function nextCameraProtection(previous:CameraProtectionState,appliance:CameraApplianceHealth,runtime:CameraRuntimeState):CameraProtectionState{
 const temp=Number(appliance.temperatureC??0),thermalStatus=Number(appliance.thermalStatus??0),battery=Number(appliance.batteryLevel??100),charging=Boolean(appliance.charging),free=Number(runtime.spoolFreeBytes??0);
 const thermal=previous.thermal?(temp>43||thermalStatus>2):(temp>=48||thermalStatus>=4);
 const lowBattery=previous.battery?(!charging&&battery<20):(!charging&&battery<=10);
 // Buffer-size pressure is handled by bounded eviction. Pause capture only when Android itself is genuinely close to storage exhaustion.
 const storage=previous.storage?(free>0&&free<768*MIB):(free>0&&free<256*MIB);
 const reason:CameraProtectionReason=thermal?"thermal":storage?"storage":lowBattery?"low-battery":null;
 return{thermal,battery:lowBattery,storage,paused:Boolean(reason),reason};
}

export function classifyNvrReachability(input:{assigned:boolean;whipStatus:string;mediaStatus?:string|null;lastUploadedAt?:string|null},now=Date.now()){
 if(!input.assigned)return"unassigned";
 if(input.mediaStatus==="offline")return"nvr-media-offline";
 if(input.whipStatus==="online")return"online";
 if(input.whipStatus==="connecting")return"connecting";
 const uploaded=input.lastUploadedAt?Date.parse(input.lastUploadedAt):0;
 if(uploaded&&now-uploaded<90_000)return"fallback-ingest";
 return input.whipStatus==="failed"?"media-unreachable":"degraded";
}
