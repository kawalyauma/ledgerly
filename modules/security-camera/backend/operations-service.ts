// @ts-nocheck
import { authorizeServer } from "./service";

function uid(prefix:string){return `${prefix}_${crypto.randomUUID().replace(/-/g,"")}`}
function clean(v:any,max=240){return String(v??"").trim().slice(0,max)}
function num(v:any,min:number,max:number,fallback:number){const n=Number(v);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):fallback}
function afterMinutes(n:number){return new Date(Date.now()+n*60000).toISOString()}

export async function getOperations(db:D1Database,organizationId:string){
 const [alerts,volumes,runtime,exports] = await db.batch([
  db.prepare(`SELECT a.*,c.name camera_name,s.name server_name FROM security_camera_alerts a LEFT JOIN security_cameras c ON c.id=a.camera_id LEFT JOIN security_camera_servers s ON s.id=a.server_id WHERE a.organization_id=? AND a.status!='resolved' ORDER BY CASE a.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,a.last_seen_at DESC LIMIT 200`).bind(organizationId),
  db.prepare(`SELECT v.*,s.name server_name FROM security_camera_server_volumes v JOIN security_camera_servers s ON s.id=v.server_id WHERE v.organization_id=? ORDER BY s.name,v.priority,v.label`).bind(organizationId),
  db.prepare(`SELECT r.*,s.name server_name FROM security_camera_server_runtime r JOIN security_camera_servers s ON s.id=r.server_id WHERE r.organization_id=? ORDER BY s.name`).bind(organizationId),
  db.prepare(`SELECT e.*,c.name camera_name,s.name server_name FROM security_camera_exports e JOIN security_cameras c ON c.id=e.camera_id JOIN security_camera_servers s ON s.id=e.server_id WHERE e.organization_id=? ORDER BY e.created_at DESC LIMIT 100`).bind(organizationId)
 ]);
 return {alerts:alerts.results||[],volumes:volumes.results||[],runtime:runtime.results||[],exports:exports.results||[]};
}

export async function getCameraProfile(db:D1Database,organizationId:string,cameraId:string){
 const camera:any=await db.prepare(`SELECT id,name,location FROM security_cameras WHERE id=? AND organization_id=? AND revoked_at IS NULL`).bind(cameraId,organizationId).first();
 if(!camera)throw new Error("Camera was not found");
 const row:any=await db.prepare(`SELECT * FROM security_camera_profiles WHERE camera_id=? AND organization_id=?`).bind(cameraId,organizationId).first();
 return {camera,...(row||{camera_id:cameraId,organization_id:organizationId,preferred_facing:"back",width:1280,height:720,fps:15,bitrate_kbps:1200,segment_seconds:20,retention_days:30,audio_enabled:0,motion_enabled:0})};
}

export async function saveCameraProfile(db:D1Database,organizationId:string,cameraId:string,input:any){
 const camera=await db.prepare(`SELECT id FROM security_cameras WHERE id=? AND organization_id=? AND revoked_at IS NULL`).bind(cameraId,organizationId).first();if(!camera)throw new Error("Camera was not found");
 const facing=input?.preferredFacing==="front"?"front":"back",width=num(input?.width,320,3840,1280),height=num(input?.height,240,2160,720),fps=num(input?.fps,5,30,15),bitrate=num(input?.bitrateKbps,250,12000,1200),segment=num(input?.segmentSeconds,10,300,20),retention=num(input?.retentionDays,1,365,30),audio=input?.audioEnabled?1:0,motion=input?.motionEnabled?1:0;
 await db.prepare(`INSERT INTO security_camera_profiles(camera_id,organization_id,preferred_facing,width,height,fps,bitrate_kbps,segment_seconds,retention_days,audio_enabled,motion_enabled,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(camera_id) DO UPDATE SET preferred_facing=excluded.preferred_facing,width=excluded.width,height=excluded.height,fps=excluded.fps,bitrate_kbps=excluded.bitrate_kbps,segment_seconds=excluded.segment_seconds,retention_days=excluded.retention_days,audio_enabled=excluded.audio_enabled,motion_enabled=excluded.motion_enabled,updated_at=CURRENT_TIMESTAMP`).bind(cameraId,organizationId,facing,width,height,fps,bitrate,segment,retention,audio,motion).run();
 return getCameraProfile(db,organizationId,cameraId);
}

export async function timeline(db:D1Database,organizationId:string,cameraId:string,from?:string,to?:string,limit=1000){
 const camera=await db.prepare(`SELECT id,name FROM security_cameras WHERE id=? AND organization_id=? AND revoked_at IS NULL`).bind(cameraId,organizationId).first<any>();if(!camera)throw new Error("Camera was not found");
 const params:any[]=[organizationId,cameraId];let where=`r.organization_id=? AND r.camera_id=? AND r.status!='deleted'`;if(from){where+=` AND COALESCE(r.ended_at,r.started_at)>=?`;params.push(from)}if(to){where+=` AND r.started_at<=?`;params.push(to)}params.push(Math.min(5000,Math.max(1,Number(limit)||1000)));
 const rows=await db.prepare(`SELECT r.id,r.server_id,r.started_at,r.ended_at,r.local_path,r.size_bytes,r.protected,r.status,s.name server_name FROM security_camera_recordings r LEFT JOIN security_camera_servers s ON s.id=r.server_id WHERE ${where} ORDER BY r.started_at ASC LIMIT ?`).bind(...params).all();
 const items=(rows.results||[]) as any[];let coveredMs=0,gaps:any[]=[];for(let i=0;i<items.length;i++){const a=new Date(items[i].started_at).getTime(),b=new Date(items[i].ended_at||items[i].started_at).getTime();coveredMs+=Math.max(0,b-a);if(i){const p=new Date(items[i-1].ended_at||items[i-1].started_at).getTime();if(a-p>15000)gaps.push({from:new Date(p).toISOString(),to:new Date(a).toISOString(),durationMs:a-p})}}
 return {camera,from:from||null,to:to||null,segments:items,gaps,coveredMs};
}

async function serverAddress(db:D1Database,organizationId:string,serverId:string){const row:any=await db.prepare(`SELECT s.local_base_url,r.public_control_base_url FROM security_camera_servers s LEFT JOIN security_camera_server_runtime r ON r.server_id=s.id WHERE s.id=? AND s.organization_id=?`).bind(serverId,organizationId).first();if(!row)throw new Error("Camera server was not found");const base=clean(row.public_control_base_url||row.local_base_url,500).replace(/\/$/,"");if(!base)throw new Error("Camera server has not reported a playback address");return base}

export async function createPlaybackGrant(db:D1Database,organizationId:string,userId:string,recordingId:string){
 const rec:any=await db.prepare(`SELECT r.id,r.camera_id,r.server_id,r.local_path,r.started_at,r.ended_at,c.name camera_name FROM security_camera_recordings r JOIN security_cameras c ON c.id=r.camera_id WHERE r.id=? AND r.organization_id=? AND r.status!='deleted'`).bind(recordingId,organizationId).first();if(!rec)throw new Error("Recording was not found");if(!rec.server_id)throw new Error("Recording is not attached to an NVR");
 const base=await serverAddress(db,organizationId,rec.server_id),id=uid("grant"),token=crypto.randomUUID().replace(/-/g,"")+crypto.randomUUID().replace(/-/g,""),expiresAt=afterMinutes(10),payload={recordingId:rec.id,localPath:rec.local_path,startedAt:rec.started_at,endedAt:rec.ended_at};
 await db.prepare(`INSERT INTO security_camera_access_grants(id,organization_id,requested_by,server_id,camera_id,kind,token,payload_json,expires_at) VALUES(?,?,?,?,?,'playback',?,?,?)`).bind(id,organizationId,userId,rec.server_id,rec.camera_id,token,JSON.stringify(payload),expiresAt).run();
 return {id,kind:"playback",cameraId:rec.camera_id,cameraName:rec.camera_name,expiresAt,url:`${base}/v1/access/${token}/playback`};
}

export async function createExport(db:D1Database,organizationId:string,userId:string,cameraId:string,input:any){
 const from=clean(input?.from,64),to=clean(input?.to,64);if(!from||!to||Number.isNaN(Date.parse(from))||Number.isNaN(Date.parse(to))||Date.parse(to)<=Date.parse(from))throw new Error("A valid export start and end time are required");
 const camera:any=await db.prepare(`SELECT id,name,server_id FROM security_cameras WHERE id=? AND organization_id=? AND revoked_at IS NULL`).bind(cameraId,organizationId).first();if(!camera)throw new Error("Camera was not found");if(!camera.server_id)throw new Error("Camera is not assigned to an NVR");
 const base=await serverAddress(db,organizationId,camera.server_id),exportId=uid("camexport"),grantId=uid("grant"),token=crypto.randomUUID().replace(/-/g,"")+crypto.randomUUID().replace(/-/g,""),expiresAt=afterMinutes(30),payload={exportId,cameraId,from,to};
 await db.batch([
  db.prepare(`INSERT INTO security_camera_exports(id,organization_id,requested_by,server_id,camera_id,from_at,to_at,status) VALUES(?,?,?,?,?,?,?,'requested')`).bind(exportId,organizationId,userId,camera.server_id,cameraId,from,to),
  db.prepare(`INSERT INTO security_camera_access_grants(id,organization_id,requested_by,server_id,camera_id,kind,token,payload_json,expires_at) VALUES(?,?,?,?,?,'export',?,?,?)`).bind(grantId,organizationId,userId,camera.server_id,cameraId,token,JSON.stringify(payload),expiresAt)
 ]);
 return {id:exportId,cameraId,cameraName:camera.name,from,to,status:"requested",expiresAt,url:`${base}/v1/access/${token}/export`};
}

export async function acknowledgeAlert(db:D1Database,organizationId:string,userId:string,id:string){const r=await db.prepare(`UPDATE security_camera_alerts SET status='acknowledged',acknowledged_at=CURRENT_TIMESTAMP,acknowledged_by=? WHERE id=? AND organization_id=? AND status='open'`).bind(userId,id,organizationId).run();if(!(r.meta?.changes))throw new Error("Open alert was not found");return{ok:true,id}}

export async function serverOperations(db:D1Database,serverId:string,credential:string){
 const server:any=await authorizeServer(db,serverId,credential);const [profiles,grants]=await db.batch([
  db.prepare(`SELECT p.* FROM security_camera_profiles p JOIN security_cameras c ON c.id=p.camera_id WHERE p.organization_id=? AND c.server_id=? AND c.revoked_at IS NULL`).bind(server.organization_id,serverId),
  db.prepare(`SELECT id,camera_id,kind,token,payload_json,expires_at FROM security_camera_access_grants WHERE organization_id=? AND server_id=? AND expires_at>CURRENT_TIMESTAMP ORDER BY created_at`).bind(server.organization_id,serverId)
 ]);return{profiles:profiles.results||[],grants:(grants.results||[]).map((g:any)=>({...g,payload:JSON.parse(g.payload_json||"{}")}))};
}

export async function syncServerOperations(db:D1Database,serverId:string,credential:string,input:any){
 const server:any=await authorizeServer(db,serverId,credential),org=server.organization_id,now=new Date().toISOString(),runtime=input?.runtime||{};
 await db.prepare(`INSERT INTO security_camera_server_runtime(server_id,organization_id,public_control_base_url,cpu_percent,memory_percent,uptime_seconds,active_streams,active_viewers,last_error,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(server_id) DO UPDATE SET public_control_base_url=excluded.public_control_base_url,cpu_percent=excluded.cpu_percent,memory_percent=excluded.memory_percent,uptime_seconds=excluded.uptime_seconds,active_streams=excluded.active_streams,active_viewers=excluded.active_viewers,last_error=excluded.last_error,updated_at=excluded.updated_at`).bind(serverId,org,clean(runtime.publicControlBaseUrl,500)||null,Number(runtime.cpuPercent)||null,Number(runtime.memoryPercent)||null,Math.max(0,Number(runtime.uptimeSeconds)||0),Math.max(0,Number(runtime.activeStreams)||0),Math.max(0,Number(runtime.activeViewers)||0),clean(runtime.lastError,500)||null,now).run();
 for(const v of Array.isArray(input?.volumes)?input.volumes.slice(0,32):[]){const key=clean(v.key,80);if(!key)continue;await db.prepare(`INSERT INTO security_camera_server_volumes(id,organization_id,server_id,volume_key,label,path,priority,total_bytes,free_bytes,status,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(server_id,volume_key) DO UPDATE SET label=excluded.label,path=excluded.path,priority=excluded.priority,total_bytes=excluded.total_bytes,free_bytes=excluded.free_bytes,status=excluded.status,last_seen_at=excluded.last_seen_at`).bind(`${serverId}:${key}`,org,serverId,key,clean(v.label,120)||key,clean(v.path,500),Number(v.priority)||100,Math.max(0,Number(v.totalBytes)||0),Math.max(0,Number(v.freeBytes)||0),clean(v.status,32)||"online",now).run()}
 for(const a of Array.isArray(input?.alerts)?input.alerts.slice(0,100):[]){const type=clean(a.type,80),message=clean(a.message,500);if(!type||!message)continue;const cameraId=clean(a.cameraId,120)||null,severity=["info","warning","critical"].includes(a.severity)?a.severity:"warning",id=clean(a.id,180)||`${serverId}:${type}:${cameraId||"server"}`;await db.prepare(`INSERT INTO security_camera_alerts(id,organization_id,camera_id,server_id,alert_type,severity,status,message,details_json,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?,'open',?,?,?,?) ON CONFLICT(id) DO UPDATE SET severity=excluded.severity,message=excluded.message,details_json=excluded.details_json,last_seen_at=excluded.last_seen_at,status=CASE WHEN security_camera_alerts.status='resolved' THEN 'open' ELSE security_camera_alerts.status END,resolved_at=NULL`).bind(id,org,cameraId,serverId,type,severity,message,JSON.stringify(a.details||{}),now,now).run()}
 for(const e of Array.isArray(input?.exports)?input.exports.slice(0,100):[]){const id=clean(e.id,180);if(!id)continue;const status=clean(e.status,32)||"processing";await db.prepare(`UPDATE security_camera_exports SET status=?,local_path=COALESCE(?,local_path),size_bytes=COALESCE(?,size_bytes),error_message=COALESCE(?,error_message),completed_at=CASE WHEN ? IN ('complete','failed') THEN CURRENT_TIMESTAMP ELSE completed_at END WHERE id=? AND organization_id=? AND server_id=?`).bind(status,clean(e.localPath,600)||null,Number.isFinite(Number(e.sizeBytes))?Number(e.sizeBytes):null,clean(e.error,500)||null,status,id,org,serverId).run()}
 return{ok:true,serverTime:now};
}
