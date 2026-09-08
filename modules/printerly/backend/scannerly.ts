// @ts-nocheck
import { AppError } from "../../../src/lib/errors";

const makeId=(prefix:string)=>`${prefix}_${crypto.randomUUID().replaceAll("-","")}`;
const now=()=>new Date().toISOString();
const token=()=>`${crypto.randomUUID().replaceAll("-","")}${crypto.randomUUID().replaceAll("-","")}`;
const MAX_SCAN_BYTES=50*1024*1024;
const SCAN_MIME=new Set(["application/pdf","image/png","image/jpeg"]);
const safeName=(name:string)=>{const x=String(name||"scan").normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"");return (x||"scan").slice(0,180)};
const digestBytes=async(value:BufferSource)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",value))).map(x=>x.toString(16).padStart(2,"0")).join("");

async function event(db:any,organizationId:string,scanJobId:string,eventType:string,actorId:string|null,details:any={}){
  await db.prepare("INSERT INTO prn_scan_events(id,organization_id,scan_job_id,event_type,actor_id,details_json) VALUES(?,?,?,?,?,?)").bind(makeId("prnsev"),organizationId,scanJobId,eventType,actorId,JSON.stringify(details||{})).run();
}

export async function syncScanners(db:any,node:any,items:any[]){
  const t=now(),seen:string[]=[];
  for(const raw of Array.isArray(items)?items:[]){
    const systemName=String(raw.systemName||raw.id||"").trim();if(!systemName)continue;seen.push(systemName);
    const existing=await db.prepare("SELECT id FROM prn_scanners WHERE organization_id=? AND node_id=? AND system_name=?").bind(node.organization_id,node.id,systemName).first<any>();
    if(existing)await db.prepare("UPDATE prn_scanners SET name=?,status=?,capabilities_json=?,last_seen_at=?,updated_at=? WHERE id=? AND organization_id=? AND node_id=?")
      .bind(String(raw.name||systemName),String(raw.status||"ready"),JSON.stringify(raw.capabilities||{}),t,t,existing.id,node.organization_id,node.id).run();
    else await db.prepare("INSERT INTO prn_scanners(id,organization_id,node_id,name,system_name,status,capabilities_json,last_seen_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .bind(makeId("prnscanr"),node.organization_id,node.id,String(raw.name||systemName),systemName,String(raw.status||"ready"),JSON.stringify(raw.capabilities||{}),t,t,t).run();
  }
  if(seen.length){const marks=seen.map(()=>"?").join(",");await db.prepare(`UPDATE prn_scanners SET status='offline',updated_at=? WHERE organization_id=? AND node_id=? AND system_name NOT IN (${marks})`).bind(t,node.organization_id,node.id,...seen).run()}
  else await db.prepare("UPDATE prn_scanners SET status='offline',updated_at=? WHERE organization_id=? AND node_id=?").bind(t,node.organization_id,node.id).run();
}

export async function listScanners(db:any,organizationId:string){
  const rows=await db.prepare(`SELECT s.id,s.node_id nodeId,s.name,s.system_name systemName,s.status,s.capabilities_json capabilitiesJson,s.last_seen_at lastSeenAt,n.name nodeName,n.location nodeLocation
    FROM prn_scanners s LEFT JOIN prn_nodes n ON n.id=s.node_id AND n.organization_id=s.organization_id WHERE s.organization_id=? ORDER BY s.name`).bind(organizationId).all<any>();
  return (rows.results||[]).map((r:any)=>({...r,capabilities:safeJson(r.capabilitiesJson,{})}));
}
function safeJson(v:any,f:any){try{return v?JSON.parse(String(v)):f}catch{return f}}

export async function scanTargets(db:any,organizationId:string,query=""){
  const q=`%${String(query||"").trim().slice(0,80)}%`;
  const [students,staff]=await Promise.all([
    db.prepare(`SELECT id,admission_number admissionNumber,student_number studentNumber,TRIM(first_name||' '||COALESCE(middle_name||' ','')||last_name) name FROM school_students
      WHERE organization_id=? AND deleted_at IS NULL AND status='active' AND (?='%%' OR admission_number LIKE ? OR student_number LIKE ? OR first_name LIKE ? OR last_name LIKE ?) ORDER BY first_name,last_name LIMIT 200`).bind(organizationId,q,q,q,q,q).all<any>().catch(()=>({results:[]})),
    db.prepare(`SELECT id,staff_number staffNumber,TRIM(first_name||' '||COALESCE(middle_name||' ','')||last_name) name FROM school_staff_profiles
      WHERE organization_id=? AND deleted_at IS NULL AND employment_status IN ('active','on_leave') AND (?='%%' OR staff_number LIKE ? OR first_name LIKE ? OR last_name LIKE ?) ORDER BY first_name,last_name LIMIT 200`).bind(organizationId,q,q,q,q).all<any>().catch(()=>({results:[]})),
  ]);
  return {students:students.results||[],staff:staff.results||[],modules:[{id:"finance",name:"Finance"},{id:"academics",name:"Academics"},{id:"exams",name:"Examinations"},{id:"school",name:"School Management"}]};
}

export async function createScanJob(db:any,organizationId:string,userId:string,data:any){
  const scannerId=String(data.scannerId||"").trim();if(!scannerId)throw new AppError(422,"SCANNER_REQUIRED","Choose a scanner");
  const scanner=await db.prepare("SELECT id,node_id nodeId,status FROM prn_scanners WHERE id=? AND organization_id=?").bind(scannerId,organizationId).first<any>();
  if(!scanner)throw new AppError(422,"INVALID_SCANNER","Selected scanner does not belong to this organization");
  if(scanner.status!=="ready")throw new AppError(409,"SCANNER_OFFLINE","Selected scanner is not currently ready");
  const source=String(data.source)==="adf"?"adf":"flatbed",colorMode=["color","gray","lineart"].includes(String(data.colorMode))?String(data.colorMode):"color";
  const resolution=Math.max(75,Math.min(1200,Math.round(Number(data.resolutionDpi)||300))),pageSize=["A4","A5","Letter","Legal"].includes(String(data.pageSize))?String(data.pageSize):"A4";
  let outputFormat=["pdf","png","jpeg"].includes(String(data.outputFormat))?String(data.outputFormat):"pdf";if(source==="adf")outputFormat="pdf";
  const targetType=["inbox","student","staff","module"].includes(String(data.targetType))?String(data.targetType):"inbox",targetId=data.targetId?String(data.targetId):null,targetModule=data.targetModule?String(data.targetModule):null;
  if(targetType==="student"){
    if(!targetId||!await db.prepare("SELECT 1 FROM school_students WHERE id=? AND organization_id=? AND deleted_at IS NULL").bind(targetId,organizationId).first())throw new AppError(422,"INVALID_SCAN_TARGET","Choose a valid student for this scan");
  }else if(targetType==="staff"){
    if(!targetId||!await db.prepare("SELECT 1 FROM school_staff_profiles WHERE id=? AND organization_id=? AND deleted_at IS NULL").bind(targetId,organizationId).first())throw new AppError(422,"INVALID_SCAN_TARGET","Choose a valid staff member for this scan");
  }else if(targetType==="module"&&!new Set(["finance","academics","exams","school"]).has(targetModule||""))throw new AppError(422,"INVALID_SCAN_TARGET","Choose a Ledgerly destination module");
  const id=makeId("prnscan"),created=now(),scanNumber=`SCN-${created.slice(0,4)}-${id.slice(-8).toUpperCase()}`;
  await db.prepare(`INSERT INTO prn_scan_jobs(id,organization_id,scan_number,title,scanner_id,status,source,color_mode,resolution_dpi,page_size,output_format,target_type,target_module,target_id,notes,created_by,created_at,updated_at)
    VALUES(?,?,?,?,?,'queued',?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,organizationId,scanNumber,String(data.title||"Scanned document").trim().slice(0,200),scannerId,source,colorMode,resolution,pageSize,outputFormat,targetType,targetModule,targetId,String(data.notes||"").slice(0,1000),userId,created,created).run();
  await event(db,organizationId,id,"created",userId,{scannerId,source,colorMode,resolution,pageSize,outputFormat,targetType,targetModule,targetId});
  return {id,scanNumber,status:"queued"};
}

export async function listScanJobs(db:any,organizationId:string,limit=150){
  const rows=await db.prepare(`SELECT j.id,j.scan_number scanNumber,j.title,j.scanner_id scannerId,s.name scannerName,j.node_id nodeId,j.status,j.source,j.color_mode colorMode,j.resolution_dpi resolutionDpi,j.page_size pageSize,j.output_format outputFormat,
    j.target_type targetType,j.target_module targetModule,j.target_id targetId,j.notes,j.error_message errorMessage,j.document_id documentId,j.created_at createdAt,j.completed_at completedAt,
    d.original_name documentName,d.mime_type mimeType,d.size_bytes sizeBytes,d.school_file_id schoolFileId
    FROM prn_scan_jobs j LEFT JOIN prn_scanners s ON s.id=j.scanner_id AND s.organization_id=j.organization_id LEFT JOIN prn_scan_documents d ON d.id=j.document_id AND d.organization_id=j.organization_id
    WHERE j.organization_id=? ORDER BY j.created_at DESC LIMIT ?`).bind(organizationId,Math.min(300,Math.max(1,limit))).all<any>();
  return rows.results||[];
}

export async function cancelScanJob(db:any,organizationId:string,userId:string,id:string){
  const r=await db.prepare("UPDATE prn_scan_jobs SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND status='queued'").bind(id,organizationId).run();
  if(!r.meta?.changes)throw new AppError(409,"INVALID_SCAN_STATE","Only queued Scannerly jobs can be cancelled");await event(db,organizationId,id,"cancelled",userId,{});return {id,status:"cancelled"};
}
export async function retryScanJob(db:any,organizationId:string,userId:string,id:string){
  const r=await db.prepare("UPDATE prn_scan_jobs SET status='queued',node_id=NULL,claim_token=NULL,claim_expires_at=NULL,error_message=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND status='failed'").bind(id,organizationId).run();
  if(!r.meta?.changes)throw new AppError(409,"INVALID_SCAN_STATE","Only failed Scannerly jobs can be retried");await event(db,organizationId,id,"retried",userId,{});return {id,status:"queued"};
}

export async function claimScanJob(db:any,node:any,data:any){
  const requested=Array.isArray(data.scannerSystemNames)?data.scannerSystemNames.map(String).filter(Boolean):[];if(!requested.length)return null;
  const t=now();
  await db.prepare("UPDATE prn_scan_jobs SET status='queued',node_id=NULL,claim_token=NULL,claim_expires_at=NULL,updated_at=? WHERE organization_id=? AND status='claimed' AND claim_expires_at IS NOT NULL AND claim_expires_at<=?").bind(t,node.organization_id,t).run();
  const marks=requested.map(()=>"?").join(","),local=(await db.prepare(`SELECT id,system_name systemName FROM prn_scanners WHERE organization_id=? AND node_id=? AND status='ready' AND system_name IN (${marks})`).bind(node.organization_id,node.id,...requested).all<any>()).results||[];if(!local.length)return null;
  const ids=local.map((x:any)=>x.id),idMarks=ids.map(()=>"?").join(",");
  const job=await db.prepare(`SELECT * FROM prn_scan_jobs WHERE organization_id=? AND status='queued' AND scanner_id IN (${idMarks}) ORDER BY created_at LIMIT 1`).bind(node.organization_id,...ids).first<any>();if(!job)return null;
  const scanner=local.find((x:any)=>x.id===job.scanner_id);if(!scanner)return null;
  const claim=token(),expires=new Date(Date.now()+15*60*1000).toISOString();
  const r=await db.prepare("UPDATE prn_scan_jobs SET status='claimed',node_id=?,claim_token=?,claim_expires_at=?,updated_at=? WHERE id=? AND organization_id=? AND status='queued'").bind(node.id,claim,expires,t,job.id,node.organization_id).run();if(!r.meta?.changes)return null;
  await event(db,node.organization_id,job.id,"claimed",node.id,{scannerId:scanner.id,systemName:scanner.systemName});
  return {...job,status:"claimed",node_id:node.id,scanner_system_name:scanner.systemName,claim_token:claim,claim_expires_at:expires};
}

export async function scanJobStatus(db:any,node:any,id:string,data:any){
  const requested=String(data.status||""),allowed=new Set(["scanning","uploading","failed"]);if(!allowed.has(requested))throw new AppError(422,"INVALID_SCAN_STATUS","Invalid Scannerly status");
  const claim=String(data.claimToken||""),job=await db.prepare("SELECT status,claim_token claimToken FROM prn_scan_jobs WHERE id=? AND organization_id=? AND node_id=?").bind(id,node.organization_id,node.id).first<any>();
  if(!job||job.claimToken!==claim)throw new AppError(409,"SCAN_CLAIM_INVALID","Scannerly claim is no longer valid");if(job.status===requested)return {id,status:requested,duplicate:true};
  const transitions:any={claimed:new Set(["scanning","failed"]),scanning:new Set(["uploading","failed"]),uploading:new Set(["failed"])};if(!transitions[job.status]?.has(requested))throw new AppError(409,"INVALID_SCAN_TRANSITION",`Cannot move Scannerly job from ${job.status} to ${requested}`);
  const lease=requested!=="failed"?new Date(Date.now()+15*60*1000).toISOString():null;
  const r=await db.prepare("UPDATE prn_scan_jobs SET status=?,error_message=?,claim_expires_at=COALESCE(?,claim_expires_at),updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND node_id=? AND claim_token=? AND status=?")
    .bind(requested,String(data.errorMessage||"").slice(0,1000),lease,id,node.organization_id,node.id,claim,job.status).run();if(!r.meta?.changes)throw new AppError(409,"SCAN_CLAIM_INVALID","Scannerly job changed while this node was reporting status");
  await event(db,node.organization_id,id,requested,node.id,{errorMessage:data.errorMessage||null});return {id,status:requested};
}

export async function uploadScanResult(db:any,workBucket:any,node:any,id:string,claimToken:string,form:FormData){
  if(!claimToken)throw new AppError(401,"SCAN_CLAIM_REQUIRED","Missing Scannerly claim token");
  const job=await db.prepare("SELECT * FROM prn_scan_jobs WHERE id=? AND organization_id=? AND node_id=? AND claim_token=? AND status IN ('scanning','uploading')").bind(id,node.organization_id,node.id,claimToken).first<any>();if(!job)throw new AppError(409,"SCAN_CLAIM_INVALID","Scannerly claim is no longer valid");
  const part=form.get("file");if(!(part instanceof File))throw new AppError(422,"SCAN_FILE_REQUIRED","Scannerly result file is missing");if(part.size<=0)throw new AppError(422,"EMPTY_SCAN","Scannerly result is empty");if(part.size>MAX_SCAN_BYTES)throw new AppError(413,"SCAN_TOO_LARGE","Scannerly results are limited to 50 MB");
  const mime=String(part.type||"").toLowerCase();if(!SCAN_MIME.has(mime))throw new AppError(415,"UNSUPPORTED_SCAN_TYPE","Scannerly accepts PDF, PNG or JPEG output");
  const bytes=await part.arrayBuffer(),checksum=await digestBytes(bytes),docId=makeId("prnscandoc"),created=now(),name=safeName(part.name||`${job.scan_number}.${job.output_format}`),objectKey=`printerly/${node.organization_id}/scans/${created.slice(0,7)}/${docId}/${name}`;
  await workBucket.put(objectKey,bytes,{httpMetadata:{contentType:mime,contentDisposition:`inline; filename="${name}"`},customMetadata:{organizationId:node.organization_id,scanJobId:id,checksum}});
  let school:any=null;
  try{
    if(job.target_type==="student"||job.target_type==="staff")school=await prepareSchoolDocument(db,workBucket,node.organization_id,job,part.name||name,mime,bytes,checksum);
    const statements:any[]=[...(school?.statements||[]),
      db.prepare(`INSERT INTO prn_scan_documents(id,organization_id,scan_job_id,object_key,original_name,mime_type,size_bytes,checksum_sha256,target_type,target_module,target_id,school_file_id)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(docId,node.organization_id,id,objectKey,part.name||name,mime,part.size,checksum,job.target_type,job.target_module||null,job.target_id||null,school?.fileId||null),
      db.prepare("UPDATE prn_scan_jobs SET status='completed',document_id=?,error_message=NULL,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND node_id=? AND claim_token=?").bind(docId,id,node.organization_id,node.id,claimToken),
    ];
    await db.batch(statements);
  }catch(error){await workBucket.delete(objectKey);if(school?.objectKey)await workBucket.delete(school.objectKey);throw error}
  await event(db,node.organization_id,id,"completed",node.id,{documentId:docId,mime,sizeBytes:part.size,schoolFileId:school?.fileId||null});
  return {id,scanNumber:job.scan_number,status:"completed",documentId:docId,schoolFileId:school?.fileId||null};
}

async function prepareSchoolDocument(db:any,bucket:any,organizationId:string,job:any,originalName:string,mime:string,bytes:ArrayBuffer,checksum:string){
  const fileId=makeId("sfl"),date=new Date(),safe=safeName(originalName),objectKey=`school/${organizationId}/${date.getUTCFullYear()}/${String(date.getUTCMonth()+1).padStart(2,"0")}/${fileId}/${safe}`;
  await bucket.put(objectKey,bytes,{httpMetadata:{contentType:mime,contentDisposition:`inline; filename="${safe}"`},customMetadata:{organizationId,fileId,purpose:"scannerly",checksum}});
  const statements:any[]=[db.prepare("INSERT INTO school_files(id,organization_id,object_key,original_name,mime_type,size_bytes,checksum_sha256,purpose,uploaded_by) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(fileId,organizationId,objectKey,originalName,mime,bytes.byteLength,checksum,"scannerly",job.created_by||null)];
  if(job.target_type==="student")statements.push(db.prepare(`INSERT INTO school_student_documents(id,organization_id,student_id,document_type,name,object_key,mime_type,size_bytes,checksum,uploaded_by,file_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(makeId("stdoc"),organizationId,job.target_id,"scannerly",job.title,objectKey,mime,bytes.byteLength,checksum,job.created_by||null,fileId));
  else statements.push(db.prepare(`INSERT INTO school_staff_documents(id,organization_id,staff_id,document_type,name,file_id,notes,uploaded_by) VALUES(?,?,?,?,?,?,?,?)`)
    .bind(makeId("stfdoc"),organizationId,job.target_id,"scannerly",job.title,fileId,job.notes||null,job.created_by||null));
  return {fileId,objectKey,statements};
}

export async function getScanDocument(db:any,bucket:any,organizationId:string,documentId:string){
  const row=await db.prepare("SELECT object_key objectKey,original_name originalName,mime_type mimeType,size_bytes sizeBytes,checksum_sha256 checksum FROM prn_scan_documents WHERE id=? AND organization_id=?").bind(documentId,organizationId).first<any>();if(!row)throw new AppError(404,"SCAN_DOCUMENT_NOT_FOUND","Scannerly document not found");
  const object=await bucket.get(row.objectKey);if(!object)throw new AppError(404,"SCAN_OBJECT_MISSING","Scannerly document is missing from object storage");return {...row,object};
}

export async function scanSummary(db:any,organizationId:string){
  const [scanners,jobs]=await Promise.all([
    db.prepare("SELECT COUNT(*) total,SUM(CASE WHEN status='ready' THEN 1 ELSE 0 END) ready FROM prn_scanners WHERE organization_id=?").bind(organizationId).first<any>(),
    db.prepare("SELECT COUNT(*) total,SUM(CASE WHEN status IN ('queued','claimed','scanning','uploading') THEN 1 ELSE 0 END) active,SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed FROM prn_scan_jobs WHERE organization_id=?").bind(organizationId).first<any>()
  ]);return {scanners,jobs};
}
export async function listModuleInbox(db:any,organizationId:string,moduleKey:string,limit=80){
  const allowed=new Set(["finance","academics","exams","school"]),module=String(moduleKey||"").trim();
  if(!allowed.has(module))throw new AppError(422,"INVALID_SCAN_MODULE","Choose Finance, Academics, Examinations or School Management");
  const rows=await db.prepare(`SELECT j.id,j.scan_number scanNumber,j.title,j.notes,j.completed_at completedAt,j.created_at createdAt,s.name scannerName,
    d.id documentId,d.original_name documentName,d.mime_type mimeType,d.size_bytes sizeBytes
    FROM prn_scan_jobs j JOIN prn_scan_documents d ON d.scan_job_id=j.id AND d.organization_id=j.organization_id
    LEFT JOIN prn_scanners s ON s.id=j.scanner_id AND s.organization_id=j.organization_id
    WHERE j.organization_id=? AND j.status='completed' AND j.target_type='module' AND j.target_module=?
    ORDER BY COALESCE(j.completed_at,j.created_at) DESC LIMIT ?`).bind(organizationId,module,Math.min(200,Math.max(1,limit))).all<any>();
  return rows.results||[];
}
