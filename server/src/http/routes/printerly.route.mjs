const PREFIX='/api/v1/printerly';
function error(code,message,status=400){const e=new Error(message);e.code=code;e.status=status;return e;}
function bearer(request){const h=String(request.headers.authorization||request.headers?.get?.('authorization')||'');return h.toLowerCase().startsWith('bearer ')?h.slice(7).trim():'';}
async function json(request,limit=2*1024*1024){let total=0;const chunks=[];for await(const chunk of request){const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);total+=bytes.length;if(total>limit)throw error('REQUEST_TOO_LARGE','Request body is too large',413);chunks.push(bytes);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw error('INVALID_JSON','Request body must be valid JSON',400);}}
function pathPart(pathname,prefix){return pathname.slice(prefix.length).split('/').filter(Boolean);}
const data=(value,status=200)=>({status,body:{data:value}});

export default{
  name:'printerly-legacy-node',prefix:'/api/v1/printerly/node',business:true,priority:100,
  enabled(config){return config.extensions?.printerly?.nodeCutover==='node'||(!config.extensions?.printerly?.nodeCutover&&config.extensions?.printerly?.cutover==='node');},
  async handle({request,url,runtime}){
    const service=runtime.extensions?.printerly?.node,scanner=runtime.extensions?.printerly?.scanner;if(!service)throw error('PRINTERLY_SELFHOST_NOT_READY','Printerly self-hosted runtime is not ready',503);
    const parts=pathPart(url.pathname,PREFIX);
    if(request.method==='POST'&&parts.join('/')==='node/pair')return data(await service.pair(await json(request)));
    if(parts[0]!=='node')throw error('PRINTERLY_ROUTE_NOT_FOUND','Printerly node route not found',404);
    const node=await service.authenticate(bearer(request));
    if(request.method==='POST'&&parts.join('/')==='node/heartbeat')return data({...await service.heartbeat(node,await json(request)),nodeProtocol:3});
    if(request.method==='POST'&&parts.join('/')==='node/jobs/claim')return data(await service.claim(node,await json(request)));
    if(request.method==='GET'&&parts.length===4&&parts[1]==='jobs'&&parts[3]==='document'){
      const claim=String(request.headers['x-printerly-claim']||request.headers?.get?.('x-printerly-claim')||url.searchParams.get('claimToken')||'');
      const doc=await service.document(node,parts[2],claim);
      return{status:200,rawBody:doc.bytes,headers:{'content-type':doc.mimeType,'content-length':String(doc.bytes.length),'x-printerly-sha256':doc.checksum,'content-disposition':`inline; filename="${String(doc.originalName||'document').replace(/["\r\n]/g,'')}"`}};
    }
    if(request.method==='POST'&&parts.length===4&&parts[1]==='jobs'&&parts[3]==='status')return data(await service.status(node,parts[2],await json(request)));
    if(request.method==='POST'&&parts.join('/')==='node/release')return data(await service.redeem(node,await json(request)));
    if(request.method==='POST'&&parts.join('/')==='node/scans/claim'){if(!scanner)throw error('PRINTERLY_SCANNER_SELFHOST_NOT_READY','Scannerly self-hosted runtime is not ready',503);return data(await scanner.claim(node,await json(request)));}
    if(request.method==='POST'&&parts.length===4&&parts[1]==='scans'&&parts[3]==='status'){if(!scanner)throw error('PRINTERLY_SCANNER_SELFHOST_NOT_READY','Scannerly self-hosted runtime is not ready',503);return data(await scanner.status(node,parts[2],await json(request)));}
    if(request.method==='POST'&&parts.length===4&&parts[1]==='scans'&&parts[3]==='upload'){
      if(!scanner)throw error('PRINTERLY_SCANNER_SELFHOST_NOT_READY','Scannerly self-hosted runtime is not ready',503);
      const claim=String(request.headers['x-printerly-scan-claim']||request.headers?.get?.('x-printerly-scan-claim')||url.searchParams.get('claimToken')||'');
      const {readScannerMultipartFile}=await import('../../printerly/scanner-service.mjs');
      return data(await scanner.upload(node,parts[2],claim,await readScannerMultipartFile(request)),201);
    }
    throw error('PRINTERLY_ROUTE_NOT_FOUND','Printerly node route not found',404);
  },
};
