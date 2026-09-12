const PREFIX='/api/v1/communications';
function fail(status,code,message,details){throw Object.assign(new Error(message),{status,code,details});}
async function body(request,maxBytes){const chunks=[];let size=0;for await(const chunk of request){size+=chunk.length;if(size>maxBytes)fail(413,'SELFHOST_REQUEST_TOO_LARGE','Request body exceeds the configured limit.');chunks.push(chunk);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail(400,'INVALID_JSON','Request body must be valid JSON');}}
async function principal(runtime,request,scope){const p=await runtime.auth.authenticateRequest({headers:request.headers});runtime.auth.requireScope(p,scope);return p;}

export default {
  name:'communications-api',prefix:PREFIX,business:true,priority:20,
  enabled(config){return config.extensions?.communications?.enabled===true;},
  async handle({request,url,runtime,config}){
    const ext=runtime.extensions?.communications,api=ext?.api;
    if(!api)fail(503,'COMMUNICATIONS_NOT_READY','Communications self-hosted API is unavailable');
    const suffix=url.pathname.slice(PREFIX.length).replace(/^\/+|\/+$/g,'');

    if(request.method==='GET'&&suffix==='manifest'){await principal(runtime,request,'communications:read');return{status:200,body:{data:{name:'Messages & Notifications',version:'1.0.0',channels:['sms','whatsapp'],whatsapp:{templateName:'general_app_update',language:'en_US',status:'approved',category:'UTILITY'}}}};}
    if(request.method==='GET'&&suffix==='providers'){await principal(runtime,request,'communications:read');return{status:200,body:{data:api.providers()}};}
    if(request.method==='GET'&&suffix==='message-types'){const p=await principal(runtime,request,'communications:read');return{status:200,body:{data:await api.messageTypes(p.organizationId,p.userId)}};}
    if(request.method==='GET'&&suffix==='context'){const p=await principal(runtime,request,'communications:read');return{status:200,body:{data:await api.context(p.organizationId)}};}
    if(request.method==='GET'&&suffix==='summary'){const p=await principal(runtime,request,'communications:read');return{status:200,body:{data:await api.summary(p.organizationId)}};}
    if(request.method==='POST'&&suffix==='audience/preview'){const p=await principal(runtime,request,'communications:read'),input=await body(request,config.http.maxRequestBodyBytes);return{status:200,body:{data:await api.previewAudience(p.organizationId,input.audience??{},input.channels??[])}};}
    if(request.method==='GET'&&suffix==='campaigns'){const p=await principal(runtime,request,'communications:read');return{status:200,body:{data:await api.campaigns({organizationId:p.organizationId,status:url.searchParams.get('status'),limit:url.searchParams.get('limit'),offset:url.searchParams.get('offset')})}};}
    if(request.method==='POST'&&suffix==='campaigns'){const p=await principal(runtime,request,'communications:write'),input=await body(request,config.http.maxRequestBodyBytes);return{status:201,body:{data:await api.createCampaign({organizationId:p.organizationId,userId:p.userId,input})}};}
    if(request.method==='GET'&&suffix==='deliveries'){const p=await principal(runtime,request,'communications:read');return{status:200,body:{data:await api.deliveries({organizationId:p.organizationId,channel:url.searchParams.get('channel'),status:url.searchParams.get('status'),limit:url.searchParams.get('limit')})}};}

    let match=suffix.match(/^campaigns\/([^/]+)$/);
    if(request.method==='GET'&&match){const p=await principal(runtime,request,'communications:read');return{status:200,body:{data:await api.campaign(p.organizationId,decodeURIComponent(match[1]))}};}
    match=suffix.match(/^campaigns\/([^/]+)\/(send|queue|retry-failed|cancel)$/);
    if(request.method==='POST'&&match){const p=await principal(runtime,request,'communications:write'),campaignId=decodeURIComponent(match[1]),action=match[2];if(action==='cancel')return{status:200,body:{data:await api.cancel({organizationId:p.organizationId,campaignId,userId:p.userId})}};if(action==='retry-failed')return{status:200,body:{data:await api.retryFailed({organizationId:p.organizationId,campaignId,userId:p.userId})}};return{status:200,body:{data:await api.queue({organizationId:p.organizationId,campaignId,userId:p.userId})}};}

    match=suffix.match(/^preferences\/([^/]+)\/([^/]+)$/);
    if(request.method==='GET'&&match){const p=await principal(runtime,request,'communications:read');return{status:200,body:{data:await api.preference(p.organizationId,decodeURIComponent(match[1]),decodeURIComponent(match[2]))}};}
    if(request.method==='PUT'&&match){const p=await principal(runtime,request,'communications:write'),input=await body(request,config.http.maxRequestBodyBytes);return{status:200,body:{data:await api.setPreference({organizationId:p.organizationId,userId:p.userId,recipientType:decodeURIComponent(match[1]),recipientId:decodeURIComponent(match[2]),input})}};}

    fail(404,'COMMUNICATIONS_ROUTE_NOT_FOUND','Communications route not found');
  }
};
