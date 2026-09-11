const PREFIX='/api/v1/security-camera';
const APPLIANCE_EXACT=new Set([
 'POST server/pair','POST server/heartbeat','POST server/media','GET server/config','POST server/recordings/sync',
 'GET server/operations','POST server/operations/sync','GET server/events/config','POST server/events/sync',
 'GET server/forensics/config','POST server/validation','POST server/backup'
]);
const DEVICE_EXACT=new Set([
 'POST device/pair','GET device/health','GET device/config','GET device/stream-config','POST device/stream-state',
 'POST device/diagnostics','POST device/heartbeat','GET device/profile'
]);
const VIEWER_EXACT=new Set(['GET overview','GET cameras','GET servers','GET recordings','GET live','GET events']);
const MANAGEMENT_EXACT=new Set(['POST pairings','POST server-pairings']);
function pathParts(pathname){return pathname.slice(PREFIX.length).split('/').filter(Boolean);}
function signature(request,url){return `${request.method} ${pathParts(url.pathname).join('/')}`;}
function isAppliance(request,url){
  const parts=pathParts(url.pathname),sig=`${request.method} ${parts.join('/')}`;
  return APPLIANCE_EXACT.has(sig)||(request.method==='POST'&&parts.length===5&&parts[0]==='server'&&parts[1]==='forensics'&&parts[2]==='exports'&&parts[4]==='finalize');
}
function isDevice(request,url){const parts=pathParts(url.pathname),sig=`${request.method} ${parts.join('/')}`;return DEVICE_EXACT.has(sig)||(request.method==='POST'&&parts.length===3&&parts[0]==='device'&&parts[2]==='heartbeat');}
function isViewer(request,url){
  const parts=pathParts(url.pathname),sig=`${request.method} ${parts.join('/')}`;if(VIEWER_EXACT.has(sig))return true;
  if(request.method==='GET'&&parts.length===2&&parts[0]==='live')return true;
  if(request.method==='POST'&&parts.length===3&&parts[0]==='cameras'&&parts[2]==='live')return true;
  if(request.method==='POST'&&parts.length===3&&parts[0]==='live'&&parts[2]==='end')return true;
  if(request.method==='GET'&&parts.length===3&&parts[0]==='cameras'&&parts[2]==='timeline')return true;
  if(request.method==='POST'&&parts.length===3&&parts[0]==='recordings'&&parts[2]==='playback')return true;
  return false;
}
function isManagement(request,url){
  const parts=pathParts(url.pathname),sig=`${request.method} ${parts.join('/')}`;if(MANAGEMENT_EXACT.has(sig))return true;
  return request.method==='POST'&&parts.length===3&&parts[0]==='cameras'&&['assign','recording','revoke'].includes(parts[2]);
}
function enabledGroup(config,group){return config.extensions?.['security-camera']?.[`${group}Cutover`]==='node';}
function err(code,message,status=400){const error=new Error(message);error.code=code;error.status=status;return error;}
function data(value,status=200){return{status,body:{data:value}};}
async function body(request,limit=2*1024*1024){let total=0;const chunks=[];for await(const chunk of request){total+=chunk.length;if(total>limit)throw err('REQUEST_TOO_LARGE','Request body is too large',413);chunks.push(chunk);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw err('INVALID_JSON','Request body must be valid JSON',400);}}
function serverAuth(request){const raw=String(request.headers.authorization||''),match=/^Server\s+([^\.\s]+)\.([^\s]+)$/.exec(raw);return{id:match?.[1]||'',credential:match?.[2]||''};}
function deviceAuth(request,parts){const raw=String(request.headers.authorization||''),match=/^Device\s+([^\.\s]+)\.([^\s]+)$/.exec(raw);if(match)return{id:match[1],credential:match[2]};const id=parts[1]&&parts[2]==='heartbeat'?parts[1]:'';const credential=String(request.headers['x-camera-credential']||raw.replace(/^Bearer\s+/i,'')).trim();return{id,credential};}
const SCOPE_COMPAT=Object.freeze({
  'security:read':['security:read','school:read','school:write'],
  'security:live':['security:live','security:manage','school:write'],
  'security:manage':['security:manage','school:write'],
});
async function principal(runtime,request,scope){
  const p=await runtime.auth.authenticateRequest({headers:request.headers});if(p?.role==='owner'||p?.role==='admin')return p;
  const granted=new Set(Array.isArray(p?.scopes)?p.scopes:[]),accepted=SCOPE_COMPAT[scope]||[scope];if(granted.has('*')||accepted.some(value=>granted.has(value)))return p;
  throw err('FORBIDDEN',`Missing required security scope: ${scope}`,403);
}

export const securityCameraRouteMatcher=Object.freeze({isAppliance,isDevice,isViewer,isManagement});
export default{
  name:'security-camera-selfhost',prefix:PREFIX,business:true,priority:120,
  enabled(config){const c=config.extensions?.['security-camera'];return Boolean(c&&['appliance','device','viewer','management'].some(group=>c[`${group}Cutover`]==='node'));},
  matches({request,url,config}){return (enabledGroup(config,'appliance')&&isAppliance(request,url))||(enabledGroup(config,'device')&&isDevice(request,url))||(enabledGroup(config,'viewer')&&isViewer(request,url))||(enabledGroup(config,'management')&&isManagement(request,url));},
  async handle({request,url,runtime}){
    const service=runtime.extensions?.['security-camera']?.node;if(!service)throw err('SECURITY_CAMERA_SELFHOST_NOT_READY','Security camera self-hosted runtime is not ready',503);
    const parts=pathParts(url.pathname);
    if(isAppliance(request,url)){
      if(request.method==='POST'&&parts.join('/')==='server/pair')return data(await service.pairServer(await body(request)),201);
      const a=serverAuth(request),server=await service.authenticateServer(a.id,a.credential);
      if(request.method==='POST'&&parts.join('/')==='server/heartbeat')return data(await service.serverHeartbeat(server,await body(request)));
      if(request.method==='POST'&&parts.join('/')==='server/media')return data(await service.serverMedia(server,await body(request)));
      if(request.method==='GET'&&parts.join('/')==='server/config')return data(await service.serverConfig(server));
      if(request.method==='POST'&&parts.join('/')==='server/recordings/sync')return data(await service.syncRecordings(server,await body(request)));
      if(request.method==='GET'&&parts.join('/')==='server/operations')return data(await service.serverOperations(server));
      if(request.method==='POST'&&parts.join('/')==='server/operations/sync')return data(await service.syncOperations(server,await body(request)));
      if(request.method==='GET'&&parts.join('/')==='server/events/config')return data(await service.serverEventConfig(server));
      if(request.method==='POST'&&parts.join('/')==='server/events/sync')return data(await service.syncEvents(server,await body(request)));
      if(request.method==='GET'&&parts.join('/')==='server/forensics/config')return data(await service.serverForensicsConfig(server));
      if(request.method==='POST'&&parts.join('/')==='server/validation')return data(await service.recordValidation(server,await body(request)),201);
      if(request.method==='POST'&&parts.join('/')==='server/backup')return data(await service.recordBackup(server,await body(request)));
      if(request.method==='POST'&&parts.length===5&&parts[0]==='server'&&parts[1]==='forensics'&&parts[2]==='exports'&&parts[4]==='finalize')return data(await service.finalizeExport(server,parts[3],await body(request)));
    }
    if(isDevice(request,url)){
      if(request.method==='POST'&&parts.join('/')==='device/pair')return data(await service.pairDevice(await body(request)),201);
      const a=deviceAuth(request,parts),camera=await service.authenticateDevice(a.id,a.credential);
      if(request.method==='GET'&&parts.join('/')==='device/health')return data(await service.deviceHealth(camera,a.credential));
      if(request.method==='GET'&&parts.join('/')==='device/config')return data(await service.deviceConfig(camera));
      if(request.method==='GET'&&parts.join('/')==='device/stream-config')return data(await service.deviceStreamConfig(camera,a.credential));
      if(request.method==='POST'&&parts.join('/')==='device/stream-state')return data(await service.updateDeviceStreamState(camera,await body(request)));
      if(request.method==='POST'&&parts.join('/')==='device/diagnostics')return data(await service.deviceDiagnostics(camera,await body(request)));
      if(request.method==='GET'&&parts.join('/')==='device/profile')return data(await service.deviceProfile(camera));
      if(request.method==='POST'&&(parts.join('/')==='device/heartbeat'||(parts.length===3&&parts[0]==='device'&&parts[2]==='heartbeat')))return data(await service.deviceHeartbeat(camera,await body(request)));
    }
    if(isViewer(request,url)){
      const p=await principal(runtime,request,(request.method==='POST'&&(parts[2]==='live'||parts[0]==='live'))?'security:live':'security:read');
      if(request.method==='GET'&&parts.join('/')==='overview')return data(await service.overview(p.organizationId));
      if(request.method==='GET'&&parts.join('/')==='cameras')return data(await service.listCameras(p.organizationId));
      if(request.method==='GET'&&parts.join('/')==='servers')return data(await service.listServers(p.organizationId));
      if(request.method==='GET'&&parts.join('/')==='recordings')return data(await service.listRecordings(p.organizationId,url.searchParams.get('cameraId'),url.searchParams.get('limit')));
      if(request.method==='GET'&&parts.join('/')==='live')return data(await service.listLive(p.organizationId));
      if(request.method==='GET'&&parts.join('/')==='events')return data(await service.listEvents(p.organizationId,Object.fromEntries(url.searchParams.entries())));
      if(request.method==='GET'&&parts.length===2&&parts[0]==='live')return data(await service.getViewerSession(p.organizationId,parts[1]));
      if(request.method==='POST'&&parts.length===3&&parts[0]==='cameras'&&parts[2]==='live')return data(await service.createViewerSession(p.organizationId,p.userId,parts[1]),201);
      if(request.method==='POST'&&parts.length===3&&parts[0]==='live'&&parts[2]==='end')return data(await service.endViewerSession(p.organizationId,parts[1]));
      if(request.method==='GET'&&parts.length===3&&parts[0]==='cameras'&&parts[2]==='timeline')return data(await service.timeline(p.organizationId,parts[1],{from:url.searchParams.get('from'),to:url.searchParams.get('to'),limit:url.searchParams.get('limit')}));
      if(request.method==='POST'&&parts.length===3&&parts[0]==='recordings'&&parts[2]==='playback')return data(await service.playbackGrant(p.organizationId,p.userId,parts[1]),201);
    }
    if(isManagement(request,url)){
      const p=await principal(runtime,request,'security:manage');
      if(request.method==='POST'&&parts.join('/')==='pairings')return data(await service.createPairing(p.organizationId,p.userId,await body(request)),201);
      if(request.method==='POST'&&parts.join('/')==='server-pairings')return data(await service.createServerPairing(p.organizationId,p.userId,await body(request)),201);
      if(request.method==='POST'&&parts.length===3&&parts[0]==='cameras'&&parts[2]==='assign'){const b=await body(request);return data(await service.assignCamera(p.organizationId,parts[1],cleanId(b.serverId)));}
      if(request.method==='POST'&&parts.length===3&&parts[0]==='cameras'&&parts[2]==='recording'){const b=await body(request);return data(await service.setRecording(p.organizationId,parts[1],b.enabled!==false));}
      if(request.method==='POST'&&parts.length===3&&parts[0]==='cameras'&&parts[2]==='revoke')return data(await service.revokeCamera(p.organizationId,parts[1]));
    }
    throw err('SECURITY_CAMERA_ROUTE_NOT_FOUND','Security camera self-hosted route not found',404);
  },
};
function cleanId(value){const v=String(value??'').trim();return v||null;}
