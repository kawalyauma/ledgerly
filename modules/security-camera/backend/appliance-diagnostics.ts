// @ts-nocheck
import {authorizeDevice} from "./service";

function finite(value:any){const n=Number(value);return Number.isFinite(n)?n:null}
function bool(value:any){return value===true||value===1||value==="1"?1:value===false||value===0||value==="0"?0:null}

export async function updateApplianceDiagnostics(db:D1Database,deviceId:string,credential:string,input:any){
  const camera=await authorizeDevice(db,deviceId,credential),now=new Date().toISOString();
  const pending=Math.max(0,Math.floor(finite(input?.pendingSegments)??0));
  const spool=Math.max(0,Math.floor(finite(input?.spoolBytes)??0));
  const free=finite(input?.spoolFreeBytes);
  await db.prepare(`UPDATE security_cameras SET charging=COALESCE(?,charging),thermal_status=COALESCE(?,thermal_status),device_owner=COALESCE(?,device_owner),appliance_running=COALESCE(?,appliance_running),wake_lock=COALESCE(?,wake_lock),pending_segments=?,spool_bytes=?,spool_free_bytes=COALESCE(?,spool_free_bytes),buffer_pressure=COALESCE(?,buffer_pressure),diagnostics_updated_at=? WHERE id=?`).bind(
    bool(input?.charging),finite(input?.thermalStatus),bool(input?.deviceOwner),bool(input?.applianceRunning),bool(input?.wakeLock),pending,spool,free==null?null:Math.max(0,Math.floor(free)),bool(input?.bufferPressure),now,camera.id
  ).run();
  return{ok:true,deviceId:camera.id,serverTime:now};
}
