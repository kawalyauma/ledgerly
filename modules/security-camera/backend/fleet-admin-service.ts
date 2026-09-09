// @ts-nocheck
function uid(prefix:string){return `${prefix}_${crypto.randomUUID().replace(/-/g,"")}`}
function clean(v:any,max=500){return String(v??"").trim().slice(0,max)}
function afterMinutes(n:number){return new Date(Date.now()+n*60000).toISOString()}
function clamp(v:any,min:number,max:number,fallback:number){const n=Number(v);return Number.isFinite(n)?Math.min(max,Math.max(min,Math.round(n))):fallback}
async function assertCamera(db:D1Database,organizationId:string,cameraId:string){const row:any=await db.prepare(`SELECT * FROM security_cameras WHERE id=? AND organization_id=? AND revoked_at IS NULL`).bind(cameraId,organizationId).first();if(!row)throw new Error("Camera was not found");return row}
async function serverAddress(db:D1Database,organizationId:string,serverId:string){const row:any=await db.prepare(`SELECT s.local_base_url,r.public_control_base_url FROM security_camera_servers s LEFT JOIN security_camera_server_runtime r ON r.server_id=s.id WHERE s.id=? AND s.organization_id=?`).bind(serverId,organizationId).first();if(!row)throw new Error("Camera server was not found");const base=clean(row.public_control_base_url||row.local_base_url,500).replace(/\/$/,"");if(!base)throw new Error("Camera server has not reported a control address");return base}

export async function fleetAdmin(db:D1Database,organizationId:string){
 const [groups,members,views,items,lifecycle]=await db.batch([
  db.prepare(`SELECT * FROM security_camera_groups WHERE organization_id=? ORDER BY name`).bind(organizationId),
  db.prepare(`SELECT m.group_id,m.camera_id,m.position,c.name camera_name,c.location FROM security_camera_group_members m JOIN security_camera_groups g ON g.id=m.group_id JOIN security_cameras c ON c.id=m.camera_id WHERE g.organization_id=? AND c.revoked_at IS NULL ORDER BY m.group_id,m.position,c.name`).bind(organizationId),
  db.prepare(`SELECT * FROM security_camera_wall_views WHERE organization_id=? ORDER BY name`).bind(organizationId),
  db.prepare(`SELECT i.view_id,i.camera_id,i.position,c.name camera_name,c.location FROM security_camera_wall_view_items i JOIN security_camera_wall_views v ON v.id=i.view_id JOIN security_cameras c ON c.id=i.camera_id WHERE v.organization_id=? AND c.revoked_at IS NULL ORDER BY i.view_id,i.position,c.name`).bind(organizationId),
  db.prepare(`SELECT l.*,c.name camera_name FROM security_camera_lifecycle l JOIN security_cameras c ON c.id=l.camera_id WHERE l.organization_id=? ORDER BY c.name`).bind(organizationId)
 ]);
 const ms=members.results||[],vi=items.results||[];
 return{groups:(groups.results||[]).map((g:any)=>({...g,cameras:ms.filter((m:any)=>m.group_id===g.id)})),views:(views.results||[]).map((v:any)=>({...v,cameras:vi.filter((i:any)=>i.view_id===v.id)})),lifecycle:lifecycle.results||[]};
}

export async function saveGroup(db:D1Database,organizationId:string,userId:string,input:any){
 const name=clean(input?.name,120);if(!name)throw new Error("Group name is required");const id=clean(input?.id,120)||uid("camgroup"),description=clean(input?.description,500)||null,cameraIds=[...new Set((Array.isArray(input?.cameraIds)?input.cameraIds:[]).map((x:any)=>clean(x,120)).filter(Boolean))].slice(0,64);
 for(const cameraId of cameraIds)await assertCamera(db,organizationId,cameraId);
 await db.prepare(`INSERT INTO security_camera_groups(id,organization_id,name,description,created_by,updated_at) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,updated_at=CURRENT_TIMESTAMP WHERE security_camera_groups.organization_id=excluded.organization_id`).bind(id,organizationId,name,description,userId).run();
 const statements=[db.prepare(`DELETE FROM security_camera_group_members WHERE group_id=?`).bind(id),...cameraIds.map((cameraId:string,index:number)=>db.prepare(`INSERT INTO security_camera_group_members(group_id,camera_id,position) VALUES(?,?,?)`).bind(id,cameraId,index))];await db.batch(statements);return{id,name,description,cameraIds};
}

export async function saveWallView(db:D1Database,organizationId:string,userId:string,input:any){
 const name=clean(input?.name,120);if(!name)throw new Error("Wall view name is required");const id=clean(input?.id,120)||uid("camwall"),groupId=clean(input?.groupId,120)||null,columns=clamp(input?.columns,1,6,2),muted=input?.muted===false?0:1;let cameraIds=[...new Set((Array.isArray(input?.cameraIds)?input.cameraIds:[]).map((x:any)=>clean(x,120)).filter(Boolean))].slice(0,25);
 if(groupId){const g=await db.prepare(`SELECT id FROM security_camera_groups WHERE id=? AND organization_id=?`).bind(groupId,organizationId).first();if(!g)throw new Error("Camera group was not found");if(!cameraIds.length){const rows=await db.prepare(`SELECT camera_id FROM security_camera_group_members WHERE group_id=? ORDER BY position`).bind(groupId).all();cameraIds=(rows.results||[]).map((x:any)=>x.camera_id)}}
 for(const cameraId of cameraIds)await assertCamera(db,organizationId,cameraId);
 await db.prepare(`INSERT INTO security_camera_wall_views(id,organization_id,name,group_id,columns,muted,created_by,updated_at) VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET name=excluded.name,group_id=excluded.group_id,columns=excluded.columns,muted=excluded.muted,updated_at=CURRENT_TIMESTAMP WHERE security_camera_wall_views.organization_id=excluded.organization_id`).bind(id,organizationId,name,groupId,columns,muted,userId).run();
 const statements=[db.prepare(`DELETE FROM security_camera_wall_view_items WHERE view_id=?`).bind(id),...cameraIds.map((cameraId:string,index:number)=>db.prepare(`INSERT INTO security_camera_wall_view_items(view_id,camera_id,position) VALUES(?,?,?)`).bind(id,cameraId,index))];await db.batch(statements);return{id,name,groupId,columns,muted:Boolean(muted),cameraIds};
}

export async function setLifecycle(db:D1Database,organizationId:string,userId:string,cameraId:string,input:any){
 await assertCamera(db,organizationId,cameraId);const status=["active","maintenance","disabled","decommissioned"].includes(input?.status)?input.status:"active",note=clean(input?.note,1000)||null;
 await db.prepare(`INSERT INTO security_camera_lifecycle(camera_id,organization_id,lifecycle_status,note,updated_by,updated_at) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(camera_id) DO UPDATE SET lifecycle_status=excluded.lifecycle_status,note=excluded.note,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`).bind(cameraId,organizationId,status,note,userId).run();
 if(status!=="active")await db.prepare(`UPDATE security_cameras SET recording_enabled=0 WHERE id=? AND organization_id=?`).bind(cameraId,organizationId).run();return{cameraId,status,note};
}

export async function diagnostics(db:D1Database,organizationId:string,cameraId:string){
 const camera:any=await db.prepare(`SELECT c.*,s.name server_name,s.status server_status,s.last_seen_at server_last_seen FROM security_cameras c LEFT JOIN security_camera_servers s ON s.id=c.server_id WHERE c.id=? AND c.organization_id=? AND c.revoked_at IS NULL`).bind(cameraId,organizationId).first();if(!camera)throw new Error("Camera was not found");
 const [profile,lifecycle,recording,event,alerts]=await db.batch([
  db.prepare(`SELECT * FROM security_camera_profiles WHERE camera_id=? AND organization_id=?`).bind(cameraId,organizationId),
  db.prepare(`SELECT * FROM security_camera_lifecycle WHERE camera_id=? AND organization_id=?`).bind(cameraId,organizationId),
  db.prepare(`SELECT id,started_at,ended_at,size_bytes,status,protected FROM security_camera_recordings WHERE camera_id=? AND organization_id=? AND status!='deleted' ORDER BY started_at DESC LIMIT 1`).bind(cameraId,organizationId),
  db.prepare(`SELECT id,event_type,severity,started_at,status FROM security_camera_events WHERE camera_id=? AND organization_id=? ORDER BY started_at DESC LIMIT 1`).bind(cameraId,organizationId),
  db.prepare(`SELECT id,alert_type,severity,message,last_seen_at,status FROM security_camera_alerts WHERE camera_id=? AND organization_id=? AND status!='resolved' ORDER BY last_seen_at DESC LIMIT 10`).bind(cameraId,organizationId)
 ]);
 const now=Date.now(),seen=Date.parse(camera.last_seen_at||""),issues:string[]=[];if(!seen||now-seen>60000)issues.push("Camera heartbeat is stale");if(camera.battery_level!=null&&Number(camera.battery_level)<20)issues.push("Battery is below 20%");if(camera.temperature_c!=null&&Number(camera.temperature_c)>=45)issues.push("Camera temperature is high");if(!camera.server_id)issues.push("Camera is not assigned to an NVR");if(camera.recording_enabled!==0&&!camera.last_recording_at)issues.push("Recording is enabled but no recording has been indexed");
 return{camera,profile:profile.results?.[0]||null,lifecycle:lifecycle.results?.[0]||{lifecycle_status:"active",note:null},latestRecording:recording.results?.[0]||null,latestEvent:event.results?.[0]||null,alerts:alerts.results||[],health:{ok:issues.length===0,issues}};
}

export async function createSnapshotGrant(db:D1Database,organizationId:string,userId:string,cameraId:string){
 const camera:any=await assertCamera(db,organizationId,cameraId);const rec:any=await db.prepare(`SELECT id,server_id,local_path,started_at FROM security_camera_recordings WHERE camera_id=? AND organization_id=? AND status!='deleted' ORDER BY started_at DESC LIMIT 1`).bind(cameraId,organizationId).first();if(!rec||!rec.server_id||!rec.local_path)throw new Error("No local recording is available for a snapshot yet");const base=await serverAddress(db,organizationId,rec.server_id),id=uid("grant"),token=crypto.randomUUID().replace(/-/g,"")+crypto.randomUUID().replace(/-/g,""),expiresAt=afterMinutes(5),payload={recordingId:rec.id,localPath:rec.local_path,startedAt:rec.started_at};await db.prepare(`INSERT INTO security_camera_access_grants(id,organization_id,requested_by,server_id,camera_id,kind,token,payload_json,expires_at) VALUES(?,?,?,?,?,'snapshot',?,?,?)`).bind(id,organizationId,userId,rec.server_id,cameraId,token,JSON.stringify(payload),expiresAt).run();return{id,cameraId,cameraName:camera.name,expiresAt,url:`${base}/v1/access/${token}/snapshot`};
}
