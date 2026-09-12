const PREFIX="/api/v1/work";
function fail(status,code,message,details=undefined){throw Object.assign(new Error(message),{status,code,details});}
async function readBytes(request,maxBytes){const chunks=[];let size=0;for await(const chunk of request){const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=bytes.length;if(size>maxBytes)fail(413,"SELFHOST_REQUEST_TOO_LARGE","Request body exceeds the configured limit.");chunks.push(bytes);}return Buffer.concat(chunks);}
async function json(request,maxBytes){const bytes=await readBytes(request,maxBytes);if(!bytes.length)return{};try{return JSON.parse(bytes.toString("utf8"));}catch{fail(400,"INVALID_JSON","Request body must be valid JSON");}}
function contentType(request){const headers=request.headers;return typeof headers?.get==="function"?headers.get("content-type"):headers?.["content-type"]??headers?.["Content-Type"]??"";}
function parseMultipartFile(bytes,type){const boundaryMatch=String(type).match(/boundary=(?:"([^"]+)"|([^;]+))/i);if(!boundaryMatch)fail(400,"MULTIPART_BOUNDARY_REQUIRED","Multipart boundary is missing");const boundary=Buffer.from(`--${boundaryMatch[1]||boundaryMatch[2]}`);let cursor=0;while(cursor<bytes.length){const start=bytes.indexOf(boundary,cursor);if(start<0)break;let partStart=start+boundary.length;if(bytes.subarray(partStart,partStart+2).toString()==="--")break;if(bytes.subarray(partStart,partStart+2).toString()==="\r\n")partStart+=2;const headerEnd=bytes.indexOf(Buffer.from("\r\n\r\n"),partStart);if(headerEnd<0)break;const headerText=bytes.subarray(partStart,headerEnd).toString("utf8");const next=bytes.indexOf(boundary,headerEnd+4);if(next<0)break;let bodyEnd=next;if(bytes.subarray(bodyEnd-2,bodyEnd).toString()==="\r\n")bodyEnd-=2;const disposition=headerText.match(/content-disposition:\s*form-data;([^\r\n]+)/i)?.[1]||"";const name=disposition.match(/name="([^"]+)"/i)?.[1];if(name==="file"){const fileName=disposition.match(/filename="([^"]*)"/i)?.[1]||"attachment";const mimeType=headerText.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim()||"application/octet-stream";return{fileName,mimeType,bytes:bytes.subarray(headerEnd+4,bodyEnd)};}cursor=next;}fail(422,"FILE_REQUIRED","Multipart upload must include a file field");}
async function principal(runtime,request){return runtime.auth.authenticateRequest({headers:request.headers});}

export default {
  name:"tasks-work-api",prefix:PREFIX,business:true,priority:50,
  enabled(config){return config.extensions?.["tasks-work"]?.enabled===true;},
  async handle({request,url,runtime,config,requestId}){
    const api=runtime.extensions?.["tasks-work"]?.api;if(!api)fail(503,"TASKS_WORK_NOT_READY","Self-hosted Tasks & Work is unavailable");
    const p=await principal(runtime,request),suffix=url.pathname.slice(PREFIX.length).replace(/^\/+|\/+$/g,"");
    const q=Object.fromEntries(url.searchParams.entries()),max=config.http.maxRequestBodyBytes;
    if(request.method==="GET"&&suffix==="manifest")return{status:200,body:{data:api.manifest()}};
    if(request.method==="GET"&&suffix==="organization")return{status:200,body:{data:await api.organization(p)}};
    if(request.method==="GET"&&suffix==="members")return{status:200,body:{data:await api.members(p)}};
    if(request.method==="GET"&&suffix==="dashboard")return{status:200,body:{data:await api.dashboard(p)}};

    if(request.method==="GET"&&suffix==="teams")return{status:200,body:{data:await api.listTeams(p)}};
    if(request.method==="POST"&&suffix==="teams")return{status:201,body:{data:await api.createTeam(p,await json(request,max),requestId)}};
    let m=suffix.match(/^teams\/([^/]+)$/);if(request.method==="GET"&&m)return{status:200,body:{data:await api.getTeam(p,decodeURIComponent(m[1]))}};
    m=suffix.match(/^teams\/([^/]+)\/members$/);if(request.method==="POST"&&m)return{status:200,body:{data:await api.addTeamMember(p,decodeURIComponent(m[1]),await json(request,max))}};

    if(request.method==="GET"&&suffix==="contacts")return{status:200,body:{data:await api.listContacts(p,q)}};
    if(request.method==="GET"&&suffix==="projects")return{status:200,body:{data:await api.listProjects(p,q)}};
    if(request.method==="POST"&&suffix==="projects")return{status:201,body:{data:await api.createProject(p,await json(request,max),requestId)}};
    if(request.method==="GET"&&suffix==="tasks")return{status:200,body:{data:await api.listTasks(p,q)}};
    if(request.method==="POST"&&suffix==="tasks")return{status:201,body:{data:await api.createTask(p,await json(request,max),requestId)}};
    m=suffix.match(/^tasks\/([^/]+)$/);if(request.method==="GET"&&m)return{status:200,body:{data:await api.getTask(p,decodeURIComponent(m[1]))}};
    m=suffix.match(/^tasks\/([^/]+)\/status$/);if(request.method==="PATCH"&&m){const b=await json(request,max);return{status:200,body:{data:await api.changeTaskStatus(p,decodeURIComponent(m[1]),b.status,requestId)}};}
    m=suffix.match(/^tasks\/([^/]+)\/assignees$/);if(request.method==="POST"&&m){const b=await json(request,max);return{status:200,body:{data:await api.addAssignee(p,decodeURIComponent(m[1]),b.userId)}};}
    m=suffix.match(/^tasks\/([^/]+)\/followers$/);if(request.method==="POST"&&m){const b=await json(request,max);return{status:200,body:{data:await api.addFollower(p,decodeURIComponent(m[1]),b.userId)}};}
    m=suffix.match(/^tasks\/([^/]+)\/checklist$/);if(request.method==="POST"&&m)return{status:201,body:{data:await api.addChecklist(p,decodeURIComponent(m[1]),await json(request,max))}};
    m=suffix.match(/^tasks\/([^/]+)\/checklist\/([^/]+)$/);if(request.method==="PATCH"&&m)return{status:200,body:{data:await api.toggleChecklist(p,decodeURIComponent(m[1]),decodeURIComponent(m[2]),await json(request,max))}};
    m=suffix.match(/^tasks\/([^/]+)\/comments$/);if(request.method==="POST"&&m)return{status:201,body:{data:await api.comment(p,decodeURIComponent(m[1]),await json(request,max))}};
    m=suffix.match(/^tasks\/([^/]+)\/time-entries$/);if(request.method==="POST"&&m)return{status:201,body:{data:await api.logTime(p,decodeURIComponent(m[1]),await json(request,max))}};

    if(request.method==="GET"&&suffix==="notifications")return{status:200,body:{data:await api.listNotifications(p,q)}};
    if(request.method==="POST"&&suffix==="notifications/read-all")return{status:200,body:{data:await api.readAllNotifications(p)}};
    m=suffix.match(/^notifications\/([^/]+)\/read$/);if(request.method==="POST"&&m)return{status:200,body:{data:await api.readNotification(p,decodeURIComponent(m[1]))}};
    if(request.method==="GET"&&suffix==="notification-preferences")return{status:200,body:{data:await api.notificationPreferences(p)}};
    m=suffix.match(/^notification-preferences\/(.+)$/);if(request.method==="PUT"&&m)return{status:200,body:{data:await api.saveNotificationPreference(p,decodeURIComponent(m[1]),await json(request,max))}};

    if(request.method==="GET"&&suffix==="chats")return{status:200,body:{data:await api.listChats(p,q)}};
    if(request.method==="POST"&&suffix==="chats")return{status:201,body:{data:await api.createChat(p,await json(request,max))}};
    m=suffix.match(/^chats\/([^/]+)$/);if(request.method==="GET"&&m)return{status:200,body:{data:await api.getChat(p,decodeURIComponent(m[1]))}};
    m=suffix.match(/^chats\/([^/]+)\/messages$/);if(request.method==="POST"&&m)return{status:201,body:{data:await api.postMessage(p,decodeURIComponent(m[1]),await json(request,max))}};
    m=suffix.match(/^chats\/([^/]+)\/close$/);if(request.method==="POST"&&m)return{status:200,body:{data:await api.closeChat(p,decodeURIComponent(m[1]))}};
    m=suffix.match(/^chats\/([^/]+)\/attachments$/);if(request.method==="POST"&&m){const bytes=await readBytes(request,max);const file=parseMultipartFile(bytes,contentType(request));return{status:201,body:{data:await api.saveChatAttachment(p,decodeURIComponent(m[1]),file)}};}
    m=suffix.match(/^chats\/([^/]+)\/messages\/([^/]+)\/file$/);if(request.method==="GET"&&m){const file=await api.getChatFile(p,decodeURIComponent(m[1]),decodeURIComponent(m[2]));return{status:200,rawBody:file.bytes,headers:{"content-type":file.mimeType,"content-length":String(file.bytes.length),"content-disposition":`inline; filename="${String(file.fileName||"attachment").replace(/["\r\n]/g,"_")}"`}};}

    fail(404,"TASKS_WORK_ROUTE_NOT_FOUND","Tasks & Work route not found");
  },
};
