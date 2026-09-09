import {CameraSpool} from "../../native";
import type {CameraRuntimeState} from "./types";

export const CAMERA_SPOOL_PRESSURE_FREE_BYTES=512*1024*1024;
export const CAMERA_SPOOL_PRESSURE_COUNT=170;

export async function readCameraSpoolDiagnostics():Promise<Pick<CameraRuntimeState,"pendingSegments"|"spoolBytes"|"spoolFreeBytes"|"bufferPressure">>{
  const stats=await CameraSpool.stats().catch(()=>({count:0,bytes:0,freeBytes:0,totalBytes:0}));
  return{
    pendingSegments:stats.count||0,
    spoolBytes:stats.bytes||0,
    spoolFreeBytes:stats.freeBytes||0,
    bufferPressure:(stats.freeBytes||0)<CAMERA_SPOOL_PRESSURE_FREE_BYTES||(stats.count||0)>=CAMERA_SPOOL_PRESSURE_COUNT,
  };
}
