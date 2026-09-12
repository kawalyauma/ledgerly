const PREFIX='/api/v1/attendance/device-enrollment';

function fail(status,code,message){throw Object.assign(new Error(message),{status,code});}
async function json(request,maxBytes){const chunks=[];let size=0;for await(const chunk of request){size+=chunk.length;if(size>maxBytes)fail(413,'SELFHOST_REQUEST_TOO_LARGE','Request body exceeds the configured limit.');chunks.push(chunk);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail(400,'INVALID_JSON','Request body must be valid JSON');}}

export default {
  name:'attendance-device-enrollment',
  prefix:PREFIX,
  business:true,
  priority:30,
  enabled(config){return config.extensions?.attendance?.enabled===true;},
  async handle({request,url,runtime,config}){
    const service=runtime.extensions?.attendance?.api;
    if(!service)fail(503,'ATTENDANCE_NOT_READY','Attendance self-hosted API is unavailable');
    const suffix=url.pathname.slice(PREFIX.length).replace(/^\/+|\/+$/g,'');
    if(request.method==='POST'&&suffix===''){
      const input=await json(request,config.http.maxRequestBodyBytes);
      return{status:201,body:{data:await service.enrollDevice({enrollmentToken:input.token,appVersion:input.appVersion??null})}};
    }
    fail(404,'ATTENDANCE_ENROLLMENT_ROUTE_NOT_FOUND','Attendance device enrollment route not found');
  },
};
