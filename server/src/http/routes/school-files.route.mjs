import { createHash, randomUUID } from 'node:crypto';

const PREFIX='/api/v1/school/files';
const MAX_FILE_BYTES=15*1024*1024;
const MAX_MULTIPART_BYTES=MAX_FILE_BYTES+1024*1024;
const ALLOWED_MIME=new Set([
  'image/jpeg','image/png','image/webp','image/gif','image/svg+xml',
  'application/pdf','text/plain','text/csv',
  'audio/mpeg','audio/mp4','audio/wav','audio/x-wav','audio/ogg',
  'video/mp4','video/webm','video/quicktime',
  'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const REFERENCES=Object.freeze([
  ['school_profiles','logo_file_id','school profile logo'],
  ['school_user_profiles','profile_photo_file_id','user profile photo'],
  ['school_user_profiles','signature_file_id','user signature'],
  ['school_document_templates','file_id','document template'],
  ['school_student_documents','file_id','student document'],
  ['school_students','profile_photo_file_id','student profile photo'],
  ['school_guardians','profile_photo_file_id','guardian profile photo'],
  ['school_authorized_pickups','photo_file_id','authorized-pickup photo'],
  ['school_staff_profiles','profile_photo_file_id','staff profile photo'],
  ['school_staff_documents','file_id','staff document'],
  ['school_staff_qualifications','file_id','staff qualification evidence'],
  ['school_fee_receipts','supporting_file_id','school fee receipt supporting document'],
  ['school_discipline_attachments','file_id','discipline / offence evidence'],
  ['acad_delivery_attachments','file_id','academic lesson-delivery evidence'],
  ['acad_observation_attachments','file_id','academic observation evidence'],
  ['acad_inspection_attachments','file_id','academic inspection evidence'],
]);

function fail(status,code,message){throw Object.assign(new Error(message),{status,code});}
function safeName(value){const name=String(value??'file').normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'');return(name||'file').slice(0,180);}
function id(){return`sfl_${randomUUID().replaceAll('-','')}`;}
function bounded(value,fallback=100,max=500){const n=Number(value);return Number.isFinite(n)?Math.min(max,Math.max(1,Math.trunc(n))):fallback;}
function camel(row){if(!row||typeof row!=='object')return row;return Object.fromEntries(Object.entries(row).map(([key,value])=>[key.replace(/_([a-z])/g,(_,c)=>c.toUpperCase()),value]));}
function publicMetadata(row,{contentUrl=false}={}){const item=camel(row);delete item.objectKey;if(item.sizeBytes!=null)item.sizeBytes=Number(item.sizeBytes);item.checksum=item.checksumSha256;delete item.checksumSha256;if(contentUrl)item.contentUrl=`${PREFIX}/${encodeURIComponent(item.id)}/content`;return item;}
function principalScopes(principal){return Array.isArray(principal?.scopes)?principal.scopes:[];}
function directPermission(principal,permission){if(['owner','admin','super_admin'].includes(principal?.role))return true;const s=principalScopes(principal);return s.includes(permission)||s.includes('school:*')||(s.includes('school:write')&&(permission.endsWith(':write')||permission.endsWith(':approve')||permission.endsWith(':export')));}
async function requireSchoolPermission(database,principal,permission){
  if(directPermission(principal,permission))return;
  const result=await database.query(`SELECT 1 FROM school_user_roles ur JOIN school_role_permissions rp ON rp.organization_id=ur.organization_id AND rp.role_id=ur.role_id WHERE ur.organization_id=$1 AND ur.user_id=$2 AND rp.permission=$3 AND rp.effect='allow' AND (ur.starts_at IS NULL OR ur.starts_at<=CURRENT_TIMESTAMP) AND (ur.ends_at IS NULL OR ur.ends_at>=CURRENT_TIMESTAMP) UNION ALL SELECT 1 FROM school_temporary_permissions tp WHERE tp.organization_id=$1 AND tp.user_id=$2 AND tp.permission=$3 AND tp.revoked_at IS NULL AND tp.starts_at<=CURRENT_TIMESTAMP AND tp.ends_at>=CURRENT_TIMESTAMP LIMIT 1`,[principal.organizationId,principal.userId,permission]);
  if(!result.rows[0])fail(403,'FORBIDDEN',`Missing school permission: ${permission}`);
}
async function parseMultipart(request){
  const contentType=String(request.headers?.['content-type']??'');
  if(!contentType.toLowerCase().startsWith('multipart/form-data'))fail(415,'UNSUPPORTED_MEDIA_TYPE','School file uploads require multipart/form-data');
  const declared=Number(request.headers?.['content-length']);
  if(Number.isFinite(declared)&&declared>MAX_MULTIPART_BYTES)fail(413,'FILE_TOO_LARGE','School uploads are limited to 15 MB per file.');
  const chunks=[];let size=0;
  for await(const chunk of request){const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=bytes.length;if(size>MAX_MULTIPART_BYTES)fail(413,'FILE_TOO_LARGE','School uploads are limited to 15 MB per file.');chunks.push(bytes);}
  try{return await new Request('http://ledgerly.local/upload',{method:'POST',headers:{'content-type':contentType},body:Buffer.concat(chunks)}).formData();}
  catch{fail(400,'INVALID_MULTIPART','The upload form could not be parsed.');}
}
async function ownedFile(database,organizationId,fileId){
  const result=await database.query(`SELECT id,object_key,original_name,mime_type,size_bytes,checksum_sha256,purpose,created_at FROM school_files WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`,[fileId,organizationId]);
  if(!result.rows[0])fail(404,'FILE_NOT_FOUND','School file not found');
  return result.rows[0];
}
async function referenceDescription(database,organizationId,fileId){
  for(const[table,column,label]of REFERENCES){
    const exists=await database.query(`SELECT to_regclass($1) AS relation`,[`public.${table}`]);
    if(!exists.rows[0]?.relation)continue;
    const used=await database.query(`SELECT 1 FROM ${table} WHERE organization_id=$1 AND ${column}=$2 LIMIT 1`,[organizationId,fileId]);
    if(used.rows[0])return label;
  }
  return null;
}
async function audit(runtime,{organizationId,userId,requestId,action,fileId,metadata,before=null,after=null}){
  if(typeof runtime.services?.audit?.write!=='function')return;
  await runtime.services.audit.write({organizationId,actorType:'human',actorId:userId,action,entityType:'school_file',entityId:fileId,before,after,requestId,metadata});
}

export default{
  name:'school-files',prefix:PREFIX,business:true,priority:45,
  enabled(config){return config.extensions?.['school-platform']?.enabled===true;},
  async handle({request,url,requestId,runtime}){
    const principal=await runtime.auth.authenticateRequest({headers:request.headers});
    const database=runtime.services.database;
    const storage=runtime.tenantStorage?.forOrganization?.(principal.organizationId);
    if(!storage)fail(503,'SCHOOL_FILES_STORAGE_NOT_READY','Self-hosted school file storage is unavailable');
    const suffix=url.pathname.slice(PREFIX.length).replace(/^\/+|\/+$/g,'');

    if(request.method==='GET'&&!suffix){
      runtime.auth.requireScope(principal,'school:read');await requireSchoolPermission(database,principal,'school.files:read');
      const limit=bounded(url.searchParams.get('limit'));
      const result=await database.query(`SELECT id,original_name,mime_type,size_bytes,checksum_sha256,purpose,created_at FROM school_files WHERE organization_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT $2`,[principal.organizationId,limit]);
      return{status:200,body:{data:result.rows.map(row=>publicMetadata(row))}};
    }

    if(request.method==='POST'&&!suffix){
      runtime.auth.requireScope(principal,'school:read');runtime.auth.requireScope(principal,'school:write');await requireSchoolPermission(database,principal,'school.files:write');
      const form=await parseMultipart(request),part=form.get('file');
      if(!part||typeof part!=='object'||typeof part.arrayBuffer!=='function')fail(422,'FILE_REQUIRED','Choose a file to upload');
      const fileSize=Number(part.size??0);if(fileSize<=0)fail(422,'EMPTY_FILE','The selected file is empty');if(fileSize>MAX_FILE_BYTES)fail(413,'FILE_TOO_LARGE',`The file is ${(fileSize/1024/1024).toFixed(1)} MB. School uploads are limited to 15 MB per file.`);
      const mime=String(part.type||'application/octet-stream').toLowerCase();if(!ALLOWED_MIME.has(mime))fail(415,'UNSUPPORTED_FILE_TYPE',`Files of type ${mime} are not allowed. Upload an image, PDF, Word, Excel, CSV, text, audio or supported video file.`);
      const fileId=id(),originalName=String(part.name||'file'),purpose=String(form.get('purpose')||'document').slice(0,80),now=new Date(),objectKey=`school/${now.getUTCFullYear()}/${String(now.getUTCMonth()+1).padStart(2,'0')}/${fileId}/${safeName(originalName)}`;
      const bytes=Buffer.from(await part.arrayBuffer()),checksum=createHash('sha256').update(bytes).digest('hex');
      await storage.put(objectKey,bytes,{contentType:mime,custom:{fileId,purpose,checksumSha256:checksum}});
      try{await database.query(`INSERT INTO school_files(id,organization_id,object_key,original_name,mime_type,size_bytes,checksum_sha256,purpose,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[fileId,principal.organizationId,objectKey,originalName,mime,fileSize,checksum,purpose,principal.userId]);}
      catch(error){await storage.delete(objectKey).catch(()=>undefined);throw error;}
      const data={id:fileId,originalName,mimeType:mime,sizeBytes:fileSize,checksum,purpose,contentUrl:`${PREFIX}/${encodeURIComponent(fileId)}/content`};
      await audit(runtime,{organizationId:principal.organizationId,userId:principal.userId,requestId,action:'school.file.uploaded',fileId,after:data,metadata:{originalName,mimeType:mime,sizeBytes:fileSize,purpose,checksum}});
      return{status:201,body:{data}};
    }

    let match=suffix.match(/^([^/]+)\/content$/);
    if(request.method==='GET'&&match){
      runtime.auth.requireScope(principal,'school:read');await requireSchoolPermission(database,principal,'school.files:read');
      const file=await ownedFile(database,principal.organizationId,decodeURIComponent(match[1]));
      let bytes;try{bytes=await storage.get(file.object_key);}catch(error){if(['NoSuchKey','NotFound','NoSuchObject'].includes(error?.code??error?.name))fail(404,'FILE_OBJECT_MISSING','The file metadata exists but its stored object is missing. Ask an administrator to restore the file.');throw error;}
      return{status:200,rawBody:bytes,headers:{'content-type':file.mime_type,'content-disposition':`inline; filename="${safeName(file.original_name)}"`,'etag':`"${file.checksum_sha256}"`}};
    }

    match=suffix.match(/^([^/]+)$/);
    if(match&&request.method==='GET'){
      runtime.auth.requireScope(principal,'school:read');await requireSchoolPermission(database,principal,'school.files:read');
      const file=await ownedFile(database,principal.organizationId,decodeURIComponent(match[1]));return{status:200,body:{data:publicMetadata(file,{contentUrl:true})}};
    }
    if(match&&request.method==='DELETE'){
      runtime.auth.requireScope(principal,'school:read');runtime.auth.requireScope(principal,'school:write');await requireSchoolPermission(database,principal,'school.files:write');
      const file=await ownedFile(database,principal.organizationId,decodeURIComponent(match[1])),usedBy=await referenceDescription(database,principal.organizationId,file.id);
      if(usedBy)fail(409,'FILE_IN_USE',`This file is currently used as a ${usedBy}. Remove or replace that reference before deleting the file.`);
      await storage.delete(file.object_key);await database.query(`UPDATE school_files SET deleted_at=now(),updated_at=now() WHERE id=$1 AND organization_id=$2`,[file.id,principal.organizationId]);
      await audit(runtime,{organizationId:principal.organizationId,userId:principal.userId,requestId,action:'school.file.deleted',fileId:file.id,before:camel(file),metadata:{originalName:file.original_name}});
      return{status:204,rawBody:Buffer.alloc(0)};
    }

    fail(404,'SCHOOL_FILES_ROUTE_NOT_FOUND','School file route not found');
  },
};
