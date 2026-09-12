const PREFIX='/auth';

function fail(status,code,message,details=undefined){throw Object.assign(new Error(message),{status,code,details});}
function header(headers,name){if(!headers)return undefined;if(typeof headers.get==='function')return headers.get(name)??undefined;const target=name.toLowerCase();for(const [key,value] of Object.entries(headers)){if(key.toLowerCase()===target)return Array.isArray(value)?value[0]:value;}return undefined;}
function clientIp(request,config){const direct=String(request.socket?.remoteAddress??'');if(!config.http?.trustProxyHeaders)return direct||null;const real=String(header(request.headers,'x-real-ip')??'').trim();const forwarded=String(header(request.headers,'x-forwarded-for')??'').split(',')[0].trim();return real||forwarded||direct||null;}
async function body(request,maxBytes){const chunks=[];let total=0;for await(const chunk of request){const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);total+=bytes.length;if(total>maxBytes)fail(413,'SELFHOST_REQUEST_TOO_LARGE','Request body exceeds the configured limit.');chunks.push(bytes);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail(400,'INVALID_JSON','Request body must be valid JSON.');}}
function routeEnabled(config,path){if(path===`${PREFIX}/register`)return config.auth?.registerCutover==='node';return config.auth?.loginCutover==='node';}
function methodNotAllowed(){return{status:405,body:{error:{code:'METHOD_NOT_ALLOWED',message:'Only POST is allowed for this auth endpoint.'}},headers:{allow:'POST'}};}

export default{
  name:'auth',
  prefix:PREFIX,
  public:true,
  priority:100,
  enabled(config){return config.auth?.loginCutover==='node'||config.auth?.registerCutover==='node';},
  async handle({request,url,runtime,config}){
    const path=url.pathname;
    if(![`${PREFIX}/login`,`${PREFIX}/register`,`${PREFIX}/refresh`,`${PREFIX}/logout`].includes(path))fail(404,'AUTH_ROUTE_NOT_FOUND','Auth route not found.');
    if(!routeEnabled(config,path))fail(404,'AUTH_ROUTE_NOT_ENABLED','This auth endpoint is still authoritative on Cloudflare.');
    if(request.method!=='POST')return methodNotAllowed();
    const input=await body(request,config.http.maxRequestBodyBytes);
    const metadata={ip:clientIp(request,config),userAgent:String(header(request.headers,'user-agent')??'')||null};
    if(path===`${PREFIX}/login`){const session=await runtime.auth.login({...input,...metadata});return{status:200,body:{data:session}};}
    if(path===`${PREFIX}/register`){const created=await runtime.auth.register(input);return{status:201,body:{data:created}};}
    if(path===`${PREFIX}/refresh`){const session=await runtime.auth.refresh({...input,...metadata});return{status:200,body:{data:session}};}
    await runtime.auth.logout(input);return{status:200,body:{data:{ok:true}}};
  }
};
