// @ts-nocheck
import { AppError } from "../../../src/lib/errors";

const now=()=>new Date().toISOString();
const makeId=(prefix:string)=>`${prefix}_${crypto.randomUUID().replaceAll("-","")}`;
const pairingCode=()=>String(Math.floor(100000+Math.random()*900000));
const machineToken=()=>`${crypto.randomUUID().replaceAll("-","")}${crypto.randomUUID().replaceAll("-","")}`;
const digestBytes=async(value:BufferSource)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",value))).map(x=>x.toString(16).padStart(2,"0")).join("");
const hash=async(value:string)=>digestBytes(new TextEncoder().encode(value));
const safeName=(name:string)=>{
  const cleaned=String(name||"document").normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"");
  return (cleaned||"document").slice(0,180);
};
const MAX_DOCUMENT_BYTES=50*1024*1024;
const PRINTABLE_MIME=new Set(["application/pdf","image/jpeg","image/png","text/plain"]);

export async function overview(db:any,organizationId:string){
  const [nodes,printers,jobs]=await Promise.all([
    db.prepare("SELECT COUNT(*) total, SUM(CASE WHEN status='online' THEN 1 ELSE 0 END) online FROM prn_nodes WHERE organization_id=? AND revoked_at IS NULL").bind(organizationId).first(),
    db.prepare("SELECT COUNT(*) total, SUM(CASE WHEN status='ready' THEN 1 ELSE 0 END) ready FROM prn_printers WHERE organization_id=?").bind(organizationId).first(),
    db.prepare("SELECT COUNT(*) total, SUM(CASE WHEN status IN ('queued','held','claimed','downloading','spooling','printing') THEN 1 ELSE 0 END) active, SUM(CASE WHEN status='completed' THEN COALESCE(total_sheets,0) ELSE 0 END) sheets FROM prn_jobs WHERE organization_id=?").bind(organizationId).first()
  ]);
  return {nodes,printers,jobs};
}

export async function listNodes(db:any,organizationId:string){
  return (await db.prepare("SELECT id,name,location,status,last_seen_at,version,created_at FROM prn_nodes WHERE organization_id=? AND revoked_at IS NULL ORDER BY created_at DESC").bind(organizationId).all()).results||[];
}

export async function createNode(db:any,organizationId:string,userId:string,data:any){
  const nodeId=makeId("prnnode"),created=now(),expires=new Date(Date.now()+10*60*1000).toISOString();
  let code="";
  for(let attempt=0;attempt<10;attempt++){
    code=pairingCode();
    const exists=await db.prepare("SELECT 1 FROM prn_nodes WHERE pairing_code_hash=? AND pairing_expires_at>CURRENT_TIMESTAMP AND revoked_at IS NULL LIMIT 1").bind(await hash(code)).first();
    if(!exists)break;
    code="";
  }
  if(!code)throw new AppError(503,"PAIRING_CODE_UNAVAILABLE","Could not allocate a unique pairing code. Try again.");
  await db.prepare("INSERT INTO prn_nodes(id,organization_id,name,location,status,pairing_code_hash,pairing_expires_at,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .bind(nodeId,organizationId,String(data.name||"Printerly Node").trim(),String(data.location||"").trim(),"pairing",await hash(code),expires,userId,created,created).run();
  return {id:nodeId,pairingCode:code,pairingExpiresAt:expires};
}

export async function revokeNode(db:any,organizationId:string,nodeId:string){
  const t=now();
  const r=await db.prepare("UPDATE prn_nodes SET status='revoked',revoked_at=?,token_hash=NULL,updated_at=? WHERE id=? AND organization_id=? AND revoked_at IS NULL").bind(t,t,nodeId,organizationId).run();
  if(!r.meta?.changes)throw new AppError(404,"NOT_FOUND","Printerly node not found");
  await db.prepare("UPDATE prn_printers SET status='offline',updated_at=? WHERE organization_id=? AND node_id=?").bind(t,organizationId,nodeId).run();
  return {id:nodeId,status:"revoked"};
}

export async function pairNode(db:any,data:any){
  const code=String(data.pairingCode||"").replace(/\s/g,"").trim();
  if(!/^\d{6}$/.test(code))throw new AppError(422,"VALIDATION_ERROR","Enter the six-digit pairing code");
  const node=await db.prepare("SELECT * FROM prn_nodes WHERE pairing_code_hash=? AND revoked_at IS NULL").bind(await hash(code)).first();
  if(!node||!node.pairing_expires_at||node.pairing_expires_at<now())throw new AppError(401,"PAIRING_INVALID","Pairing code is invalid or expired");
  const secret=machineToken(),t=now();
  await db.prepare("UPDATE prn_nodes SET token_hash=?,pairing_code_hash=NULL,pairing_expires_at=NULL,status='online',last_seen_at=?,version=?,updated_at=? WHERE id=?")
    .bind(await hash(secret),t,String(data.version||"1.1.0"),t,node.id).run();
  return {nodeId:node.id,organizationId:node.organization_id,nodeToken:secret,name:node.name};
}

export async function authenticateNode(db:any,bearer:string){
  if(!bearer)throw new AppError(401,"NODE_UNAUTHORIZED","Missing Printerly node token");
  const node=await db.prepare("SELECT * FROM prn_nodes WHERE token_hash=? AND revoked_at IS NULL").bind(await hash(bearer)).first();
  if(!node)throw new AppError(401,"NODE_UNAUTHORIZED","Invalid Printerly node token");
  return node;
}

export async function heartbeat(db:any,node:any,data:any){
  const t=now();
  await db.prepare("UPDATE prn_nodes SET status='online',last_seen_at=?,version=?,updated_at=? WHERE id=?").bind(t,String(data.version||node.version||""),t,node.id).run();
  const seen:string[]=[];
  for(const p of Array.isArray(data.printers)?data.printers:[]){
    const systemName=String(p.systemName||p.id||p.name||"").trim();
    if(!systemName)continue;
    seen.push(systemName);
    const existing=await db.prepare("SELECT id FROM prn_printers WHERE organization_id=? AND node_id=? AND system_name=?").bind(node.organization_id,node.id,systemName).first<{id:string}>();
    const printerId=existing?.id||makeId("prnp");
    if(existing){
      await db.prepare("UPDATE prn_printers SET name=?,location=?,status=?,capabilities_json=?,last_seen_at=?,updated_at=? WHERE id=? AND organization_id=? AND node_id=?")
        .bind(String(p.name||systemName),String(p.location||node.location||""),String(p.status||"ready"),JSON.stringify(p.capabilities||{}),t,t,printerId,node.organization_id,node.id).run();
    }else{
      await db.prepare("INSERT INTO prn_printers(id,organization_id,node_id,name,system_name,location,status,capabilities_json,last_seen_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        .bind(printerId,node.organization_id,node.id,String(p.name||systemName),systemName,String(p.location||node.location||""),String(p.status||"ready"),JSON.stringify(p.capabilities||{}),t,t,t).run();
    }
  }
  if(seen.length){
    const placeholders=seen.map(()=>"?").join(",");
    await db.prepare(`UPDATE prn_printers SET status='offline',updated_at=? WHERE organization_id=? AND node_id=? AND system_name NOT IN (${placeholders})`).bind(t,node.organization_id,node.id,...seen).run();
  }else{
    await db.prepare("UPDATE prn_printers SET status='offline',updated_at=? WHERE organization_id=? AND node_id=?").bind(t,node.organization_id,node.id).run();
  }
  return {ok:true,serverTime:t};
}

export async function listPrinters(db:any,organizationId:string){
  return (await db.prepare("SELECT id,node_id nodeId,name,system_name systemName,location,status,capabilities_json capabilitiesJson,last_seen_at lastSeenAt FROM prn_printers WHERE organization_id=? ORDER BY name").bind(organizationId).all()).results||[];
}

export async function uploadDocument(db:any,bucket:any,organizationId:string,userId:string,form:FormData){
  const part=form.get("file");
  if(!(part instanceof File))throw new AppError(422,"FILE_REQUIRED","Choose a document to print");
  if(part.size<=0)throw new AppError(422,"EMPTY_FILE","The selected document is empty");
  if(part.size>MAX_DOCUMENT_BYTES)throw new AppError(413,"FILE_TOO_LARGE","Printerly documents are limited to 50 MB");
  const mime=(part.type||"application/octet-stream").toLowerCase();
  if(!PRINTABLE_MIME.has(mime))throw new AppError(415,"UNSUPPORTED_PRINT_FILE","Printerly currently accepts PDF, PNG, JPEG and plain-text documents. Convert Word/Excel files to PDF before printing.");
  const documentId=makeId("prndoc"),created=now(),name=safeName(part.name);
  const objectKey=`printerly/${organizationId}/${created.slice(0,7)}/${documentId}/${name}`;
  const bytes=await part.arrayBuffer(),checksum=await digestBytes(bytes);
  await bucket.put(objectKey,bytes,{httpMetadata:{contentType:mime,contentDisposition:`inline; filename="${name}"`},customMetadata:{organizationId,documentId,checksum}});
  try{
    await db.prepare("INSERT INTO prn_documents(id,organization_id,object_key,original_name,mime_type,size_bytes,checksum_sha256,status,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,'staged',?,?)")
      .bind(documentId,organizationId,objectKey,part.name,mime,part.size,checksum,userId,created).run();
  }catch(error){
    await bucket.delete(objectKey);
    throw error;
  }
  return {id:documentId,originalName:part.name,mimeType:mime,sizeBytes:part.size,checksum};
}

export async function deleteStagedDocument(db:any,bucket:any,organizationId:string,documentId:string){
  const doc=await db.prepare("SELECT object_key objectKey,status FROM prn_documents WHERE id=? AND organization_id=?").bind(documentId,organizationId).first<any>();
  if(!doc)throw new AppError(404,"DOCUMENT_NOT_FOUND","Printerly document not found");
  if(doc.status!=="staged")throw new AppError(409,"DOCUMENT_IN_USE","This document is already attached to a print job");
  await bucket.delete(doc.objectKey);
  await db.prepare("UPDATE prn_documents SET status='deleted',deleted_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND status='staged'").bind(documentId,organizationId).run();
  return {id:documentId,deleted:true};
}

export async function listJobs(db:any,organizationId:string,limit=100){
  return (await db.prepare(`SELECT j.id,j.job_number jobNumber,j.title,j.status,j.priority,j.copies,j.page_size pageSize,j.color_mode colorMode,j.duplex,
    j.secure_release secureRelease,j.total_sheets totalSheets,j.printer_id printerId,j.node_id nodeId,j.error_message errorMessage,j.created_at createdAt,
    j.completed_at completedAt,d.original_name documentName,d.mime_type documentMime
    FROM prn_jobs j LEFT JOIN prn_documents d ON d.id=j.document_id AND d.organization_id=j.organization_id
    WHERE j.organization_id=? ORDER BY j.created_at DESC LIMIT ?`).bind(organizationId,Math.min(200,Math.max(1,limit))).all()).results||[];
}

export async function createJob(db:any,organizationId:string,userId:string,data:any){
  const documentId=String(data.documentId||"").trim();
  if(!documentId)throw new AppError(422,"VALIDATION_ERROR","Upload a document before creating the print job");
  const doc=await db.prepare("SELECT id,mime_type mimeType,checksum_sha256 checksum,status FROM prn_documents WHERE id=? AND organization_id=?").bind(documentId,organizationId).first<any>();
  if(!doc||doc.status!=="staged")throw new AppError(409,"DOCUMENT_UNAVAILABLE","The uploaded document is missing, expired, or already attached to another job");
  const printerId=data.printerId?String(data.printerId):null;
  if(printerId){
    const printer=await db.prepare("SELECT id FROM prn_printers WHERE id=? AND organization_id=?").bind(printerId,organizationId).first();
    if(!printer)throw new AppError(422,"INVALID_PRINTER","Selected printer does not belong to this organization");
  }
  const priorities=new Set(["urgent","high","normal","bulk"]),pageSizes=new Set(["A4","A5","Letter","Legal"]),colors=new Set(["monochrome","color"]);
  const priority=priorities.has(String(data.priority))?String(data.priority):"normal";
  const pageSize=pageSizes.has(String(data.pageSize))?String(data.pageSize):"A4";
  const colorMode=colors.has(String(data.colorMode))?String(data.colorMode):"monochrome";
  const jobId=makeId("prnjob"),created=now(),copies=Math.max(1,Math.min(1000,Number(data.copies)||1)),pages=Math.max(1,Math.min(10000,Number(data.estimatedPages)||1));
  const secure=Boolean(data.secureRelease),status=secure?"held":"queued",number=`PRT-${created.slice(0,4)}-${jobId.slice(-8).toUpperCase()}`;
  const eventId=makeId("prnev");
  await db.batch([
    db.prepare("INSERT INTO prn_jobs(id,organization_id,job_number,title,document_url,document_id,document_mime,document_sha256,printer_id,status,priority,copies,page_size,color_mode,duplex,secure_release,total_sheets,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(jobId,organizationId,number,String(data.title||"Print job").trim().slice(0,200),`printerly-document:${documentId}`,documentId,doc.mimeType,doc.checksum,printerId,status,priority,copies,pageSize,colorMode,data.duplex?1:0,secure?1:0,copies*pages,userId,created,created),
    db.prepare("UPDATE prn_documents SET status='attached',job_id=?,attached_at=? WHERE id=? AND organization_id=? AND status='staged'").bind(jobId,created,documentId,organizationId),
    db.prepare("INSERT INTO prn_job_events(id,organization_id,job_id,event_type,actor_id,details_json,created_at) VALUES(?,?,?,?,?,?,?)")
      .bind(eventId,organizationId,jobId,"created",userId,JSON.stringify({status,priority,copies,pageSize,colorMode,duplex:Boolean(data.duplex)}),created)
  ]);
  return {id:jobId,jobNumber:number,status};
}

export async function releaseJob(db:any,organizationId:string,userId:string,jobId:string){
  const t=now(),r=await db.prepare("UPDATE prn_jobs SET status='queued',released_at=?,updated_at=? WHERE id=? AND organization_id=? AND status='held'").bind(t,t,jobId,organizationId).run();
  if(!r.meta?.changes)throw new AppError(409,"INVALID_STATE","Only held jobs can be released");
  await addEvent(db,jobId,organizationId,"released",userId,{});
  return {id:jobId,status:"queued"};
}

export async function cancelJob(db:any,organizationId:string,userId:string,jobId:string){
  const t=now(),r=await db.prepare("UPDATE prn_jobs SET status='cancelled',updated_at=? WHERE id=? AND organization_id=? AND status IN ('queued','held')").bind(t,jobId,organizationId).run();
  if(!r.meta?.changes)throw new AppError(409,"INVALID_STATE","Only queued or held jobs can be cancelled");
  await addEvent(db,jobId,organizationId,"cancelled",userId,{});
  return {id:jobId,status:"cancelled"};
}

export async function claimJob(db:any,node:any,data:any){
  const requested=Array.isArray(data.printerSystemNames)?data.printerSystemNames.map(String).filter(Boolean):[];
  if(!requested.length)return null;
  const t=now();
  await db.prepare("UPDATE prn_jobs SET status='queued',node_id=NULL,claim_token=NULL,claim_expires_at=NULL,updated_at=? WHERE organization_id=? AND status IN ('claimed','downloading') AND claim_expires_at IS NOT NULL AND claim_expires_at<=?")
    .bind(t,node.organization_id,t).run();

  const placeholders=requested.map(()=>"?").join(",");
  const local=(await db.prepare(`SELECT id,system_name systemName FROM prn_printers WHERE organization_id=? AND node_id=? AND status='ready' AND system_name IN (${placeholders})`)
    .bind(node.organization_id,node.id,...requested).all<any>()).results||[];
  if(!local.length)return null;
  const ids=local.map((p:any)=>p.id),idPlaceholders=ids.map(()=>"?").join(",");
  const job=await db.prepare(`SELECT * FROM prn_jobs WHERE organization_id=? AND status='queued' AND (printer_id IS NULL OR printer_id IN (${idPlaceholders}))
    ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, created_at LIMIT 1`).bind(node.organization_id,...ids).first<any>();
  if(!job)return null;
  const target=job.printer_id?local.find((p:any)=>p.id===job.printer_id):local[0];
  if(!target)return null;
  const claim=makeId("claim"),expires=new Date(Date.now()+15*60*1000).toISOString();
  const r=await db.prepare("UPDATE prn_jobs SET status='claimed',node_id=?,printer_id=?,claim_token=?,claim_expires_at=?,updated_at=? WHERE id=? AND organization_id=? AND status='queued'")
    .bind(node.id,target.id,claim,expires,t,job.id,node.organization_id).run();
  if(!r.meta?.changes)return null;
  await addEvent(db,job.id,node.organization_id,"claimed",node.id,{printerId:target.id,systemName:target.systemName});
  return {...job,status:"claimed",node_id:node.id,printer_id:target.id,printer_system_name:target.systemName,claim_token:claim,claim_expires_at:expires,document_url:undefined};
}

export async function nodeJobDocument(db:any,bucket:any,node:any,jobId:string,claimToken:string){
  if(!claimToken)throw new AppError(401,"CLAIM_REQUIRED","Missing Printerly job claim");
  const row=await db.prepare(`SELECT d.object_key objectKey,d.original_name originalName,d.mime_type mimeType,d.size_bytes sizeBytes,d.checksum_sha256 checksum
    FROM prn_jobs j JOIN prn_documents d ON d.id=j.document_id AND d.organization_id=j.organization_id
    WHERE j.id=? AND j.organization_id=? AND j.node_id=? AND j.claim_token=? AND j.status IN ('claimed','downloading','spooling','printing')`)
    .bind(jobId,node.organization_id,node.id,claimToken).first<any>();
  if(!row)throw new AppError(409,"CLAIM_INVALID","Job claim is no longer valid for this document");
  const object=await bucket.get(row.objectKey);
  if(!object)throw new AppError(404,"PRINT_DOCUMENT_MISSING","The print document is missing from object storage");
  return {...row,object};
}

export async function nodeJobStatus(db:any,node:any,jobId:string,data:any){
  const requested=String(data.status||""),allowed=new Set(["downloading","spooling","printing","completed","failed"]);
  if(!allowed.has(requested))throw new AppError(422,"VALIDATION_ERROR","Invalid node job status");
  const claimToken=String(data.claimToken||"");
  const job=await db.prepare("SELECT status,claim_token claimToken FROM prn_jobs WHERE id=? AND organization_id=? AND node_id=?").bind(jobId,node.organization_id,node.id).first<any>();
  if(!job||job.claimToken!==claimToken)throw new AppError(409,"CLAIM_INVALID","Job claim is no longer valid");
  if(job.status===requested)return {id:jobId,status:requested,duplicate:true};

  const transitions:Record<string,Set<string>>={
    claimed:new Set(["downloading","failed"]),
    downloading:new Set(["spooling","failed"]),
    spooling:new Set(["printing","failed"]),
    printing:new Set(["completed","failed"])
  };
  if(!transitions[job.status]?.has(requested))throw new AppError(409,"INVALID_JOB_TRANSITION",`Cannot move a Printerly job from ${job.status} to ${requested}`);

  const t=now(),completed=requested==="completed"?t:null,lease=["downloading","spooling","printing"].includes(requested)?new Date(Date.now()+15*60*1000).toISOString():null;
  const r=await db.prepare("UPDATE prn_jobs SET status=?,error_message=?,completed_at=COALESCE(?,completed_at),claim_expires_at=COALESCE(?,claim_expires_at),updated_at=? WHERE id=? AND organization_id=? AND node_id=? AND claim_token=? AND status=?")
    .bind(requested,String(data.errorMessage||"").slice(0,1000),completed,lease,t,jobId,node.organization_id,node.id,claimToken,job.status).run();
  if(!r.meta?.changes)throw new AppError(409,"CLAIM_INVALID","Job changed while this node was reporting status");
  await addEvent(db,jobId,node.organization_id,requested,node.id,{cupsJobId:data.cupsJobId||null,errorMessage:data.errorMessage||null});
  return {id:jobId,status:requested};
}

async function addEvent(db:any,jobId:string,organizationId:string,event:string,actorId:string,details:any){
  await db.prepare("INSERT INTO prn_job_events(id,organization_id,job_id,event_type,actor_id,details_json,created_at) VALUES(?,?,?,?,?,?,?)")
    .bind(makeId("prnev"),organizationId,jobId,event,actorId||null,JSON.stringify(details||{}),now()).run();
}
