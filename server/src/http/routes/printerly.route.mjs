const PREFIX='/api/v1/printerly';
function error(code,message,status=400){const e=new Error(message);e.code=code;e.status=status;return e;}
function bearer(request){const h=String(request.headers.authorization||'');return h.toLowerCase().startsWith('bearer ')?h.slice(7).trim():'';}
async function json(request,limit=2*1024*1024){let total=0;const chunks=[];for await(const chunk of request){total+=chunk.length;if(total>limit)throw error('REQUEST_TOO_LARGE','Request body is too large',413);chunks.push(chunk);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw error('INVALID_JSON','Request body must be valid JSON',400);}}
function pathPart(pathname,prefix){return pathname.slice(prefix.length).split('/').filter(Boolean);}

export default{
  name:'printerly-legacy-node',prefix:PREFIX,business:true,priority:100,
  enabled(config){return config.extensions?.printerly?.cutover==='node';},
  async handle({request,url,runtime}){
    const service=runtime.extensions?.printerly?.node;if(!service)throw error('PRINTERLY_SELFHOST_NOT_READY','Printerly self-hosted runtime is not ready',503);
    const parts=pathPart(url.pathname,PREFIX);
    if(request.method==='POST'&&parts.join('/')==='node/pair')return{status:200,body:await service.pair(await json(request))};
    if(parts[0]!=='node')return null;
    const node=await service.authenticate(bearer(request));
    if(request.method==='POST'&&parts.join('/')==='node/heartbeat')return{status:200,body:await service.heartbeat(node,await json(request))};
    if(request.method==='POST'&&parts.join('/')==='node/jobs/claim')return{status:200,body:{job:await service.claim(node,await json(request))}};
    if(request.method==='GET'&&parts.length===4&&parts[1]==='jobs'&&parts[3]==='document'){
      const doc=await service.document(node,parts[2],String(request.headers['x-printerly-claim']||''));
      return{status:200,rawBody:doc.bytes,headers:{'content-type':doc.mimeType,'content-length':String(doc.bytes.length),'x-printerly-sha256':doc.checksum,'content-disposition':`inline; filename="${String(doc.originalName||'document').replace(/["\r\n]/g,'')}"`}};
    }
    if(request.method==='POST'&&parts.length===4&&parts[1]==='jobs'&&parts[3]==='status')return{status:200,body:await service.status(node,parts[2],await json(request))};
    if(request.method==='POST'&&parts.join('/')==='node/release')return{status:200,body:await service.redeem(node,await json(request))};
    throw error('PRINTERLY_ROUTE_NOT_FOUND','Printerly node route not found',404);
  },
};
