import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';

const DEFAULT_ICE=Object.freeze([{urls:['stun:stun.l.google.com:19302']}]);
const QR_PREFIX='LEDGERLY-CAMERA:1:', SERVER_PREFIX='LEDGERLY-CAMERA-SERVER:1:';
function uid(prefix){return `${prefix}_${randomUUID().replaceAll('-','')}`;}
function secret(bytes=32){return randomBytes(bytes).toString('hex');}
function digest(value){return createHash('sha256').update(String(value)).digest('hex');}
function clean(value,max=500){return String(value??'').trim().slice(0,max);}
function afterMinutes(minutes){return new Date(Date.now()+minutes*60000);}
function legacyBool(value){return value?1:0;}
function safeJson(value,fallback={}){try{return JSON.parse(value??'');}catch{return fallback;}}
function appError(code,message,status=400){const error=new Error(message);error.code=code;error.status=status;return error;}
function equalDigest(left,right){if(!left||!right)return false;const a=Buffer.from(String(left)),b=Buffer.from(String(right));return a.length===b.length&&timingSafeEqual(a,b);}
function sha(value){const s=clean(value,64).toLowerCase();return /^[a-f0-9]{64}$/.test(s)?s:null;}
function inSchedule(row,at){
  if(!row?.schedule_id)return true;const when=new Date(at);if(Number.isNaN(when.getTime()))return false;
  const timezone=row.timezone||'Africa/Kampala',parts=new Intl.DateTimeFormat('en-GB',{timeZone:timezone,weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(when);
  const weekdays={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6},weekday=weekdays[parts.find(x=>x.type==='weekday')?.value||'Mon'];
  const hh=parts.find(x=>x.type==='hour')?.value||'00',mm=parts.find(x=>x.type==='minute')?.value||'00',clock=`${hh}:${mm}`,days=safeJson(row.days_json,[0,1,2,3,4,5,6]);
  if(!Array.isArray(days)||!days.includes(weekday))return false;return row.start_time<=row.end_time?(clock>=row.start_time&&clock<=row.end_time):(clock>=row.start_time||clock<=row.end_time);
}

export class SecurityCameraNodeService{
  constructor({database}){if(!database?.query||!database?.transaction)throw new TypeError('SecurityCameraNodeService requires database');this.database=database;}
  async one(sql,params=[]){return (await this.database.query(sql,params)).rows[0]??null;}
  async rows(sql,params=[]){return (await this.database.query(sql,params)).rows;}

  async createPairing(organizationId,userId,input={}){
    const name=clean(input.name,80);if(!name)throw appError('CAMERA_NAME_REQUIRED','Camera name is required',422);
    const serverId=clean(input.serverId,120)||null;
    if(serverId&&!await this.one(`SELECT id FROM security_camera_servers WHERE id=$1 AND organization_id=$2`,[serverId,organizationId]))throw appError('CAMERA_SERVER_NOT_FOUND','Selected camera server was not found',404);
    const id=uid('campair'),token=secret(24),expiresAt=afterMinutes(10);
    await this.database.query(`INSERT INTO security_camera_pairings(id,organization_id,created_by,camera_name,location,server_id,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id,organizationId,userId,name,clean(input.location,120)||null,serverId,digest(token),expiresAt]);
    return{id,cameraName:name,location:clean(input.location,120)||null,serverId,expiresAt:expiresAt.toISOString(),qrPayload:`${QR_PREFIX}${token}`};
  }
  async createServerPairing(organizationId,userId,input={}){
    const name=clean(input.name,80);if(!name)throw appError('CAMERA_SERVER_NAME_REQUIRED','Server name is required',422);
    const id=uid('srvpair'),token=secret(24),expiresAt=afterMinutes(20),location=clean(input.location,120)||null;
    await this.database.query(`INSERT INTO security_camera_server_pairings(id,organization_id,created_by,name,location,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [id,organizationId,userId,name,location,digest(token),expiresAt]);
    return{id,name,location,expiresAt:expiresAt.toISOString(),pairingToken:`${SERVER_PREFIX}${token}`};
  }

  async pairDevice(input={}){
    const raw=clean(input.token||input.pairingCode||input.qrPayload,300);if(!raw)throw appError('CAMERA_PAIRING_FAILED','Pairing token is required',400);
    const token=raw.startsWith(QR_PREFIX)?raw.slice(QR_PREFIX.length):raw, tokenHash=digest(token);
    return this.database.transaction(async tx=>{
      const claimed=await tx.query(`UPDATE security_camera_pairings SET consumed_at=now() WHERE id=(SELECT id FROM security_camera_pairings WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,[tokenHash]);
      const pairing=claimed.rows[0];if(!pairing)throw appError('CAMERA_PAIRING_FAILED','This camera pairing QR code is invalid, expired or already used',400);
      const deviceId=uid('cam'),credential=secret(32),now=new Date();
      await tx.query(`INSERT INTO security_cameras(id,organization_id,server_id,name,location,status,credential_hash,device_model,platform,app_version,capabilities_json,paired_at,last_seen_at)
        VALUES($1,$2,$3,$4,$5,'online',$6,$7,$8,$9,$10,$11,$11)`,
        [deviceId,pairing.organization_id,pairing.server_id,pairing.camera_name,pairing.location,digest(credential),clean(input.deviceModel,120)||null,clean(input.platform,40)||'android',clean(input.appVersion,40)||null,JSON.stringify(Array.isArray(input.capabilities)?input.capabilities.slice(0,30):[]),now]);
      return{deviceId,credential,name:pairing.camera_name,location:pairing.location,serverId:pairing.server_id,organizationId:pairing.organization_id,status:'online'};
    });
  }
  async pairServer(input={}){
    const raw=clean(input.token||input.pairingCode,300);if(!raw)throw appError('CAMERA_SERVER_PAIRING_FAILED','Server pairing token is required',400);
    const token=raw.startsWith(SERVER_PREFIX)?raw.slice(SERVER_PREFIX.length):raw, tokenHash=digest(token);
    return this.database.transaction(async tx=>{
      const claimed=await tx.query(`UPDATE security_camera_server_pairings SET consumed_at=now() WHERE id=(SELECT id FROM security_camera_server_pairings WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,[tokenHash]);
      const pairing=claimed.rows[0];if(!pairing)throw appError('CAMERA_SERVER_PAIRING_FAILED','Server pairing token is invalid, expired or already used',400);
      const serverId=uid('camsrv'),credential=secret(32),now=new Date();
      await tx.query(`INSERT INTO security_camera_servers(id,organization_id,name,location,status,local_base_url,credential_hash,capabilities_json,hostname,app_version,paired_at,last_seen_at)
        VALUES($1,$2,$3,$4,'online',$5,$6,$7,$8,$9,$10,$10)`,
        [serverId,pairing.organization_id,pairing.name,pairing.location,clean(input.localBaseUrl,500)||null,digest(credential),JSON.stringify(Array.isArray(input.capabilities)?input.capabilities.slice(0,40):[]),clean(input.hostname,120)||null,clean(input.appVersion||input.version,40)||null,now]);
      return{serverId,credential,organizationId:pairing.organization_id,name:pairing.name,location:pairing.location,status:'online'};
    });
  }

  async authenticateDevice(deviceId,credential){
    const row=await this.one(`SELECT * FROM security_cameras WHERE id=$1 AND revoked_at IS NULL`,[deviceId]);
    if(!row||!credential||!equalDigest(row.credential_hash,digest(credential)))throw appError('CAMERA_AUTH_FAILED','Camera credentials are invalid or revoked',401);
    return row;
  }
  async authenticateServer(serverId,credential){
    const row=await this.one(`SELECT * FROM security_camera_servers WHERE id=$1`,[serverId]);
    if(!row||!credential||!equalDigest(row.credential_hash,digest(credential)))throw appError('CAMERA_SERVER_AUTH_FAILED','Camera server credentials are invalid',401);
    return row;
  }

  async deviceHealth(device,credential){const camera=typeof device==='string'?await this.authenticateDevice(device,credential):device;const now=new Date();await this.database.query(`UPDATE security_cameras SET status='online',last_seen_at=$1 WHERE id=$2`,[now,camera.id]);return{deviceId:camera.id,status:'online',serverTime:now.toISOString()};}
  async deviceConfig(camera){
    const server=camera.server_id?await this.one(`SELECT id,name,local_base_url,status,last_seen_at FROM security_camera_servers WHERE id=$1 AND organization_id=$2`,[camera.server_id,camera.organization_id]):null;
    const ingest=server?.local_base_url?`${String(server.local_base_url).replace(/\/$/,'')}/v1/ingest/${camera.id}/segments`:null;
    const profile=await this.profile(camera);
    return{device:{id:camera.id,name:camera.name,location:camera.location,organizationId:camera.organization_id},
      capture:{preferredFacing:profile.preferred_facing,width:profile.width,height:profile.height,fps:profile.fps,bitrateKbps:profile.bitrate_kbps,segmentSeconds:profile.segment_seconds},
      transport:{mode:'local-nvr',server:server?{id:server.id,name:server.name,localBaseUrl:server.local_base_url,status:server.status}:null,protocol:ingest?'mp4-segment-upload':'unassigned',ingestUrl:ingest},
      recording:{enabled:Boolean(camera.recording_enabled)}};
  }
  async profile(camera){return await this.one(`SELECT preferred_facing,width,height,fps,bitrate_kbps,segment_seconds,retention_days,audio_enabled,motion_enabled,updated_at FROM security_camera_profiles WHERE camera_id=$1 AND organization_id=$2`,[camera.id,camera.organization_id])??{preferred_facing:'back',width:1280,height:720,fps:15,bitrate_kbps:1200,segment_seconds:20,retention_days:30,audio_enabled:false,motion_enabled:false,updated_at:null};}
  async deviceProfile(camera){const p=await this.profile(camera);return{...p,audio_enabled:legacyBool(p.audio_enabled),motion_enabled:legacyBool(p.motion_enabled)};}
  async deviceStreamConfig(camera,credential){
    const server=camera.server_id?await this.one(`SELECT id,name,local_base_url,webrtc_base_url,webrtc_public_base_url,media_status,media_last_seen_at FROM security_camera_servers WHERE id=$1 AND organization_id=$2`,[camera.server_id,camera.organization_id]):null;
    const media=clean(server?.webrtc_base_url,500).replace(/\/$/,'');
    return{enabled:Boolean(media&&camera.recording_enabled),cameraId:camera.id,streamPath:camera.id,whipUrl:media?`${media}/${camera.id}/whip`:null,publishToken:credential,
      server:server?{id:server.id,name:server.name,mediaStatus:server.media_status,webrtcBaseUrl:server.webrtc_base_url}:null,iceServers:DEFAULT_ICE,
      fallbackIngestUrl:server?.local_base_url?`${String(server.local_base_url).replace(/\/$/,'')}/v1/ingest/${camera.id}/segments`:null};
  }
  async updateDeviceStreamState(camera,input={}){const status=['online','connecting','offline','failed'].includes(clean(input.status,24))?clean(input.status,24):'offline',now=new Date();await this.database.query(`UPDATE security_cameras SET stream_status=$1,last_stream_at=CASE WHEN $1='online' THEN $2 ELSE last_stream_at END,last_seen_at=$2 WHERE id=$3`,[status,now,camera.id]);return{ok:true,status,serverTime:now.toISOString()};}
  async deviceDiagnostics(camera,input={}){
    const b=v=>v==null?null:Boolean(v), n=v=>Number.isFinite(Number(v))?Number(v):null, now=new Date();
    await this.database.query(`UPDATE security_cameras SET charging=COALESCE($1,charging),thermal_status=COALESCE($2,thermal_status),device_owner=COALESCE($3,device_owner),appliance_running=COALESCE($4,appliance_running),wake_lock=COALESCE($5,wake_lock),pending_segments=COALESCE($6,pending_segments),spool_bytes=COALESCE($7,spool_bytes),spool_free_bytes=COALESCE($8,spool_free_bytes),buffer_pressure=COALESCE($9,buffer_pressure),diagnostics_updated_at=$10,last_seen_at=$10 WHERE id=$11`,
      [b(input.charging),n(input.thermalStatus),b(input.deviceOwner),b(input.applianceRunning),b(input.wakeLock),n(input.pendingSegments),n(input.spoolBytes),n(input.spoolFreeBytes),n(input.bufferPressure),now,camera.id]);
    return{ok:true,serverTime:now.toISOString()};
  }
  async deviceHeartbeat(camera,input={}){
    const n=v=>Number.isFinite(Number(v))?Number(v):null,now=new Date();
    await this.database.query(`UPDATE security_cameras SET status='online',last_seen_at=$1,battery_level=COALESCE($2,battery_level),temperature_c=COALESCE($3,temperature_c),wifi_strength=COALESCE($4,wifi_strength),app_version=COALESCE($5,app_version),device_model=COALESCE($6,device_model) WHERE id=$7`,
      [now,n(input.batteryLevel),n(input.temperatureC),n(input.wifiStrength),clean(input.appVersion,40)||null,clean(input.deviceModel,120)||null,camera.id]);
    return{ok:true,serverId:camera.server_id,serverAssigned:Boolean(camera.server_id),serverTime:now.toISOString()};
  }

  async serverHeartbeat(server,input={}){
    const now=new Date(),total=Math.max(0,Number(input.storageTotalBytes)||0),free=Math.max(0,Number(input.storageFreeBytes)||0),base=clean(input.localBaseUrl,500)||server.local_base_url||null;
    await this.database.query(`UPDATE security_camera_servers SET status='online',last_seen_at=$1,storage_total_bytes=$2,storage_free_bytes=$3,local_base_url=$4,hostname=COALESCE($5,hostname),app_version=COALESCE($6,app_version) WHERE id=$7`,
      [now,total,free,base,clean(input.hostname,120)||null,clean(input.appVersion||input.version,40)||null,server.id]);
    return{ok:true,serverTime:now.toISOString()};
  }
  async serverMedia(server,input={}){
    const now=new Date(),local=clean(input.webrtcBaseUrl,500).replace(/\/$/,''),pub=clean(input.webrtcPublicBaseUrl,500).replace(/\/$/,''),status=clean(input.status,24)||'online';
    await this.database.query(`UPDATE security_camera_servers SET webrtc_base_url=COALESCE(NULLIF($1,''),webrtc_base_url),webrtc_public_base_url=COALESCE(NULLIF($2,''),webrtc_public_base_url),media_status=$3,media_last_seen_at=$4 WHERE id=$5`,[local,pub,status,now,server.id]);
    return{ok:true,status,serverTime:now.toISOString(),webrtcBaseUrl:local||server.webrtc_base_url||null,webrtcPublicBaseUrl:pub||server.webrtc_public_base_url||null};
  }
  async serverConfig(server){
    const cameras=await this.rows(`SELECT id,name,location,credential_hash,recording_enabled,last_seen_at FROM security_cameras WHERE organization_id=$1 AND server_id=$2 AND revoked_at IS NULL ORDER BY name`,[server.organization_id,server.id]);
    const live=await this.rows(`SELECT id,camera_id,status,signaling_key,expires_at,offer_sdp,answer_sdp,ice_json FROM security_camera_live_sessions WHERE organization_id=$1 AND status IN ('requested','signaling','connected') AND expires_at>now() ORDER BY created_at`,[server.organization_id]);
    return{server:{id:server.id,organizationId:server.organization_id,name:server.name},cameras:cameras.map(r=>({id:r.id,name:r.name,location:r.location,credentialHash:r.credential_hash,recordingEnabled:Boolean(r.recording_enabled),lastSeenAt:r.last_seen_at})),liveSessions:live};
  }
  async serverOperations(server){
    const profiles=await this.rows(`SELECT p.* FROM security_camera_profiles p JOIN security_cameras c ON c.id=p.camera_id WHERE p.organization_id=$1 AND c.server_id=$2 AND c.revoked_at IS NULL`,[server.organization_id,server.id]);
    const grants=await this.rows(`SELECT id,camera_id,kind,token,payload_json,expires_at FROM security_camera_access_grants WHERE organization_id=$1 AND server_id=$2 AND expires_at>now() ORDER BY created_at`,[server.organization_id,server.id]);
    const updatePolicy=await this.one(`SELECT desired_version,update_channel,auto_update_enabled,maintenance_start,maintenance_end,requested_at,updated_at FROM security_camera_server_update_policies WHERE server_id=$1 AND organization_id=$2`,[server.id,server.organization_id]);
    return{profiles:profiles.map(p=>({...p,audio_enabled:legacyBool(p.audio_enabled),motion_enabled:legacyBool(p.motion_enabled)})),grants:grants.map(g=>({...g,payload:safeJson(g.payload_json,{})})),updatePolicy:updatePolicy?{...updatePolicy,auto_update_enabled:legacyBool(updatePolicy.auto_update_enabled)}:null};
  }
  async serverEventConfig(server){
    const cameras=await this.rows(`SELECT id FROM security_cameras WHERE organization_id=$1 AND server_id=$2 AND revoked_at IS NULL`,[server.organization_id,server.id]), ids=cameras.map(r=>r.id);
    const [zones,schedules,rules,incidents]=await Promise.all([
      this.rows(`SELECT * FROM security_camera_zones WHERE organization_id=$1 AND camera_id=ANY($2::text[]) AND enabled=true ORDER BY camera_id,name`,[server.organization_id,ids]),
      this.rows(`SELECT * FROM security_camera_schedules WHERE organization_id=$1 AND enabled=true AND (camera_id IS NULL OR camera_id=ANY($2::text[])) ORDER BY name`,[server.organization_id,ids]),
      this.rows(`SELECT * FROM security_camera_event_rules WHERE organization_id=$1 AND enabled=true AND (camera_id IS NULL OR camera_id=ANY($2::text[])) ORDER BY name`,[server.organization_id,ids]),
      this.rows(`SELECT id,camera_id,event_id,from_at,to_at,status FROM security_camera_incidents WHERE organization_id=$1 AND status='open' AND camera_id=ANY($2::text[])`,[server.organization_id,ids])
    ]);
    return{zones:zones.map(x=>({...x,enabled:legacyBool(x.enabled),polygon:safeJson(x.polygon_json,[])})),schedules:schedules.map(x=>({...x,enabled:legacyBool(x.enabled),days:safeJson(x.days_json,[])})),rules:rules.map(x=>({...x,protect_clip:legacyBool(x.protect_clip),create_alert:legacyBool(x.create_alert),enabled:legacyBool(x.enabled)})),incidents};
  }
  async serverForensicsConfig(server){return{holds:await this.rows(`SELECT h.id,h.camera_id,h.from_at,h.to_at,h.reason,h.incident_id FROM security_camera_legal_holds h JOIN security_cameras c ON c.id=h.camera_id WHERE h.organization_id=$1 AND h.status='active' AND c.server_id=$2 AND c.revoked_at IS NULL ORDER BY h.from_at`,[server.organization_id,server.id])};}

  async syncRecordings(server,input={}){
    const items=Array.isArray(input.recordings)?input.recordings.slice(0,500):[];let synced=0,chainBroken=0;
    for(const item of items){
      const cameraId=clean(item.cameraId,120),localPath=clean(item.localPath,1000);if(!cameraId||!localPath)continue;
      if(!await this.one(`SELECT id FROM security_cameras WHERE id=$1 AND organization_id=$2 AND server_id=$3 AND revoked_at IS NULL`,[cameraId,server.organization_id,server.id]))continue;
      const startedAt=clean(item.startedAt,64)||new Date().toISOString(),recordingId=clean(item.id,180)||uid('rec'),content=sha(item.contentSha256),previous=sha(item.previousChainSha256),chain=sha(item.chainSha256);
      const prior=await this.one(`SELECT chain_sha256 FROM security_camera_recordings WHERE organization_id=$1 AND camera_id=$2 AND started_at<$3 AND chain_sha256 IS NOT NULL ORDER BY started_at DESC LIMIT 1`,[server.organization_id,cameraId,startedAt]);
      const broken=Boolean(previous&&prior?.chain_sha256&&previous!==prior.chain_sha256),integrity=broken?'chain_broken':content?'accepted':'unverified';if(broken)chainBroken++;
      await this.database.query(`INSERT INTO security_camera_recordings(id,organization_id,camera_id,server_id,started_at,ended_at,local_path,size_bytes,protected,status,content_sha256,previous_chain_sha256,chain_sha256,integrity_status,integrity_computed_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,CASE WHEN $11 IS NOT NULL THEN now() END)
        ON CONFLICT(server_id,camera_id,local_path) DO UPDATE SET ended_at=excluded.ended_at,size_bytes=excluded.size_bytes,protected=excluded.protected,status=excluded.status,content_sha256=COALESCE(excluded.content_sha256,security_camera_recordings.content_sha256),previous_chain_sha256=COALESCE(excluded.previous_chain_sha256,security_camera_recordings.previous_chain_sha256),chain_sha256=COALESCE(excluded.chain_sha256,security_camera_recordings.chain_sha256),integrity_status=excluded.integrity_status,integrity_computed_at=excluded.integrity_computed_at`,
        [recordingId,server.organization_id,cameraId,server.id,startedAt,clean(item.endedAt,64)||null,localPath,Math.max(0,Number(item.sizeBytes)||0),Boolean(item.protected),clean(item.status,32)||'complete',content,previous,chain,integrity]);
      const actual=await this.one(`SELECT id FROM security_camera_recordings WHERE server_id=$1 AND camera_id=$2 AND local_path=$3`,[server.id,cameraId,localPath]);
      if(content||previous||chain)await this.database.query(`INSERT INTO security_camera_recording_integrity_checks(id,organization_id,recording_id,camera_id,server_id,expected_sha256,observed_sha256,expected_previous_chain_sha256,observed_previous_chain_sha256,observed_chain_sha256,status) VALUES($1,$2,$3,$4,$5,$6,$6,$7,$7,$8,$9)`,
        [uid('integrity'),server.organization_id,actual.id,cameraId,server.id,content,previous,chain,integrity]);
      await this.database.query(`UPDATE security_cameras SET last_recording_at=$1 WHERE id=$2`,[startedAt,cameraId]);synced++;
    }
    return{ok:true,synced,chainBroken};
  }
  async syncEvents(server,input={}){
    const items=Array.isArray(input.events)?input.events.slice(0,250):[];let synced=0;
    for(const item of items){
      const cameraId=clean(item.cameraId,120),type=clean(item.eventType,60),started=clean(item.startedAt,64)||new Date().toISOString();if(!cameraId||!type)continue;
      if(!await this.one(`SELECT id FROM security_cameras WHERE id=$1 AND organization_id=$2 AND server_id=$3 AND revoked_at IS NULL`,[cameraId,server.organization_id,server.id]))continue;
      const requestedRecording=clean(item.recordingId,180)||null;
      const recordingId=requestedRecording&&await this.one(`SELECT id FROM security_camera_recordings WHERE id=$1 AND organization_id=$2 AND camera_id=$3`,[requestedRecording,server.organization_id,cameraId])?requestedRecording:null;
      const rules=await this.rows(`SELECT r.*,s.days_json,s.start_time,s.end_time,s.timezone FROM security_camera_event_rules r LEFT JOIN security_camera_schedules s ON s.id=r.schedule_id WHERE r.organization_id=$1 AND r.enabled=true AND r.event_type=$2 AND (r.camera_id IS NULL OR r.camera_id=$3)`,[server.organization_id,type,cameraId]);
      const confidence=Number.isFinite(Number(item.confidence))?Number(item.confidence):null,zoneId=clean(item.zoneId,120)||null;
      const matching=rules.filter(rule=>(confidence==null||confidence>=Number(rule.min_confidence||0))&&inSchedule(rule,started)&&(!rule.zone_id||rule.zone_id===zoneId));
      const rank={critical:3,warning:2,info:1},ruleSeverity=[...matching].sort((a,b)=>(rank[b.severity]||0)-(rank[a.severity]||0))[0]?.severity;
      const severity=ruleSeverity||(['info','warning','critical'].includes(item.severity)?item.severity:'info'),protectedFlag=matching.some(rule=>rule.protect_clip)||Boolean(item.protected),id=clean(item.id,180)||uid('camevent');
      await this.database.query(`INSERT INTO security_camera_events(id,organization_id,camera_id,server_id,event_type,severity,confidence,source,started_at,ended_at,zone_id,recording_id,snapshot_path,protected,status,metadata_json)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'open',$15)
        ON CONFLICT(id) DO UPDATE SET ended_at=excluded.ended_at,severity=excluded.severity,confidence=excluded.confidence,recording_id=COALESCE(excluded.recording_id,security_camera_events.recording_id),snapshot_path=COALESCE(excluded.snapshot_path,security_camera_events.snapshot_path),protected=(security_camera_events.protected OR excluded.protected),metadata_json=excluded.metadata_json`,
        [id,server.organization_id,cameraId,server.id,type,severity,confidence,clean(item.source,80)||'nvr',started,clean(item.endedAt,64)||null,zoneId,recordingId,clean(item.snapshotPath,1000)||null,protectedFlag,JSON.stringify(item.metadata||{})]);
      if(matching.some(rule=>rule.create_alert)){const message=clean(item.message,500)||`${type} detected`;await this.database.query(`INSERT INTO security_camera_alerts(id,organization_id,camera_id,server_id,alert_type,severity,status,message,details_json,first_seen_at,last_seen_at) VALUES($1,$2,$3,$4,$5,$6,'open',$7,$8,$9,$9) ON CONFLICT(id) DO UPDATE SET severity=excluded.severity,message=excluded.message,last_seen_at=excluded.last_seen_at,status='open',resolved_at=NULL`,[`${id}:event-alert`,server.organization_id,cameraId,server.id,`event_${type}`,severity,message,JSON.stringify({eventId:id}),started]);}
      synced++;
    }return{ok:true,synced};
  }
  async syncOperations(server,input={}){
    const org=server.organization_id,now=new Date(),runtime=input.runtime||{};
    const finite=value=>Number.isFinite(Number(value))?Number(value):null;
    await this.database.query(`INSERT INTO security_camera_server_runtime(server_id,organization_id,public_control_base_url,cpu_percent,memory_percent,uptime_seconds,active_streams,active_viewers,last_error,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(server_id) DO UPDATE SET public_control_base_url=excluded.public_control_base_url,cpu_percent=excluded.cpu_percent,memory_percent=excluded.memory_percent,uptime_seconds=excluded.uptime_seconds,active_streams=excluded.active_streams,active_viewers=excluded.active_viewers,last_error=excluded.last_error,updated_at=excluded.updated_at`,
      [server.id,org,clean(runtime.publicControlBaseUrl,500)||null,finite(runtime.cpuPercent),finite(runtime.memoryPercent),Math.max(0,finite(runtime.uptimeSeconds)||0),Math.max(0,finite(runtime.activeStreams)||0),Math.max(0,finite(runtime.activeViewers)||0),clean(runtime.lastError,500)||null,now]);
    for(const v of Array.isArray(input.volumes)?input.volumes.slice(0,32):[]){const key=clean(v.key,80);if(!key)continue;await this.database.query(`INSERT INTO security_camera_server_volumes(id,organization_id,server_id,volume_key,label,path,priority,total_bytes,free_bytes,status,last_seen_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(server_id,volume_key) DO UPDATE SET label=excluded.label,path=excluded.path,priority=excluded.priority,total_bytes=excluded.total_bytes,free_bytes=excluded.free_bytes,status=excluded.status,last_seen_at=excluded.last_seen_at`,[`${server.id}:${key}`,org,server.id,key,clean(v.label,120)||key,clean(v.path,1000),Number(v.priority)||100,Math.max(0,Number(v.totalBytes)||0),Math.max(0,Number(v.freeBytes)||0),clean(v.status,32)||'online',now]);}
    const activeRuntimeIds=new Set();
    for(const alert of Array.isArray(input.alerts)?input.alerts.slice(0,100):[]){const type=clean(alert.type,80),message=clean(alert.message,500);if(!type||!message)continue;const cameraId=clean(alert.cameraId,120)||null,severity=['info','warning','critical'].includes(alert.severity)?alert.severity:'warning',id=clean(alert.id,180)||`${server.id}:${type}:${cameraId||'server'}`;activeRuntimeIds.add(id);await this.database.query(`INSERT INTO security_camera_alerts(id,organization_id,camera_id,server_id,alert_type,severity,status,message,details_json,first_seen_at,last_seen_at) VALUES($1,$2,$3,$4,$5,$6,'open',$7,$8,$9,$9) ON CONFLICT(id) DO UPDATE SET severity=excluded.severity,message=excluded.message,details_json=excluded.details_json,last_seen_at=excluded.last_seen_at,status=CASE WHEN security_camera_alerts.status='resolved' THEN 'open' ELSE security_camera_alerts.status END,resolved_at=NULL`,[id,org,cameraId,server.id,type,severity,message,JSON.stringify(alert.details||{}),now]);}
    const prior=await this.rows(`SELECT id FROM security_camera_alerts WHERE organization_id=$1 AND server_id=$2 AND status<>'resolved' AND (id LIKE 'camera:%' OR id LIKE 'volume:%')`,[org,server.id]);for(const row of prior)if(!activeRuntimeIds.has(row.id))await this.database.query(`UPDATE security_camera_alerts SET status='resolved',resolved_at=$1,last_seen_at=$1 WHERE id=$2`,[now,row.id]);
    for(const e of Array.isArray(input.exports)?input.exports.slice(0,100):[]){const id=clean(e.id,180);if(!id)continue;const status=clean(e.status,32)||'processing';await this.database.query(`UPDATE security_camera_exports SET status=$1,local_path=COALESCE($2,local_path),size_bytes=COALESCE($3,size_bytes),error_message=COALESCE($4,error_message),completed_at=CASE WHEN $1 IN ('complete','failed') THEN now() ELSE completed_at END WHERE id=$5 AND organization_id=$6 AND server_id=$7`,[status,clean(e.localPath,1000)||null,Number.isFinite(Number(e.sizeBytes))?Number(e.sizeBytes):null,clean(e.error,500)||null,id,org,server.id]);}
    return{ok:true,serverTime:now.toISOString()};
  }
  async recordValidation(server,input={}){
    const id=clean(input.id,180)||uid('camval');
    await this.database.query(`INSERT INTO security_camera_validation_runs(id,organization_id,server_id,camera_id,check_type,status,message,details_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id,server.organization_id,server.id,clean(input.cameraId,120)||null,clean(input.checkType,120)||'self_validation',clean(input.status,40)||'unknown',clean(input.message,1000)||null,JSON.stringify(input.details||{})]);
    return{id,serverId:server.id,status:clean(input.status,40)||'unknown'};
  }
  async recordBackup(server,input={}){
    await this.database.query(`INSERT INTO security_camera_backup_status(server_id,organization_id,enabled,status,pending_files,pending_bytes,oldest_pending_at,lag_seconds,copied_files,copied_bytes,last_success_at,last_error,last_reported_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now(),now()) ON CONFLICT(server_id) DO UPDATE SET enabled=excluded.enabled,status=excluded.status,pending_files=excluded.pending_files,pending_bytes=excluded.pending_bytes,oldest_pending_at=excluded.oldest_pending_at,lag_seconds=excluded.lag_seconds,copied_files=excluded.copied_files,copied_bytes=excluded.copied_bytes,last_success_at=excluded.last_success_at,last_error=excluded.last_error,last_reported_at=now(),updated_at=now()`,
      [server.id,server.organization_id,Boolean(input.enabled),clean(input.status,32)||'disabled',Math.max(0,Number(input.pendingFiles)||0),Math.max(0,Number(input.pendingBytes)||0),clean(input.oldestPendingAt,64)||null,Math.max(0,Number(input.lagSeconds)||0),Math.max(0,Number(input.copiedFiles)||0),Math.max(0,Number(input.copiedBytes)||0),clean(input.lastSuccessAt,64)||null,clean(input.lastError,1000)||null]);
    return{ok:true,serverId:server.id};
  }
  async finalizeExport(server,exportId,input={}){
    const observed=sha(input.contentSha256);if(!observed)throw appError('CAMERA_FORENSIC_EXPORT_FAILED','A valid export SHA-256 is required',400);
    const row=await this.one(`SELECT e.id,e.organization_id,e.camera_id,m.manifest_sha256 FROM security_camera_exports e JOIN security_camera_export_manifests m ON m.export_id=e.id WHERE e.id=$1 AND e.organization_id=$2 AND e.server_id=$3`,[exportId,server.organization_id,server.id]);
    if(!row)throw appError('CAMERA_FORENSIC_EXPORT_FAILED','Forensic export was not found',404);
    await this.database.transaction(async tx=>{await tx.query(`UPDATE security_camera_exports SET content_sha256=$1,integrity_status='verified' WHERE id=$2`,[observed,exportId]);await tx.query(`UPDATE security_camera_export_manifests SET verification_status='verified',verified_at=now() WHERE export_id=$1`,[exportId]);await tx.query(`INSERT INTO security_camera_custody_log(id,organization_id,evidence_type,evidence_id,action,actor_user_id,details_json) VALUES($1,$2,'export',$3,'nvr_hash_reported',NULL,$4)`,[uid('custody'),row.organization_id,exportId,JSON.stringify({serverId:server.id,contentSha256:observed,manifestSha256:row.manifest_sha256})]);});
    return{ok:true,exportId,contentSha256:observed,integrityStatus:'verified'};
  }

  async overview(organizationId){
    const [c,s,r,l]=await Promise.all([
      this.one(`SELECT count(*)::int total,count(*) FILTER(WHERE status='online' AND revoked_at IS NULL AND last_seen_at>=now()-interval '45 seconds')::int online,count(*) FILTER(WHERE revoked_at IS NULL AND (last_seen_at IS NULL OR last_seen_at<now()-interval '45 seconds'))::int offline FROM security_cameras WHERE organization_id=$1 AND revoked_at IS NULL`,[organizationId]),
      this.one(`SELECT count(*)::int total,count(*) FILTER(WHERE status='online' AND last_seen_at>=now()-interval '60 seconds')::int online,COALESCE(sum(storage_total_bytes),0)::bigint storage_total_bytes,COALESCE(sum(storage_free_bytes),0)::bigint storage_free_bytes FROM security_camera_servers WHERE organization_id=$1`,[organizationId]),
      this.one(`SELECT count(*)::int segments,COALESCE(sum(size_bytes),0)::bigint size_bytes FROM security_camera_recordings WHERE organization_id=$1 AND status<>'deleted'`,[organizationId]),
      this.one(`SELECT count(*)::int active FROM security_camera_live_sessions WHERE organization_id=$1 AND status IN ('requested','signaling','connected') AND expires_at>now()`,[organizationId])
    ]);return{cameras:c,servers:s,recordings:r,live:l};
  }
  async listCameras(organizationId){return this.rows(`SELECT c.id,c.name,c.location,CASE WHEN c.status='online' AND (c.last_seen_at IS NULL OR c.last_seen_at<now()-interval '45 seconds') THEN 'offline' ELSE c.status END status,c.server_id,c.device_model,c.platform,c.app_version,c.battery_level,c.temperature_c,c.wifi_strength,c.last_seen_at,c.paired_at,c.recording_enabled,c.last_recording_at,c.stream_status,s.name server_name FROM security_cameras c LEFT JOIN security_camera_servers s ON s.id=c.server_id AND s.organization_id=c.organization_id WHERE c.organization_id=$1 AND c.revoked_at IS NULL ORDER BY c.name`,[organizationId]);}
  async listServers(organizationId){return this.rows(`SELECT id,name,location,CASE WHEN status='online' AND (last_seen_at IS NULL OR last_seen_at<now()-interval '60 seconds') THEN 'offline' ELSE status END status,local_base_url,storage_total_bytes,storage_free_bytes,last_seen_at,hostname,app_version,paired_at,created_at,media_status,media_last_seen_at FROM security_camera_servers WHERE organization_id=$1 ORDER BY name`,[organizationId]);}
  async listRecordings(organizationId,cameraId=null,limit=200){
    const params=[organizationId],conditions=[`r.organization_id=$1`,`r.status<>'deleted'`];if(cameraId){params.push(cameraId);conditions.push(`r.camera_id=$${params.length}`);}params.push(Math.min(1000,Math.max(1,Number(limit)||200)));
    return this.rows(`SELECT r.id,r.camera_id,r.server_id,r.started_at,r.ended_at,r.size_bytes,r.protected,r.status,r.integrity_status,c.name camera_name,s.name server_name FROM security_camera_recordings r JOIN security_cameras c ON c.id=r.camera_id LEFT JOIN security_camera_servers s ON s.id=r.server_id WHERE ${conditions.join(' AND ')} ORDER BY r.started_at DESC LIMIT $${params.length}`,params);
  }
  async listLive(organizationId){return this.rows(`SELECT l.id,l.camera_id,l.status,l.expires_at,l.ended_at,l.created_at,c.name camera_name,c.stream_status FROM security_camera_live_sessions l JOIN security_cameras c ON c.id=l.camera_id WHERE l.organization_id=$1 ORDER BY l.created_at DESC LIMIT 200`,[organizationId]);}
  async createViewerSession(organizationId,userId,cameraId){
    const row=await this.one(`SELECT c.id,c.name,c.server_id,c.stream_status,s.status server_status,s.media_status,s.webrtc_base_url,s.webrtc_public_base_url FROM security_cameras c JOIN security_camera_servers s ON s.id=c.server_id AND s.organization_id=c.organization_id WHERE c.id=$1 AND c.organization_id=$2 AND c.revoked_at IS NULL`,[cameraId,organizationId]);
    if(!row)throw appError('CAMERA_NOT_FOUND','Camera or assigned NVR was not found',404);if(row.stream_status!=='online')throw appError('CAMERA_OFFLINE','Camera live stream is not currently online',409);
    const base=clean(row.webrtc_public_base_url||row.webrtc_base_url,500).replace(/\/$/,'');if(!base)throw appError('CAMERA_MEDIA_NOT_READY','The NVR has not reported a WebRTC endpoint yet',409);
    const id=uid('live'),key=secret(24),expiresAt=afterMinutes(5),whepUrl=`${base}/${cameraId}/whep`;
    await this.database.query(`INSERT INTO security_camera_live_sessions(id,organization_id,camera_id,requested_by,status,signaling_key,expires_at,ice_json) VALUES($1,$2,$3,$4,'signaling',$5,$6,$7)`,[id,organizationId,cameraId,userId,key,expiresAt,JSON.stringify({whepUrl,transport:'whep',serverId:row.server_id})]);
    return{id,cameraId,cameraName:row.name,status:'signaling',expiresAt:expiresAt.toISOString(),whepUrl,viewerToken:key,streamStatus:row.stream_status,serverStatus:row.server_status,mediaStatus:row.media_status,iceServers:DEFAULT_ICE};
  }
  async getViewerSession(organizationId,id){const row=await this.one(`SELECT l.id,l.camera_id,l.status,l.expires_at,l.ended_at,l.ice_json,c.name camera_name,c.stream_status FROM security_camera_live_sessions l JOIN security_cameras c ON c.id=l.camera_id WHERE l.id=$1 AND l.organization_id=$2`,[id,organizationId]);if(!row)throw appError('CAMERA_LIVE_NOT_FOUND','Live session was not found',404);const meta=safeJson(row.ice_json,{});return{id:row.id,cameraId:row.camera_id,cameraName:row.camera_name,status:row.status,expiresAt:row.expires_at,endedAt:row.ended_at,streamStatus:row.stream_status,whepUrl:meta.whepUrl||null};}
  async endViewerSession(organizationId,id){const result=await this.database.query(`UPDATE security_camera_live_sessions SET status='ended',ended_at=now() WHERE id=$1 AND organization_id=$2 AND ended_at IS NULL RETURNING id`,[id,organizationId]);if(!result.rows[0])throw appError('CAMERA_LIVE_NOT_FOUND','Live session was not found or already ended',404);return{ok:true,id,status:'ended'};}
  async timeline(organizationId,cameraId,{from=null,to=null,limit=1000}={}){
    const camera=await this.one(`SELECT id,name FROM security_cameras WHERE id=$1 AND organization_id=$2 AND revoked_at IS NULL`,[cameraId,organizationId]);if(!camera)throw appError('CAMERA_NOT_FOUND','Camera was not found',404);
    const params=[organizationId,cameraId],where=[`organization_id=$1`,`camera_id=$2`,`status<>'deleted'`];if(from){params.push(from);where.push(`COALESCE(ended_at,started_at)>=$${params.length}`);}if(to){params.push(to);where.push(`started_at<=$${params.length}`);}params.push(Math.min(5000,Math.max(1,Number(limit)||1000)));
    const segments=await this.rows(`SELECT id,server_id,started_at,ended_at,size_bytes,protected,status,integrity_status FROM security_camera_recordings WHERE ${where.join(' AND ')} ORDER BY started_at ASC LIMIT $${params.length}`,params);
    let coveredMs=0;const gaps=[];for(let i=0;i<segments.length;i++){const a=Date.parse(segments[i].started_at),b=Date.parse(segments[i].ended_at||segments[i].started_at);coveredMs+=Math.max(0,b-a);if(i){const p=Date.parse(segments[i-1].ended_at||segments[i-1].started_at);if(a-p>15000)gaps.push({from:new Date(p).toISOString(),to:new Date(a).toISOString(),durationMs:a-p});}}
    return{camera,from,to,segments,gaps,coveredMs};
  }
  async playbackGrant(organizationId,userId,recordingId){
    const rec=await this.one(`SELECT r.id,r.camera_id,r.server_id,r.local_path,r.started_at,r.ended_at,c.name camera_name,s.local_base_url,rt.public_control_base_url FROM security_camera_recordings r JOIN security_cameras c ON c.id=r.camera_id JOIN security_camera_servers s ON s.id=r.server_id LEFT JOIN security_camera_server_runtime rt ON rt.server_id=s.id WHERE r.id=$1 AND r.organization_id=$2 AND r.status<>'deleted'`,[recordingId,organizationId]);
    if(!rec)throw appError('CAMERA_RECORDING_NOT_FOUND','Recording was not found',404);const base=clean(rec.public_control_base_url||rec.local_base_url,500).replace(/\/$/,'');if(!base)throw appError('CAMERA_PLAYBACK_NOT_READY','Camera server has not reported a playback address',409);
    const id=uid('grant'),token=secret(32),expiresAt=afterMinutes(10),payload={recordingId:rec.id,localPath:rec.local_path,startedAt:rec.started_at,endedAt:rec.ended_at};
    await this.database.query(`INSERT INTO security_camera_access_grants(id,organization_id,requested_by,server_id,camera_id,kind,token,payload_json,expires_at) VALUES($1,$2,$3,$4,$5,'playback',$6,$7,$8)`,[id,organizationId,userId,rec.server_id,rec.camera_id,token,JSON.stringify(payload),expiresAt]);
    return{id,kind:'playback',cameraId:rec.camera_id,cameraName:rec.camera_name,expiresAt:expiresAt.toISOString(),url:`${base}/v1/access/${token}/playback`};
  }
  async assignCamera(organizationId,cameraId,serverId=null){if(serverId&&!await this.one(`SELECT id FROM security_camera_servers WHERE id=$1 AND organization_id=$2`,[serverId,organizationId]))throw appError('CAMERA_SERVER_NOT_FOUND','Camera server was not found',404);const r=await this.database.query(`UPDATE security_cameras SET server_id=$1 WHERE id=$2 AND organization_id=$3 AND revoked_at IS NULL RETURNING id`,[serverId,cameraId,organizationId]);if(!r.rows[0])throw appError('CAMERA_NOT_FOUND','Camera was not found',404);return{ok:true,cameraId,serverId};}
  async setRecording(organizationId,cameraId,enabled){const r=await this.database.query(`UPDATE security_cameras SET recording_enabled=$1 WHERE id=$2 AND organization_id=$3 AND revoked_at IS NULL RETURNING id`,[Boolean(enabled),cameraId,organizationId]);if(!r.rows[0])throw appError('CAMERA_NOT_FOUND','Camera was not found',404);return{ok:true,cameraId,enabled:Boolean(enabled)};}
  async revokeCamera(organizationId,cameraId){const r=await this.database.query(`UPDATE security_cameras SET revoked_at=now(),status='revoked',stream_status='offline' WHERE id=$1 AND organization_id=$2 AND revoked_at IS NULL RETURNING id`,[cameraId,organizationId]);if(!r.rows[0])throw appError('CAMERA_NOT_FOUND','Camera was not found or already revoked',404);return{ok:true,cameraId,status:'revoked'};}
  async listEvents(organizationId,query={}){
    const params=[organizationId],where=[`e.organization_id=$1`];
    const add=(sql,value)=>{if(value){params.push(value);where.push(`${sql}$${params.length}`);}};
    add('e.camera_id=',query.cameraId);add('e.event_type=',query.type);add('e.status=',query.status);
    if(query.from){params.push(query.from);where.push(`e.started_at>=$${params.length}`);}
    if(query.to){params.push(query.to);where.push(`e.started_at<=$${params.length}`);}
    params.push(Math.min(1000,Math.max(1,Number(query.limit)||250)));
    const rows=await this.rows(`SELECT e.id,e.camera_id,e.server_id,e.event_type,e.severity,e.confidence,e.source,e.started_at,e.ended_at,e.zone_id,e.recording_id,e.protected,e.status,e.metadata_json,e.reviewed_by,e.reviewed_at,e.created_at,c.name camera_name,s.name server_name,z.name zone_name FROM security_camera_events e JOIN security_cameras c ON c.id=e.camera_id LEFT JOIN security_camera_servers s ON s.id=e.server_id LEFT JOIN security_camera_zones z ON z.id=e.zone_id WHERE ${where.join(' AND ')} ORDER BY e.started_at DESC LIMIT $${params.length}`,params);
    return rows.map(row=>({...row,protected:legacyBool(row.protected),metadata:safeJson(row.metadata_json,{})}));
  }

}
