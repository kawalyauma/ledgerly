// @ts-nocheck
const QR_PREFIX="LEDGERLY-CAMERA:1:";

function uid(prefix:string){return`${prefix}_${crypto.randomUUID().replace(/-/g,"")}`}
function randomSecret(bytes=24){const value=new Uint8Array(bytes);crypto.getRandomValues(value);return Array.from(value,b=>b.toString(16).padStart(2,"0")).join("")}
async function digest(value:string){const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,"0")).join("")}
function clean(value:any,max=120){return String(value??"").trim().slice(0,max)}
function isoAfter(minutes:number){return new Date(Date.now()+minutes*60_000).toISOString()}

export async function overview(db:D1Database,organizationId:string){
  const [cameras,servers,recordings,live]=await db.batch([
    db.prepare("SELECT COUNT(*) total, SUM(CASE WHEN status='online' AND revoked_at IS NULL THEN 1 ELSE 0 END) online FROM security_cameras WHERE organization_id=?").bind(organizationId),
    db.prepare("SELECT COUNT(*) total, SUM(CASE WHEN status='online' THEN 1 ELSE 0 END) online, COALESCE(SUM(storage_total_bytes),0) storage_total_bytes, COALESCE(SUM(storage_free_bytes),0) storage_free_bytes FROM security_camera_servers WHERE organization_id=?").bind(organizationId),
    db.prepare("SELECT COUNT(*) segments, COALESCE(SUM(size_bytes),0) size_bytes FROM security_camera_recordings WHERE organization_id=? AND status!='deleted'").bind(organizationId),
    db.prepare("SELECT COUNT(*) active FROM security_camera_live_sessions WHERE organization_id=? AND status IN ('requested','signaling','connected') AND expires_at>CURRENT_TIMESTAMP").bind(organizationId)
  ]);
  return{cameras:cameras.results?.[0]||{},servers:servers.results?.[0]||{},recordings:recordings.results?.[0]||{},live:live.results?.[0]||{}};
}

export async function listCameras(db:D1Database,organizationId:string){
  const result=await db.prepare(`SELECT c.id,c.name,c.location,c.status,c.server_id,c.device_model,c.platform,c.app_version,c.battery_level,c.temperature_c,c.wifi_strength,c.last_seen_at,c.paired_at,s.name server_name
    FROM security_cameras c LEFT JOIN security_camera_servers s ON s.id=c.server_id AND s.organization_id=c.organization_id
    WHERE c.organization_id=? AND c.revoked_at IS NULL ORDER BY c.name`).bind(organizationId).all();
  return result.results||[];
}

export async function listServers(db:D1Database,organizationId:string){
  const result=await db.prepare(`SELECT id,name,location,status,local_base_url,storage_total_bytes,storage_free_bytes,last_seen_at,created_at
    FROM security_camera_servers WHERE organization_id=? ORDER BY name`).bind(organizationId).all();
  return result.results||[];
}

export async function createPairing(db:D1Database,organizationId:string,userId:string,input:any){
  const cameraName=clean(input?.name,80);if(!cameraName)throw new Error("Camera name is required");
  const location=clean(input?.location,120)||null,serverId=clean(input?.serverId,96)||null;
  if(serverId){const server=await db.prepare("SELECT id FROM security_camera_servers WHERE id=? AND organization_id=?").bind(serverId,organizationId).first();if(!server)throw new Error("Selected camera server was not found")}
  const id=uid("campair"),token=randomSecret(24),tokenHash=await digest(token),expiresAt=isoAfter(10);
  await db.prepare(`INSERT INTO security_camera_pairings(id,organization_id,created_by,camera_name,location,server_id,token_hash,expires_at)
    VALUES(?,?,?,?,?,?,?,?)`).bind(id,organizationId,userId,cameraName,location,serverId,tokenHash,expiresAt).run();
  return{id,cameraName,location,serverId,expiresAt,qrPayload:`${QR_PREFIX}${token}`};
}

export async function claimPairing(db:D1Database,input:any){
  const raw=clean(input?.token,256);if(!raw)throw new Error("Pairing token is required");
  const token=raw.startsWith(QR_PREFIX)?raw.slice(QR_PREFIX.length):raw,tokenHash=await digest(token);
  const pairing:any=await db.prepare(`SELECT * FROM security_camera_pairings WHERE token_hash=?`).bind(tokenHash).first();
  if(!pairing||pairing.consumed_at||Date.parse(pairing.expires_at)<=Date.now())throw new Error("This camera pairing QR code is invalid or expired");
  const consumedAt=new Date().toISOString();
  const claimed=await db.prepare("UPDATE security_camera_pairings SET consumed_at=? WHERE id=? AND consumed_at IS NULL").bind(consumedAt,pairing.id).run();
  if((claimed.meta?.changes||0)!==1)throw new Error("This camera pairing QR code has already been used");
  const deviceId=uid("cam"),credential=randomSecret(32),credentialHash=await digest(credential);
  const model=clean(input?.deviceModel,120)||null,platform=clean(input?.platform,40)||"android",appVersion=clean(input?.appVersion,40)||null;
  const capabilities=JSON.stringify(Array.isArray(input?.capabilities)?input.capabilities.slice(0,30):[]);
  await db.prepare(`INSERT INTO security_cameras(id,organization_id,server_id,name,location,status,credential_hash,device_model,platform,app_version,capabilities_json,paired_at,last_seen_at)
    VALUES(?,?,?,?,?,'online',?,?,?,?,?,?,?)`).bind(deviceId,pairing.organization_id,pairing.server_id,pairing.camera_name,pairing.location,credentialHash,model,platform,appVersion,capabilities,consumedAt,consumedAt).run();
  return{deviceId,credential,name:pairing.camera_name,location:pairing.location,serverId:pairing.server_id,organizationId:pairing.organization_id};
}

async function authorizeDevice(db:D1Database,deviceId:string,credential:string){
  const camera:any=await db.prepare("SELECT * FROM security_cameras WHERE id=? AND revoked_at IS NULL").bind(deviceId).first();
  if(!camera||!credential||camera.credential_hash!==await digest(credential))throw new Error("Camera credentials are invalid or revoked");
  return camera;
}

export async function heartbeat(db:D1Database,deviceId:string,credential:string,input:any){
  const camera=await authorizeDevice(db,deviceId,credential),now=new Date().toISOString();
  const battery=Number.isFinite(Number(input?.batteryLevel))?Number(input.batteryLevel):null;
  const temperature=Number.isFinite(Number(input?.temperatureC))?Number(input.temperatureC):null;
  const wifi=Number.isFinite(Number(input?.wifiStrength))?Number(input.wifiStrength):null;
  await db.prepare(`UPDATE security_cameras SET status='online',last_seen_at=?,battery_level=?,temperature_c=?,wifi_strength=?,app_version=COALESCE(?,app_version) WHERE id=?`)
    .bind(now,battery,temperature,wifi,clean(input?.appVersion,40)||null,deviceId).run();
  return{ok:true,serverId:camera.server_id,serverAssigned:Boolean(camera.server_id),serverTime:now};
}

export async function revokeCamera(db:D1Database,organizationId:string,cameraId:string){
  const now=new Date().toISOString();
  const result=await db.prepare("UPDATE security_cameras SET revoked_at=?,status='revoked' WHERE id=? AND organization_id=? AND revoked_at IS NULL").bind(now,cameraId,organizationId).run();
  if(!(result.meta?.changes))throw new Error("Camera was not found");
  return{ok:true,id:cameraId,revokedAt:now};
}
