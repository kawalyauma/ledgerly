// @ts-nocheck
import { AppError } from "../../../src/lib/errors";

const makeId=(p:string)=>`${p}_${crypto.randomUUID().replaceAll("-","")}`;
const now=()=>new Date().toISOString();
const DEFAULTS={enabled:1,staged_hours:24,completed_print_days:7,failed_print_days:7,secure_print_minutes:10,scan_inbox_days:30,scan_routed_days:7};
const terminalPrint=new Set(["completed","failed","cancelled"]);
const routedScan=new Set(["student","staff","module"]);
const ageMs=(at:any)=>Math.max(0,Date.now()-new Date(String(at||0)).getTime());
const due=(age:number,amount:number,unit:number)=>age>=Math.max(0,amount)*unit;
const bytes=(v:any)=>Math.max(0,Number(v)||0);

async function log(db:any,org:string,eventType:string,entityType:string|null,entityId:string|null,objectKey:string|null,actorId:string|null,details:any={}){
  await db.prepare("INSERT INTO prn_retention_events(id,organization_id,event_type,entity_type,entity_id,object_key,actor_id,details_json) VALUES(?,?,?,?,?,?,?,?)")
    .bind(makeId("prnret"),org,eventType,entityType,entityId,objectKey,actorId,JSON.stringify(details||{})).run();
}
export async function getPolicy(db:any,organizationId:string){
  const row=await db.prepare("SELECT * FROM prn_retention_policies WHERE organization_id=?").bind(organizationId).first<any>();
  return {...DEFAULTS,...(row||{}),organization_id:organizationId};
}
const bounded=(v:any,min:number,max:number,fallback:number)=>Math.min(max,Math.max(min,Number.isFinite(Number(v))?Math.round(Number(v)):fallback));
export async function updatePolicy(db:any,organizationId:string,userId:string,data:any){
  const current=await getPolicy(db,organizationId),p={
    enabled:data.enabled===false||data.enabled===0?0:1,
    staged_hours:bounded(data.stagedHours,1,720,current.staged_hours),
    completed_print_days:bounded(data.completedPrintDays,0,3650,current.completed_print_days),
    failed_print_days:bounded(data.failedPrintDays,0,3650,current.failed_print_days),
    secure_print_minutes:bounded(data.securePrintMinutes,0,10080,current.secure_print_minutes),
    scan_inbox_days:bounded(data.scanInboxDays,0,3650,current.scan_inbox_days),
    scan_routed_days:bounded(data.scanRoutedDays,0,3650,current.scan_routed_days),
  };
  await db.prepare(`INSERT INTO prn_retention_policies(organization_id,enabled,staged_hours,completed_print_days,failed_print_days,secure_print_minutes,scan_inbox_days,scan_routed_days,updated_by)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(organization_id) DO UPDATE SET enabled=excluded.enabled,staged_hours=excluded.staged_hours,completed_print_days=excluded.completed_print_days,failed_print_days=excluded.failed_print_days,secure_print_minutes=excluded.secure_print_minutes,scan_inbox_days=excluded.scan_inbox_days,scan_routed_days=excluded.scan_routed_days,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`)
    .bind(organizationId,p.enabled,p.staged_hours,p.completed_print_days,p.failed_print_days,p.secure_print_minutes,p.scan_inbox_days,p.scan_routed_days,userId).run();
  await log(db,organizationId,"policy_updated",null,null,null,userId,p);return getPolicy(db,organizationId);
}

async function entityExists(db:any,org:string,type:string,id:string){
  const table:any={print_job:"prn_jobs",scan_job:"prn_scan_jobs",print_document:"prn_documents",scan_document:"prn_scan_documents"}[type];
  if(!table)return false;return Boolean(await db.prepare(`SELECT 1 FROM ${table} WHERE id=? AND organization_id=?`).bind(id,org).first());
}
export async function createHold(db:any,organizationId:string,userId:string,data:any){
  const type=String(data.entityType||""),id=String(data.entityId||"").trim(),reason=String(data.reason||"").trim().slice(0,500);
  if(!new Set(["print_job","scan_job","print_document","scan_document"]).has(type)||!id)throw new AppError(422,"VALIDATION_ERROR","Choose a valid Printerly record to hold");
  if(reason.length<3)throw new AppError(422,"HOLD_REASON_REQUIRED","Explain why this document must be retained");
  if(!await entityExists(db,organizationId,type,id))throw new AppError(404,"NOT_FOUND","Printerly record not found");
  const existing=await db.prepare("SELECT id FROM prn_retention_holds WHERE organization_id=? AND entity_type=? AND entity_id=? AND released_at IS NULL").bind(organizationId,type,id).first<any>();
  if(existing)return {id:existing.id,duplicate:true};
  const holdId=makeId("prnhold");await db.prepare("INSERT INTO prn_retention_holds(id,organization_id,entity_type,entity_id,reason,held_by) VALUES(?,?,?,?,?,?)").bind(holdId,organizationId,type,id,reason,userId).run();
  await log(db,organizationId,"legal_hold_created",type,id,null,userId,{reason});return {id:holdId,entityType:type,entityId:id,reason};
}
export async function releaseHold(db:any,organizationId:string,userId:string,id:string){
  const hold=await db.prepare("SELECT * FROM prn_retention_holds WHERE id=? AND organization_id=? AND released_at IS NULL").bind(id,organizationId).first<any>();
  if(!hold)throw new AppError(404,"ACTIVE_HOLD_NOT_FOUND","Active legal hold not found");
  await db.prepare("UPDATE prn_retention_holds SET released_by=?,released_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND released_at IS NULL").bind(userId,id,organizationId).run();
  await log(db,organizationId,"legal_hold_released",hold.entity_type,hold.entity_id,null,userId,{reason:hold.reason});return {id,released:true};
}
export async function listHolds(db:any,organizationId:string,activeOnly=true){
  const r=await db.prepare(`SELECT h.*,u.display_name held_by_name,ru.display_name released_by_name FROM prn_retention_holds h LEFT JOIN users u ON u.id=h.held_by LEFT JOIN users ru ON ru.id=h.released_by
    WHERE h.organization_id=? ${activeOnly?"AND h.released_at IS NULL":""} ORDER BY h.held_at DESC LIMIT 300`).bind(organizationId).all<any>();return r.results||[];
}
async function holdSet(db:any,organizationId:string){
  const r=await db.prepare("SELECT entity_type,entity_id FROM prn_retention_holds WHERE organization_id=? AND released_at IS NULL").bind(organizationId).all<any>();
  return new Set((r.results||[]).map((x:any)=>`${x.entity_type}:${x.entity_id}`));
}
const isHeld=(h:Set<string>,docType:string,docId:string,jobType:string,jobId:any)=>h.has(`${docType}:${docId}`)||(jobId&&h.has(`${jobType}:${jobId}`));

async function printRows(db:any,org:string,limit=500){
  const r=await db.prepare(`SELECT d.id documentId,d.object_key objectKey,d.original_name originalName,d.size_bytes sizeBytes,d.status documentStatus,d.created_at documentCreatedAt,d.attached_at attachedAt,d.retention_purged_at purgedAt,
    j.id jobId,j.job_number jobNumber,j.title,j.status jobStatus,j.secure_release secureRelease,j.completed_at completedAt,j.updated_at jobUpdatedAt
    FROM prn_documents d LEFT JOIN prn_jobs j ON j.document_id=d.id AND j.organization_id=d.organization_id
    WHERE d.organization_id=? AND d.retention_purged_at IS NULL AND d.status<>'deleted' ORDER BY d.created_at ASC LIMIT ?`).bind(org,limit).all<any>();return r.results||[];
}
async function scanRows(db:any,org:string,limit=500){
  const r=await db.prepare(`SELECT d.id documentId,d.object_key objectKey,d.original_name originalName,d.size_bytes sizeBytes,d.created_at documentCreatedAt,d.retention_purged_at purgedAt,d.school_file_id schoolFileId,
    j.id jobId,j.scan_number scanNumber,j.title,j.status jobStatus,j.target_type targetType,j.target_module targetModule,j.completed_at completedAt,j.updated_at jobUpdatedAt
    FROM prn_scan_documents d JOIN prn_scan_jobs j ON j.id=d.scan_job_id AND j.organization_id=d.organization_id
    WHERE d.organization_id=? AND d.retention_purged_at IS NULL ORDER BY d.created_at ASC LIMIT ?`).bind(org,limit).all<any>();return r.results||[];
}
function printDecision(row:any,p:any){
  if(row.documentStatus==="staged")return {eligible:true,due:due(ageMs(row.documentCreatedAt),p.staged_hours,3600000),reason:"staged-expired",threshold:`${p.staged_hours}h`};
  if(!row.jobId||!terminalPrint.has(row.jobStatus))return {eligible:false,due:false,reason:"active-job",threshold:null};
  const at=row.completedAt||row.jobUpdatedAt||row.attachedAt||row.documentCreatedAt;
  if(Number(row.secureRelease))return {eligible:true,due:due(ageMs(at),p.secure_print_minutes,60000),reason:"secure-print-retention",threshold:`${p.secure_print_minutes}m`};
  const days=row.jobStatus==="completed"?p.completed_print_days:p.failed_print_days;
  return {eligible:true,due:due(ageMs(at),days,86400000),reason:row.jobStatus==="completed"?"completed-print-retention":"failed-print-retention",threshold:`${days}d`};
}
function scanDecision(row:any,p:any){
  if(row.jobStatus!=="completed")return {eligible:false,due:false,reason:"active-scan",threshold:null};
  const days=routedScan.has(row.targetType)?p.scan_routed_days:p.scan_inbox_days;
  return {eligible:true,due:due(ageMs(row.completedAt||row.jobUpdatedAt||row.documentCreatedAt),days,86400000),reason:routedScan.has(row.targetType)?"routed-scan-retention":"scan-inbox-retention",threshold:`${days}d`};
}
async function purgePrint(db:any,bucket:any,org:string,row:any,actorId:string|null,reason:string){
  await bucket.delete(row.objectKey);
  const t=now();await db.batch([
    db.prepare("UPDATE prn_documents SET status='deleted',deleted_at=COALESCE(deleted_at,?),retention_purged_at=?,retention_purge_reason=? WHERE id=? AND organization_id=? AND retention_purged_at IS NULL").bind(t,t,reason,row.documentId,org),
    db.prepare("INSERT INTO prn_retention_events(id,organization_id,event_type,entity_type,entity_id,object_key,actor_id,details_json) VALUES(?,?,?,?,?,?,?,?)").bind(makeId("prnret"),org,"object_purged","print_document",row.documentId,row.objectKey,actorId,JSON.stringify({reason,jobId:row.jobId||null,sizeBytes:bytes(row.sizeBytes)}))
  ]);return bytes(row.sizeBytes);
}
async function purgeScan(db:any,bucket:any,org:string,row:any,actorId:string|null,reason:string){
  await bucket.delete(row.objectKey);const t=now();await db.batch([
    db.prepare("UPDATE prn_scan_documents SET retention_purged_at=?,retention_purge_reason=? WHERE id=? AND organization_id=? AND retention_purged_at IS NULL").bind(t,reason,row.documentId,org),
    db.prepare("INSERT INTO prn_retention_events(id,organization_id,event_type,entity_type,entity_id,object_key,actor_id,details_json) VALUES(?,?,?,?,?,?,?,?)").bind(makeId("prnret"),org,"object_purged","scan_document",row.documentId,row.objectKey,actorId,JSON.stringify({reason,jobId:row.jobId,schoolFilePreserved:Boolean(row.schoolFileId),sizeBytes:bytes(row.sizeBytes)}))
  ]);return bytes(row.sizeBytes);
}

export async function inventory(db:any,organizationId:string){
  const[p,prints,scans,holds,ps,ss]=await Promise.all([getPolicy(db,organizationId),printRows(db,organizationId,5000),scanRows(db,organizationId,5000),holdSet(db,organizationId),
    db.prepare("SELECT COUNT(*) objects,COALESCE(SUM(size_bytes),0) bytes FROM prn_documents WHERE organization_id=? AND retention_purged_at IS NULL AND status<>'deleted'").bind(organizationId).first<any>(),
    db.prepare("SELECT COUNT(*) objects,COALESCE(SUM(size_bytes),0) bytes FROM prn_scan_documents WHERE organization_id=? AND retention_purged_at IS NULL").bind(organizationId).first<any>()]);
  const printDocuments=prints.map((r:any)=>{const d=printDecision(r,p);return {...r,...d,held:isHeld(holds,"print_document",r.documentId,"print_job",r.jobId)}});
  const scanDocuments=scans.map((r:any)=>{const d=scanDecision(r,p);return {...r,...d,held:isHeld(holds,"scan_document",r.documentId,"scan_job",r.jobId)}});
  const all=[...printDocuments,...scanDocuments],dueNow=all.filter((x:any)=>x.due&&!x.held),held=all.filter((x:any)=>x.held),objects=Number(ps?.objects||0)+Number(ss?.objects||0);
  return {policy:p,summary:{objects,bytes:Number(ps?.bytes||0)+Number(ss?.bytes||0),dueNow:dueNow.length,dueBytes:dueNow.reduce((s:number,x:any)=>s+bytes(x.sizeBytes),0),held:held.length,heldBytes:held.reduce((s:number,x:any)=>s+bytes(x.sizeBytes),0),truncated:objects>all.length},printDocuments,scanDocuments};
}
async function printRowById(db:any,org:string,id:string){return db.prepare(`SELECT d.id documentId,d.object_key objectKey,d.original_name originalName,d.size_bytes sizeBytes,d.status documentStatus,d.created_at documentCreatedAt,d.attached_at attachedAt,d.retention_purged_at purgedAt,j.id jobId,j.job_number jobNumber,j.title,j.status jobStatus,j.secure_release secureRelease,j.completed_at completedAt,j.updated_at jobUpdatedAt FROM prn_documents d LEFT JOIN prn_jobs j ON j.document_id=d.id AND j.organization_id=d.organization_id WHERE d.organization_id=? AND d.id=? AND d.retention_purged_at IS NULL AND d.status<>'deleted'`).bind(org,id).first<any>()}
async function scanRowById(db:any,org:string,id:string){return db.prepare(`SELECT d.id documentId,d.object_key objectKey,d.original_name originalName,d.size_bytes sizeBytes,d.created_at documentCreatedAt,d.retention_purged_at purgedAt,d.school_file_id schoolFileId,j.id jobId,j.scan_number scanNumber,j.title,j.status jobStatus,j.target_type targetType,j.target_module targetModule,j.completed_at completedAt,j.updated_at jobUpdatedAt FROM prn_scan_documents d JOIN prn_scan_jobs j ON j.id=d.scan_job_id AND j.organization_id=d.organization_id WHERE d.organization_id=? AND d.id=? AND d.retention_purged_at IS NULL`).bind(org,id).first<any>()}
export async function manualPurge(db:any,bucket:any,organizationId:string,userId:string,data:any){
  const type=String(data.entityType||""),id=String(data.entityId||"").trim();if(!new Set(["print_document","scan_document"]).has(type)||!id)throw new AppError(422,"VALIDATION_ERROR","Choose a Printerly document to purge");
  const holds=await holdSet(db,organizationId);
  if(type==="print_document"){
    const row=await printRowById(db,organizationId,id);if(!row)throw new AppError(404,"DOCUMENT_NOT_FOUND","Printerly document not found or already purged");
    if(isHeld(holds,"print_document",id,"print_job",row.jobId))throw new AppError(409,"LEGAL_HOLD","Release the legal hold before purging this document");
    const decision=printDecision(row,await getPolicy(db,organizationId));if(!decision.eligible)throw new AppError(409,"DOCUMENT_ACTIVE","Active print-job documents cannot be purged");
    const n=await purgePrint(db,bucket,organizationId,row,userId,"manual-purge");return {entityType:type,entityId:id,purged:true,bytes:n};
  }
  const row=await scanRowById(db,organizationId,id);if(!row)throw new AppError(404,"DOCUMENT_NOT_FOUND","Scannerly document not found or already purged");
  if(isHeld(holds,"scan_document",id,"scan_job",row.jobId))throw new AppError(409,"LEGAL_HOLD","Release the legal hold before purging this document");
  if(row.jobStatus!=="completed")throw new AppError(409,"DOCUMENT_ACTIVE","Only completed Scannerly documents can be purged");
  const n=await purgeScan(db,bucket,organizationId,row,userId,"manual-purge");return {entityType:type,entityId:id,purged:true,bytes:n,schoolFilePreserved:Boolean(row.schoolFileId)};
}
export async function sweepOrganization(db:any,bucket:any,organizationId:string){
  const policy=await getPolicy(db,organizationId);if(!Number(policy.enabled))return {organizationId,disabled:true,purged:0,bytes:0,held:0,failed:0};
  const holds=await holdSet(db,organizationId),[prints,scans]=await Promise.all([printRows(db,organizationId,500),scanRows(db,organizationId,500)]);let purged=0,totalBytes=0,held=0,failed=0;
  for(const row of prints){const d=printDecision(row,policy);if(!d.due)continue;if(isHeld(holds,"print_document",row.documentId,"print_job",row.jobId)){held++;continue}try{totalBytes+=await purgePrint(db,bucket,organizationId,row,null,d.reason);purged++}catch(error){failed++;await log(db,organizationId,"purge_failed","print_document",row.documentId,row.objectKey,null,{message:String(error?.message||error)})}}
  for(const row of scans){const d=scanDecision(row,policy);if(!d.due)continue;if(isHeld(holds,"scan_document",row.documentId,"scan_job",row.jobId)){held++;continue}try{totalBytes+=await purgeScan(db,bucket,organizationId,row,null,d.reason);purged++}catch(error){failed++;await log(db,organizationId,"purge_failed","scan_document",row.documentId,row.objectKey,null,{message:String(error?.message||error)})}}
  return {organizationId,purged,bytes:totalBytes,held,failed};
}
export async function runRetentionSweep(env:any){
  const orgs=await env.FINANCE_DB.prepare(`SELECT DISTINCT organization_id FROM organization_modules WHERE module_key='printerly' AND enabled=1`).all<any>();const out=[];
  for(const r of orgs.results||[])out.push(await sweepOrganization(env.FINANCE_DB,env.WORK_FILES_BUCKET,r.organization_id));return out;
}
export async function listEvents(db:any,organizationId:string,limit=150){
  const r=await db.prepare(`SELECT e.*,u.display_name actor_name FROM prn_retention_events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.organization_id=? ORDER BY e.created_at DESC LIMIT ?`).bind(organizationId,Math.min(500,Math.max(1,limit))).all<any>();return (r.results||[]).map((x:any)=>({...x,details:safeJson(x.details_json,{})}));
}
function safeJson(v:any,f:any){try{return v?JSON.parse(String(v)):f}catch{return f}}
