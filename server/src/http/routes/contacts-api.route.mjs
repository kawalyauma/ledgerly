const PREFIX='/api/v1/contacts';
function fail(status,code,message){throw Object.assign(new Error(message),{status,code});}
async function body(request,maxBytes){const chunks=[];let size=0;for await(const chunk of request){size+=chunk.length;if(size>maxBytes)fail(413,'SELFHOST_REQUEST_TOO_LARGE','Request body exceeds the configured limit.');chunks.push(chunk);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail(400,'INVALID_JSON','Request body must be valid JSON');}}
async function principal(runtime,request,scope){const p=await runtime.auth.authenticateRequest({headers:request.headers});runtime.auth.requireScope(p,scope);return p;}

export default {
  name:'contacts-api',prefix:PREFIX,business:true,
  enabled(config){return config.extensions?.contacts?.enabled===true;},
  async handle({request,url,requestId,runtime,config}){
    const ext=runtime.extensions?.contacts,service=ext?.api;
    if(!service)fail(503,'CONTACTS_NOT_READY','Contacts self-hosted API is unavailable');
    const suffix=url.pathname.slice(PREFIX.length).replace(/^\/+|\/+$/g,'');

    if(request.method==='GET'&&suffix==='capabilities'){const p=await principal(runtime,request,'contacts:read');return{status:200,body:{data:await service.capabilities(p.organizationId)}};}
    if(request.method==='GET'&&suffix==='people'){const p=await principal(runtime,request,'contacts:read');const result=await service.people({organizationId:p.organizationId,source:url.searchParams.get('source'),group:url.searchParams.get('group'),channel:url.searchParams.get('channel'),search:url.searchParams.get('search')||'',limit:url.searchParams.get('limit'),offset:url.searchParams.get('offset')});return{status:200,body:{data:result.items,pagination:result.pagination}};}
    if(request.method==='GET'&&suffix==='archived'){const p=await principal(runtime,request,'contacts:read');return{status:200,body:{data:await service.archived(p.organizationId)}};}
    if(request.method==='GET'&&suffix===''){const p=await principal(runtime,request,'contacts:read');const result=await service.list({organizationId:p.organizationId,type:url.searchParams.get('type'),limit:url.searchParams.get('limit'),offset:url.searchParams.get('offset')});return{status:200,body:{data:result.items,pagination:result.pagination}};}
    if(request.method==='POST'&&suffix===''){const p=await principal(runtime,request,'contacts:write');return{status:201,body:{data:await service.create({organizationId:p.organizationId,userId:p.userId,input:await body(request,config.http.maxRequestBodyBytes),requestId})}};}

    let match=suffix.match(/^([^/]+)\/detail$/);
    if(request.method==='GET'&&match){const p=await principal(runtime,request,'contacts:read');return{status:200,body:{data:await service.detail(p.organizationId,decodeURIComponent(match[1]))}};}
    match=suffix.match(/^([^/]+)\/addresses$/);
    if(request.method==='GET'&&match){const p=await principal(runtime,request,'contacts:read');return{status:200,body:{data:await service.addresses(p.organizationId,decodeURIComponent(match[1]))}};}
    if(request.method==='POST'&&match){const p=await principal(runtime,request,'contacts:write');return{status:201,body:{data:await service.createAddress({organizationId:p.organizationId,userId:p.userId,contactId:decodeURIComponent(match[1]),input:await body(request,config.http.maxRequestBodyBytes),requestId})}};}
    match=suffix.match(/^([^/]+)\/addresses\/manage$/);
    if(request.method==='POST'&&match){const p=await principal(runtime,request,'contacts:write');return{status:201,body:{data:await service.createAddress({organizationId:p.organizationId,userId:p.userId,contactId:decodeURIComponent(match[1]),input:await body(request,config.http.maxRequestBodyBytes),requestId})}};}
    match=suffix.match(/^([^/]+)\/addresses\/([^/]+)$/);
    if(request.method==='PATCH'&&match){const p=await principal(runtime,request,'contacts:write');return{status:200,body:{data:await service.updateAddress({organizationId:p.organizationId,userId:p.userId,contactId:decodeURIComponent(match[1]),addressId:decodeURIComponent(match[2]),input:await body(request,config.http.maxRequestBodyBytes),requestId})}};}
    if(request.method==='DELETE'&&match){const p=await principal(runtime,request,'contacts:write');await service.deleteAddress({organizationId:p.organizationId,userId:p.userId,contactId:decodeURIComponent(match[1]),addressId:decodeURIComponent(match[2]),requestId});return{status:204,rawBody:''};}

    match=suffix.match(/^([^/]+)\/people$/);
    if(request.method==='POST'&&match){const p=await principal(runtime,request,'contacts:write');return{status:201,body:{data:await service.createPerson({organizationId:p.organizationId,userId:p.userId,contactId:decodeURIComponent(match[1]),input:await body(request,config.http.maxRequestBodyBytes),requestId})}};}
    match=suffix.match(/^([^/]+)\/people\/manage$/);
    if(request.method==='POST'&&match){const p=await principal(runtime,request,'contacts:write');return{status:201,body:{data:await service.createPerson({organizationId:p.organizationId,userId:p.userId,contactId:decodeURIComponent(match[1]),input:await body(request,config.http.maxRequestBodyBytes),requestId})}};}
    match=suffix.match(/^([^/]+)\/people\/([^/]+)$/);
    if(request.method==='PATCH'&&match){const p=await principal(runtime,request,'contacts:write');return{status:200,body:{data:await service.updatePerson({organizationId:p.organizationId,userId:p.userId,contactId:decodeURIComponent(match[1]),personId:decodeURIComponent(match[2]),input:await body(request,config.http.maxRequestBodyBytes),requestId})}};}
    if(request.method==='DELETE'&&match){const p=await principal(runtime,request,'contacts:write');await service.deletePerson({organizationId:p.organizationId,userId:p.userId,contactId:decodeURIComponent(match[1]),personId:decodeURIComponent(match[2]),requestId});return{status:204,rawBody:''};}

    match=suffix.match(/^([^/]+)\/archive$/);
    if(request.method==='POST'&&match){const p=await principal(runtime,request,'contacts:write');return{status:200,body:{data:await service.archive({organizationId:p.organizationId,userId:p.userId,id:decodeURIComponent(match[1]),requestId})}};}
    match=suffix.match(/^([^/]+)\/restore$/);
    if(request.method==='POST'&&match){const p=await principal(runtime,request,'contacts:write');return{status:200,body:{data:await service.restore({organizationId:p.organizationId,userId:p.userId,id:decodeURIComponent(match[1]),requestId})}};}
    match=suffix.match(/^([^/]+)\/merge$/);
    if(request.method==='POST'&&match){const p=await principal(runtime,request,'contacts:write');const input=await body(request,config.http.maxRequestBodyBytes);if(!input.targetContactId)fail(422,'VALIDATION_ERROR','targetContactId is required');return{status:200,body:{data:await service.merge({organizationId:p.organizationId,userId:p.userId,sourceId:decodeURIComponent(match[1]),targetId:String(input.targetContactId),requestId})}};}
    match=suffix.match(/^([^/]+)$/);
    if(request.method==='GET'&&match){const p=await principal(runtime,request,'contacts:read');const detail=await service.detail(p.organizationId,decodeURIComponent(match[1]),{includeArchived:false});return{status:200,body:{data:detail.contact}};}
    if(request.method==='PUT'&&match){const p=await principal(runtime,request,'contacts:write');return{status:200,body:{data:await service.update({organizationId:p.organizationId,userId:p.userId,id:decodeURIComponent(match[1]),input:await body(request,config.http.maxRequestBodyBytes),requestId})}};}
    if(request.method==='DELETE'&&match){const p=await principal(runtime,request,'contacts:write');await service.remove({organizationId:p.organizationId,userId:p.userId,id:decodeURIComponent(match[1]),requestId});return{status:204,rawBody:''};}

    fail(404,'CONTACTS_ROUTE_NOT_FOUND','Contacts route not found');
  }
};
