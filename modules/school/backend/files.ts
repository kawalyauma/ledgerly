import { Hono } from "hono";
import type { AppVariables, Env } from "../../../src/types";
import { requireScope } from "../../../src/lib/auth";
import { AppError } from "../../../src/lib/errors";
import { createId } from "../../../src/lib/ids";
import { audit, schoolPermission } from "./common";

export const schoolFileRoutes = new Hono<{Bindings:Env;Variables:AppVariables}>();
schoolFileRoutes.use("*", requireScope("school:read"));

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "image/jpeg","image/png","image/webp","image/gif","image/svg+xml",
  "application/pdf","text/plain","text/csv",
  "audio/mpeg","audio/mp4","audio/wav","audio/x-wav","audio/ogg",
  "video/mp4","video/webm","video/quicktime",
  "application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);

function safeName(name:string){
  const cleaned=name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"");
  return (cleaned||"file").slice(0,180);
}
function hex(buffer:ArrayBuffer){return [...new Uint8Array(buffer)].map(x=>x.toString(16).padStart(2,"0")).join("")}
async function ownedFile(db:D1Database,organizationId:string,fileId:string){
  const row=await db.prepare(`SELECT id,object_key AS objectKey,original_name AS originalName,mime_type AS mimeType,size_bytes AS sizeBytes,checksum_sha256 AS checksum,purpose,created_at AS createdAt
    FROM school_files WHERE id=? AND organization_id=? AND deleted_at IS NULL`).bind(fileId,organizationId).first<Record<string,unknown>>();
  if(!row)throw new AppError(404,"FILE_NOT_FOUND","School file not found");
  return row as {id:string;objectKey:string;originalName:string;mimeType:string;sizeBytes:number;checksum:string;purpose:string;createdAt:string};
}

schoolFileRoutes.get("/",schoolPermission("school.files:read"),async c=>{
  const p=c.get("principal"),limit=Math.max(1,Math.min(Number(c.req.query("limit")||100),500));
  const rows=await c.env.FINANCE_DB.prepare(`SELECT id,original_name AS originalName,mime_type AS mimeType,size_bytes AS sizeBytes,checksum_sha256 AS checksum,purpose,created_at AS createdAt
    FROM school_files WHERE organization_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?`).bind(p.organizationId,limit).all();
  return c.json({data:rows.results});
});

schoolFileRoutes.post("/",requireScope("school:write"),schoolPermission("school.files:write"),async c=>{
  const p=c.get("principal"),form=await c.req.formData(),part=form.get("file");
  if(!(part instanceof File))throw new AppError(422,"FILE_REQUIRED","Choose a file to upload");
  if(part.size<=0)throw new AppError(422,"EMPTY_FILE","The selected file is empty");
  if(part.size>MAX_FILE_BYTES)throw new AppError(413,"FILE_TOO_LARGE",`The file is ${(part.size/1024/1024).toFixed(1)} MB. School uploads are limited to 15 MB per file.`);
  const mime=(part.type||"application/octet-stream").toLowerCase();
  if(!ALLOWED_MIME.has(mime))throw new AppError(415,"UNSUPPORTED_FILE_TYPE",`Files of type ${mime} are not allowed. Upload an image, PDF, Word, Excel, CSV, text, audio or supported video file.`);
  const purpose=String(form.get("purpose")||"document").slice(0,80),fileId=createId("sfl"),now=new Date();
  const objectKey=`school/${p.organizationId}/${now.getUTCFullYear()}/${String(now.getUTCMonth()+1).padStart(2,"0")}/${fileId}/${safeName(part.name)}`;
  const bytes=await part.arrayBuffer(),checksum=hex(await crypto.subtle.digest("SHA-256",bytes));
  await c.env.REPORTS_BUCKET.put(objectKey,bytes,{httpMetadata:{contentType:mime,contentDisposition:`inline; filename="${safeName(part.name)}"`},customMetadata:{organizationId:p.organizationId,fileId,purpose,checksum}});
  try{
    await c.env.FINANCE_DB.prepare(`INSERT INTO school_files(id,organization_id,object_key,original_name,mime_type,size_bytes,checksum_sha256,purpose,uploaded_by) VALUES(?,?,?,?,?,?,?,?,?)`)
      .bind(fileId,p.organizationId,objectKey,part.name,mime,part.size,checksum,purpose,p.userId).run();
  }catch(error){await c.env.REPORTS_BUCKET.delete(objectKey);throw error}
  await audit(c.env.FINANCE_DB,c,"school.file.uploaded","school_file",fileId,{originalName:part.name,mimeType:mime,sizeBytes:part.size,purpose});
  return c.json({data:{id:fileId,originalName:part.name,mimeType:mime,sizeBytes:part.size,checksum,purpose,contentUrl:`/api/v1/school/files/${fileId}/content`}},201);
});

schoolFileRoutes.get("/:id",schoolPermission("school.files:read"),async c=>{
  const p=c.get("principal"),file=await ownedFile(c.env.FINANCE_DB,p.organizationId,c.req.param("id"));
  return c.json({data:{...file,objectKey:undefined,contentUrl:`/api/v1/school/files/${file.id}/content`}});
});

schoolFileRoutes.get("/:id/content",schoolPermission("school.files:read"),async c=>{
  const p=c.get("principal"),file=await ownedFile(c.env.FINANCE_DB,p.organizationId,c.req.param("id")),obj=await c.env.REPORTS_BUCKET.get(file.objectKey);
  if(!obj)throw new AppError(404,"FILE_OBJECT_MISSING","The file metadata exists but its R2 object is missing. Ask an administrator to restore the file.");
  c.header("Content-Type",file.mimeType);c.header("Content-Length",String(file.sizeBytes));
  c.header("Content-Disposition",`inline; filename="${safeName(file.originalName)}"`);c.header("ETag",obj.httpEtag);
  return c.body(obj.body);
});

async function referenceDescription(db:D1Database,organizationId:string,fileId:string){
  const checks:Array<[string,string,string]>= [
    ["school_profiles","logo_file_id","school profile logo"],
    ["school_user_profiles","profile_photo_file_id","user profile photo"],
    ["school_user_profiles","signature_file_id","user signature"],
    ["school_document_templates","file_id","document template"],
    ["school_student_documents","file_id","student document"],
    ["school_students","profile_photo_file_id","student profile photo"],
    ["school_guardians","profile_photo_file_id","guardian profile photo"],
    ["school_authorized_pickups","photo_file_id","authorized-pickup photo"],
    ["school_staff_profiles","profile_photo_file_id","staff profile photo"],
    ["school_staff_documents","file_id","staff document"],
    ["school_staff_qualifications","file_id","staff qualification evidence"],
    ["school_fee_receipts","supporting_file_id","school fee receipt supporting document"],
    ["school_discipline_attachments","file_id","discipline / offence evidence"],
    ["acad_delivery_attachments","file_id","academic lesson-delivery evidence"],
    ["acad_observation_attachments","file_id","academic observation evidence"],
    ["acad_inspection_attachments","file_id","academic inspection evidence"]
  ];
  for(const [table,column,label] of checks){
    try{const row=await db.prepare(`SELECT 1 FROM ${table} WHERE organization_id=? AND ${column}=? LIMIT 1`).bind(organizationId,fileId).first();if(row)return label}catch{/* migration may not yet contain a newer table during staged upgrades */}
  }
  return null;
}

schoolFileRoutes.delete("/:id",requireScope("school:write"),schoolPermission("school.files:write"),async c=>{
  const p=c.get("principal"),file=await ownedFile(c.env.FINANCE_DB,p.organizationId,c.req.param("id")),usedBy=await referenceDescription(c.env.FINANCE_DB,p.organizationId,file.id);
  if(usedBy)throw new AppError(409,"FILE_IN_USE",`This file is currently used as a ${usedBy}. Remove or replace that reference before deleting the file.`);
  await c.env.REPORTS_BUCKET.delete(file.objectKey);
  await c.env.FINANCE_DB.prepare("UPDATE school_files SET deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(file.id,p.organizationId).run();
  await audit(c.env.FINANCE_DB,c,"school.file.deleted","school_file",file.id,{originalName:file.originalName});
  return c.body(null,204);
});
