const PREFIX='/api/v1/attendance/device';

function fail(status,code,message){throw Object.assign(new Error(message),{status,code});}
async function json(request,maxBytes){const chunks=[];let size=0;for await(const chunk of request){size+=chunk.length;if(size>maxBytes)fail(413,'SELFHOST_REQUEST_TOO_LARGE','Request body exceeds the configured limit.');chunks.push(chunk);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail(400,'INVALID_JSON','Request body must be valid JSON');}}

export default {
  name:'attendance-device',
  prefix:PREFIX,
  business:true,
  priority:20,
  enabled(config){return config.extensions?.attendance?.enabled===true;},
  async handle({request,url,runtime,config}){
    const service=runtime.extensions?.attendance?.api;
    if(!service)fail(503,'ATTENDANCE_NOT_READY','Attendance self-hosted API is unavailable');
    const device=await service.authenticateDevice(request.headers?.authorization??request.headers?.Authorization??'');
    const suffix=url.pathname.slice(PREFIX.length).replace(/^\/+|\/+$/g,'');

    if(request.method==='GET'&&suffix==='health')return{status:200,body:{data:{deviceId:device.id,deviceCode:device.device_code,status:device.status,serverTime:new Date().toISOString(),cameraSource:'device'}}};
    if(request.method==='GET'&&suffix==='bootstrap')return{status:200,body:{data:await service.deviceBootstrap(device)}};
    if(request.method==='GET'&&suffix==='face/state')return{status:200,body:{data:await service.faceState(device)}};
    if(request.method==='GET'&&suffix==='face/templates')return{status:200,body:{data:await service.faceTemplates(device)}};

    let match=suffix.match(/^face\/enrollment-jobs\/([^/]+)\/claim$/);
    if(request.method==='POST'&&match){return{status:200,body:{data:await service.claimEnrollmentJob(device,decodeURIComponent(match[1]))}};}
    match=suffix.match(/^face\/enrollment-jobs\/([^/]+)\/complete$/);
    if(request.method==='POST'&&match){return{status:201,body:{data:await service.completeEnrollmentJob(device,decodeURIComponent(match[1]),await json(request,config.http.maxRequestBodyBytes))}};}
    match=suffix.match(/^face\/enrollment-jobs\/([^/]+)\/fail$/);
    if(request.method==='POST'&&match){const input=await json(request,config.http.maxRequestBodyBytes);return{status:200,body:{data:await service.failEnrollmentJob(device,decodeURIComponent(match[1]),input.reason)}};}

    if(request.method==='POST'&&suffix==='sync'){
      const input=await json(request,config.http.maxRequestBodyBytes);
      return{status:202,body:{data:await service.offlineSync({organizationId:device.organization_id,userId:null,deviceId:device.id,clientBatchId:input.clientBatchId,events:input.events,actorType:'device'})}};
    }

    fail(404,'ATTENDANCE_DEVICE_ROUTE_NOT_FOUND','Attendance device route not found');
  },
};
