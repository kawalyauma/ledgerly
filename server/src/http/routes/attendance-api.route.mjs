const PREFIX='/api/v1/attendance';

function fail(status,code,message){throw Object.assign(new Error(message),{status,code});}
async function json(request,maxBytes){const chunks=[];let size=0;for await(const chunk of request){size+=chunk.length;if(size>maxBytes)fail(413,'SELFHOST_REQUEST_TOO_LARGE','Request body exceeds the configured limit.');chunks.push(chunk);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail(400,'INVALID_JSON','Request body must be valid JSON');}}
function hasDirect(principal,permission){if(principal.role==='owner'||principal.role==='admin')return true;const scopes=Array.isArray(principal.scopes)?principal.scopes:[];return scopes.includes(permission)||scopes.includes('school:*')||(scopes.includes('school:write')&&(permission.endsWith(':write')||permission.endsWith(':approve')||permission.endsWith(':export')));}
async function requirePermission(runtime,principal,permission){if(hasDirect(principal,permission))return;const result=await runtime.services.database.query(`SELECT 1 FROM school_user_roles ur JOIN school_role_permissions rp ON rp.organization_id=ur.organization_id AND rp.role_id=ur.role_id WHERE ur.organization_id=$1 AND ur.user_id=$2 AND rp.permission=$3 AND rp.effect='allow' AND (ur.starts_at IS NULL OR ur.starts_at<=CURRENT_TIMESTAMP) AND (ur.ends_at IS NULL OR ur.ends_at>=CURRENT_TIMESTAMP) UNION ALL SELECT 1 FROM school_temporary_permissions tp WHERE tp.organization_id=$1 AND tp.user_id=$2 AND tp.permission=$3 AND tp.revoked_at IS NULL AND tp.starts_at<=CURRENT_TIMESTAMP AND tp.ends_at>=CURRENT_TIMESTAMP LIMIT 1`,[principal.organizationId,principal.userId,permission]);if(!result.rows[0])fail(403,'FORBIDDEN',`Missing school permission: ${permission}`);}
function query(url,name){const value=url.searchParams.get(name);return value==null||value===''?null:value;}

export default {
  name:'attendance-api',
  prefix:PREFIX,
  business:true,
  enabled(config){return config.extensions?.attendance?.enabled===true;},
  async handle({request,url,requestId,runtime,config}){
    const principal=await runtime.auth.authenticateRequest({headers:request.headers});
    runtime.auth.requireScope(principal,'school:read');
    const service=runtime.extensions?.attendance?.api;
    if(!service)fail(503,'ATTENDANCE_NOT_READY','Attendance self-hosted API is unavailable');
    await service.requireEnabled(principal.organizationId);
    const suffix=url.pathname.slice(PREFIX.length).replace(/^\/+|\/+$/g,'');
    const ctx={organizationId:principal.organizationId,userId:principal.userId,requestId};

    if(request.method==='GET'&&suffix==='manifest'){await requirePermission(runtime,principal,'attendance:read');return{status:200,body:{data:await service.manifest()}};}
    if(request.method==='GET'&&suffix==='context'){await requirePermission(runtime,principal,'attendance:read');return{status:200,body:{data:await service.context(principal.organizationId)}};}
    if(request.method==='GET'&&suffix==='overview'){await requirePermission(runtime,principal,'attendance:read');const date=query(url,'date')||new Date().toISOString().slice(0,10);return{status:200,body:{data:await service.overview(principal.organizationId,date)}};}
    if(request.method==='GET'&&suffix==='events'){await requirePermission(runtime,principal,'attendance:read');return{status:200,body:{data:await service.events({organizationId:principal.organizationId,date:query(url,'date'),method:query(url,'method'),status:query(url,'status'),limit:query(url,'limit')})}};}
    if(request.method==='POST'&&suffix==='events'){await requirePermission(runtime,principal,'attendance:write');const input=await json(request,config.http.maxRequestBodyBytes);if(String(input.verificationMode||'STANDARD').toUpperCase()==='TEST')fail(409,'TEST_MODE_GRANT_REQUIRED','Test events are accepted only through an active device test-mode grant');const data=await service.recordEvent({...ctx,input});return{status:data.duplicate?200:201,body:{data}};}
    if(request.method==='POST'&&suffix==='offline-sync'){await requirePermission(runtime,principal,'attendance:write');const input=await json(request,config.http.maxRequestBodyBytes);return{status:202,body:{data:await service.offlineSync({organizationId:principal.organizationId,userId:principal.userId,deviceId:input.deviceId,clientBatchId:input.clientBatchId,events:input.events,actorType:'user'})}};}

    if(request.method==='GET'&&suffix==='sessions'){await requirePermission(runtime,principal,'attendance:read');return{status:200,body:{data:await service.sessions({organizationId:principal.organizationId,date:query(url,'date')})}};}
    if(request.method==='POST'&&suffix==='sessions'){await requirePermission(runtime,principal,'attendance:write');return{status:201,body:{data:await service.createSession({...ctx,input:await json(request,config.http.maxRequestBodyBytes)})}};}
    let match=suffix.match(/^sessions\/([^/]+)\/records$/);
    if(request.method==='PUT'&&match){await requirePermission(runtime,principal,'attendance:write');const input=await json(request,config.http.maxRequestBodyBytes);return{status:200,body:{data:await service.saveSessionRecords({...ctx,sessionId:decodeURIComponent(match[1]),records:input.records})}};}
    match=suffix.match(/^sessions\/([^/]+)\/finalize$/);
    if(request.method==='POST'&&match){await requirePermission(runtime,principal,'attendance:manage');return{status:200,body:{data:await service.finalizeSession({...ctx,sessionId:decodeURIComponent(match[1])})}};}

    if(request.method==='GET'&&suffix==='records'){await requirePermission(runtime,principal,'attendance:read');return{status:200,body:{data:await service.records({organizationId:principal.organizationId,from:query(url,'from')||'0001-01-01',to:query(url,'to')||'9999-12-31',personType:query(url,'personType'),personId:query(url,'personId'),status:query(url,'status'),limit:query(url,'limit')})}};}
    if(request.method==='PUT'&&suffix==='staff/day'){await requirePermission(runtime,principal,'attendance:write');const input=await json(request,config.http.maxRequestBodyBytes);return{status:200,body:{data:await service.staffDay({organizationId:principal.organizationId,userId:principal.userId,attendanceDate:input.attendanceDate,records:input.records})}};}
    match=suffix.match(/^records\/([^/]+)\/correct$/);
    if(request.method==='POST'&&match){await requirePermission(runtime,principal,'attendance:manage');return{status:200,body:{data:await service.correctRecord({...ctx,recordId:decodeURIComponent(match[1]),input:await json(request,config.http.maxRequestBodyBytes)})}};}

    if(request.method==='GET'&&suffix==='devices'){await requirePermission(runtime,principal,'attendance:read');return{status:200,body:{data:await service.devices(principal.organizationId)}};}
    if(request.method==='POST'&&suffix==='devices'){await requirePermission(runtime,principal,'attendance:devices');return{status:201,body:{data:await service.createDirectDevice({...ctx,input:await json(request,config.http.maxRequestBodyBytes)})}};}
    match=suffix.match(/^devices\/([^/]+)$/);
    if(request.method==='PATCH'&&match){await requirePermission(runtime,principal,'attendance:devices');return{status:200,body:{data:await service.updateDevice({...ctx,deviceId:decodeURIComponent(match[1]),input:await json(request,config.http.maxRequestBodyBytes)})}};}
    match=suffix.match(/^devices\/([^/]+)\/test-mode$/);
    if(request.method==='POST'&&match){await requirePermission(runtime,principal,'attendance:devices');return{status:201,body:{data:await service.enableTestMode({...ctx,deviceId:decodeURIComponent(match[1]),input:await json(request,config.http.maxRequestBodyBytes)})}};}
    if(request.method==='DELETE'&&match){await requirePermission(runtime,principal,'attendance:devices');return{status:200,body:{data:await service.disableTestMode({...ctx,deviceId:decodeURIComponent(match[1])})}};}

    if(request.method==='GET'&&suffix==='identifiers'){await requirePermission(runtime,principal,'attendance:read');return{status:200,body:{data:await service.identifiers(principal.organizationId)}};}
    if(request.method==='POST'&&suffix==='identifiers'){await requirePermission(runtime,principal,'attendance:devices');return{status:201,body:{data:await service.createIdentifier({...ctx,input:await json(request,config.http.maxRequestBodyBytes)})}};}
    match=suffix.match(/^identifiers\/([^/]+)$/);
    if(request.method==='DELETE'&&match){await requirePermission(runtime,principal,'attendance:devices');await service.revokeIdentifier({...ctx,identifierId:decodeURIComponent(match[1])});return{status:204,rawBody:''};}

    if(request.method==='GET'&&suffix==='biometric-settings'){await requirePermission(runtime,principal,'attendance:biometrics');return{status:200,body:{data:await service.biometricSettings(principal.organizationId)}};}
    if(request.method==='PATCH'&&suffix==='biometric-settings'){await requirePermission(runtime,principal,'attendance:biometrics');return{status:200,body:{data:await service.updateBiometricSettings({...ctx,input:await json(request,config.http.maxRequestBodyBytes)})}};}
    if(request.method==='GET'&&suffix==='biometric-enrollment-jobs'){await requirePermission(runtime,principal,'attendance:biometrics');return{status:200,body:{data:await service.biometricEnrollmentJobs(principal.organizationId)}};}
    if(request.method==='POST'&&suffix==='biometric-enrollment-jobs'){await requirePermission(runtime,principal,'attendance:biometrics');return{status:201,body:{data:await service.createBiometricEnrollmentJob({...ctx,input:await json(request,config.http.maxRequestBodyBytes)})}};}
    match=suffix.match(/^biometric-enrollment-jobs\/([^/]+)$/);
    if(request.method==='DELETE'&&match){await requirePermission(runtime,principal,'attendance:biometrics');return{status:200,body:{data:await service.cancelBiometricEnrollmentJob({...ctx,jobId:decodeURIComponent(match[1])})}};}
    if(request.method==='GET'&&suffix==='biometrics'){await requirePermission(runtime,principal,'attendance:biometrics');return{status:200,body:{data:await service.biometrics(principal.organizationId)}};}
    if(request.method==='POST'&&suffix==='biometrics'){await requirePermission(runtime,principal,'attendance:biometrics');return{status:201,body:{data:await service.createBiometricProfile({...ctx,input:await json(request,config.http.maxRequestBodyBytes)})}};}
    match=suffix.match(/^biometrics\/([^/]+)$/);
    if(request.method==='DELETE'&&match){await requirePermission(runtime,principal,'attendance:biometrics');return{status:200,body:{data:await service.deleteBiometricProfile({...ctx,profileId:decodeURIComponent(match[1])})}};}

    if(request.method==='GET'&&suffix==='policies'){await requirePermission(runtime,principal,'attendance:read');return{status:200,body:{data:await service.policies(principal.organizationId)}};}
    if(request.method==='POST'&&suffix==='policies'){await requirePermission(runtime,principal,'attendance:manage');return{status:201,body:{data:await service.createPolicy({...ctx,input:await json(request,config.http.maxRequestBodyBytes)})}};}
    if(request.method==='GET'&&suffix==='notification-rules'){await requirePermission(runtime,principal,'attendance:read');return{status:200,body:{data:await service.notificationRules(principal.organizationId)}};}
    if(request.method==='POST'&&suffix==='notification-rules'){await requirePermission(runtime,principal,'attendance:manage');return{status:201,body:{data:await service.createNotificationRule({...ctx,input:await json(request,config.http.maxRequestBodyBytes)})}};}
    if(request.method==='GET'&&suffix==='exceptions'){await requirePermission(runtime,principal,'attendance:read');return{status:200,body:{data:await service.exceptions(principal.organizationId)}};}
    if(request.method==='POST'&&suffix==='exceptions'){await requirePermission(runtime,principal,'attendance:write');return{status:201,body:{data:await service.createException({...ctx,input:await json(request,config.http.maxRequestBodyBytes)})}};}
    if(request.method==='GET'&&suffix==='corrections'){await requirePermission(runtime,principal,'attendance:read');return{status:200,body:{data:await service.corrections(principal.organizationId)}};}
    if(request.method==='GET'&&suffix==='reports/summary'){await requirePermission(runtime,principal,'attendance:read');const from=query(url,'from')||new Date().toISOString().slice(0,10);return{status:200,body:{data:await service.reportSummary({organizationId:principal.organizationId,from,to:query(url,'to')||from})}};}

    if(request.method==='POST'&&suffix==='kiosk-enrollment'){await requirePermission(runtime,principal,'attendance:devices');return{status:201,body:{data:await service.createKioskEnrollment({...ctx,input:await json(request,config.http.maxRequestBodyBytes)})}};}
    match=suffix.match(/^kiosk-enrollment\/([^/]+)\/refresh$/);
    if(request.method==='POST'&&match){await requirePermission(runtime,principal,'attendance:devices');return{status:200,body:{data:await service.refreshKioskEnrollment({...ctx,deviceId:decodeURIComponent(match[1])})}};}

    fail(404,'ATTENDANCE_ROUTE_NOT_FOUND','Attendance route not found');
  },
};
