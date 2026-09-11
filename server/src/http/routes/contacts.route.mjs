const PREFIX='/selfhost/contacts';
function fail(status,code,message){throw Object.assign(new Error(message),{status,code});}
async function json(req){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>262144)fail(413,'PAYLOAD_TOO_LARGE','request too large');chunks.push(c);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail(400,'INVALID_JSON','invalid JSON');}}
async function principal(runtime,request,scope){const p=await runtime.auth.authenticateRequest({headers:request.headers});runtime.auth.requireScope(p,scope);return p;}
export default {name:'contacts',prefix:PREFIX,enabled(c){return c.extensions?.contacts?.enabled===true;},async handle({request,url,runtime}){
 const ext=runtime.extensions.contacts;if(!ext)fail(503,'CONTACTS_NOT_READY','contacts not enabled');
 if(request.method==='GET'&&url.pathname===PREFIX){const p=await principal(runtime,request,'contacts:read');const rows=await ext.service.list({organizationId:p.organizationId,limit:url.searchParams.get('limit'),afterId:url.searchParams.get('afterId'),type:url.searchParams.get('type'),active:url.searchParams.has('active')?url.searchParams.get('active')==='true':null});return{status:200,body:{contacts:rows,nextAfterId:rows.at(-1)?.id??null}};}
 if(request.method==='POST'&&url.pathname===PREFIX){const p=await principal(runtime,request,'contacts:write');const body=await json(request);const row=await ext.service.create({organizationId:p.organizationId,actor:{actorType:'human',actorId:p.userId},contact:body});return{status:201,body:{contact:row}};}
 const m=url.pathname.match(/^\/selfhost\/contacts\/([^/]+)$/);if(request.method==='GET'&&m){const p=await principal(runtime,request,'contacts:read');const row=await ext.service.get({organizationId:p.organizationId,id:decodeURIComponent(m[1])});if(!row)fail(404,'CONTACT_NOT_FOUND','contact not found');return{status:200,body:{contact:row}};}
 fail(404,'CONTACTS_ROUTE_NOT_FOUND','contacts route not found');
}};
