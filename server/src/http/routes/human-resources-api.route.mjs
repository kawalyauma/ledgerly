const PREFIX='/api/v1/human-resources';
function fail(status,code,message){throw Object.assign(new Error(message),{status,code});}
async function json(request,maxBytes){const chunks=[];let size=0;for await(const c of request){size+=c.length;if(size>maxBytes)fail(413,'SELFHOST_REQUEST_TOO_LARGE','Request body exceeds the configured limit.');chunks.push(c);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail(400,'INVALID_JSON','Request body must be valid JSON');}}
function requireHr(principal,write=false){if(principal.role==='owner'||principal.role==='admin')return;const scopes=Array.isArray(principal.scopes)?principal.scopes:[];const ok=write?(scopes.includes('hr:write')||scopes.includes('hr:*')):(scopes.includes('hr:read')||scopes.includes('hr:write')||scopes.includes('hr:*'));if(!ok)fail(403,'FORBIDDEN',`Missing Human Resources ${write?'write':'read'} permission`);}

export default {
  name:'human-resources-api',
  prefix:PREFIX,
  business:true,
  enabled(config){return config.extensions?.['human-resources']?.enabled===true;},
  async handle({request,url,requestId,runtime,config}){
    const principal=await runtime.auth.authenticateRequest({headers:request.headers});
    const ext=runtime.extensions?.['human-resources'];
    const service=ext?.api;
    if(!service)fail(503,'HR_NOT_READY','Human Resources self-hosted API is unavailable');
    requireHr(principal,false);
    await service.requireEnabled(principal.organizationId);
    const suffix=url.pathname.slice(PREFIX.length).replace(/^\/+|\/+$/g,'');
    const ctx={organizationId:principal.organizationId,userId:principal.userId,requestId};

    if(request.method==='GET'&&suffix==='manifest')return{status:200,body:{data:await service.manifest(principal.organizationId)}};
    if(request.method==='GET'&&suffix==='dashboard')return{status:200,body:{data:await service.dashboard(principal.organizationId)}};
    if(request.method==='GET'&&suffix==='people')return{status:200,body:{data:await service.people(principal.organizationId)}};
    if(request.method==='GET'&&suffix==='employees')return{status:200,body:{data:await service.employees(principal.organizationId)}};
    if(request.method==='GET'&&suffix==='departments')return{status:200,body:{data:await service.departments(principal.organizationId)}};
    if(request.method==='GET'&&suffix==='leave-types')return{status:200,body:{data:await service.leaveTypes(principal.organizationId)}};
    if(request.method==='GET'&&suffix==='leave-requests')return{status:200,body:{data:await service.leaveRequests(principal.organizationId)}};
    if(request.method==='GET'&&suffix==='onboarding')return{status:200,body:{data:await service.onboarding(principal.organizationId)}};
    if(request.method==='GET'&&suffix==='audit')return{status:200,body:{data:await service.auditEvents(principal.organizationId,url.searchParams.get('limit'))}};

    if(request.method==='POST'&&suffix==='employees'){requireHr(principal,true);return{status:201,body:{data:await service.createEmployee({...ctx,input:await json(request,config.http.maxRequestBodyBytes)})}};}
    if(request.method==='POST'&&suffix==='departments'){requireHr(principal,true);return{status:201,body:{data:await service.createDepartment({...ctx,input:await json(request,config.http.maxRequestBodyBytes)})}};}
    if(request.method==='POST'&&suffix==='leave-types'){requireHr(principal,true);return{status:201,body:{data:await service.createLeaveType({...ctx,input:await json(request,config.http.maxRequestBodyBytes)})}};}
    if(request.method==='POST'&&suffix==='leave-requests'){requireHr(principal,true);return{status:201,body:{data:await service.createLeave({...ctx,input:await json(request,config.http.maxRequestBodyBytes)})}};}
    if(request.method==='POST'&&suffix==='onboarding'){requireHr(principal,true);return{status:201,body:{data:await service.createOnboarding({...ctx,input:await json(request,config.http.maxRequestBodyBytes)})}};}

    let match=suffix.match(/^employees\/([^/]+)$/);
    if(request.method==='PATCH'&&match){requireHr(principal,true);return{status:200,body:{data:await service.updateEmployee({...ctx,employeeId:decodeURIComponent(match[1]),input:await json(request,config.http.maxRequestBodyBytes)})}};}
    match=suffix.match(/^departments\/([^/]+)$/);
    if(request.method==='PATCH'&&match){requireHr(principal,true);return{status:200,body:{data:await service.updateDepartment({...ctx,departmentId:decodeURIComponent(match[1]),input:await json(request,config.http.maxRequestBodyBytes)})}};}
    match=suffix.match(/^leave-types\/([^/]+)$/);
    if(request.method==='PATCH'&&match){requireHr(principal,true);return{status:200,body:{data:await service.updateLeaveType({...ctx,leaveTypeId:decodeURIComponent(match[1]),input:await json(request,config.http.maxRequestBodyBytes)})}};}
    match=suffix.match(/^leave-requests\/([^/]+)\/(approve|reject)$/);
    if(request.method==='POST'&&match){requireHr(principal,true);const body=await json(request,config.http.maxRequestBodyBytes);return{status:200,body:{data:await service.decideLeave({...ctx,leaveId:decodeURIComponent(match[1]),decision:match[2],notes:body.notes})}};}
    match=suffix.match(/^leave-requests\/([^/]+)\/review$/);
    if(request.method==='POST'&&match){requireHr(principal,true);const body=await json(request,config.http.maxRequestBodyBytes);return{status:200,body:{data:await service.decideLeave({...ctx,leaveId:decodeURIComponent(match[1]),decision:body.decision,notes:body.notes})}};}
    match=suffix.match(/^onboarding\/([^/]+)\/status$/);
    if(request.method==='PATCH'&&match){requireHr(principal,true);const body=await json(request,config.http.maxRequestBodyBytes);return{status:200,body:{data:await service.setOnboardingStatus({...ctx,taskId:decodeURIComponent(match[1]),status:body.status})}};}

    fail(404,'HR_ROUTE_NOT_FOUND','Human Resources route not found');
  }
};
