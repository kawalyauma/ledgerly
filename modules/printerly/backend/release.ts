// @ts-nocheck
import { AppError } from "../../../src/lib/errors";

const makeId=(p:string)=>`${p}_${crypto.randomUUID().replaceAll("-","")}`;
const now=()=>new Date().toISOString();
const encoder=new TextEncoder();
async function digest(value:string){const bytes=await crypto.subtle.digest("SHA-256",encoder.encode(value));return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,"0")).join("")}
function token(){const bytes=new Uint8Array(24);crypto.getRandomValues(bytes);return btoa(String.fromCharCode(...bytes)).replaceAll("+","-").replaceAll("/","_").replaceAll("=","")}
function pin(){const a=new Uint32Array(1);crypto.getRandomValues(a);return String(a[0]%1_000_000).padStart(6,"0")}
function canManage(principal:any){return principal?.role==="owner"||principal?.role==="admin"||principal?.scopes?.includes?.("admin:write")}
async function event(db:any,org:string,jobId:string,type:string,actor:string|null,details:any){await db.prepare("INSERT INTO prn_job_events(id,organization_id,job_id,event_type,actor_id,details_json,created_at) VALUES(?,?,?,?,?,?,?)").bind(makeId("prnev"),org,jobId,type,actor,JSON.stringify(details||{}),now()).run()}

export async function issueCredential(db:any,organizationId:string,principal:any,jobId:string,ttlMinutes=15){
  const job=await db.prepare("SELECT id,job_number jobNumber,title,status,secure_release secureRelease,created_by createdBy,printer_id printerId FROM prn_jobs WHERE id=? AND organization_id=?").bind(jobId,organizationId).first<any>();
  if(!job)throw new AppError(404,"PRINT_JOB_NOT_FOUND","Printerly job not found");
  if(job.status!=="held"||!job.secureRelease)throw new AppError(409,"RELEASE_NOT_AVAILABLE","Only secure held jobs can receive a release credential");
  if(!canManage(principal)&&job.createdBy!==principal.userId)throw new AppError(403,"FORBIDDEN","You can issue release credentials only for your own secure jobs");
  const minutes=Math.max(2,Math.min(120,Number(ttlMinutes)||15)),expiresAt=new Date(Date.now()+minutes*60_000).toISOString();
  let clearPin="",pinDigest="";
  for(let i=0;i<20;i++){clearPin=pin();pinDigest=await digest(clearPin);const clash=await db.prepare("SELECT 1 found FROM prn_release_credentials WHERE organization_id=? AND pin_digest=? AND used_at IS NULL AND revoked_at IS NULL AND datetime(expires_at)>CURRENT_TIMESTAMP LIMIT 1").bind(organizationId,pinDigest).first();if(!clash)break;if(i===19)throw new AppError(503,"PIN_SPACE_BUSY","Could not allocate a secure release PIN. Try again.")}
  const clearToken=token(),tokenDigest=await digest(clearToken),id=makeId("prnrel");
  await db.batch([
    db.prepare("UPDATE prn_release_credentials SET revoked_at=CURRENT_TIMESTAMP WHERE organization_id=? AND job_id=? AND used_at IS NULL AND revoked_at IS NULL").bind(organizationId,jobId),
    db.prepare("INSERT INTO prn_release_credentials(id,organization_id,job_id,issued_by,pin_digest,token_digest,expires_at) VALUES(?,?,?,?,?,?,?)").bind(id,organizationId,jobId,principal.userId,pinDigest,tokenDigest,expiresAt),
  ]);
  await event(db,organizationId,jobId,"release_credential_issued",principal.userId,{credentialId:id,expiresAt});
  return {id,jobId,jobNumber:job.jobNumber,title:job.title,pin:clearPin,token:clearToken,qrValue:`printerly-release:${clearToken}`,expiresAt};
}

export async function listSecureJobs(db:any,organizationId:string,principal:any){
  const all=canManage(principal),where=all?"j.organization_id=?":"j.organization_id=? AND j.created_by=?",args=all?[organizationId]:[organizationId,principal.userId];
  const rows=await db.prepare(`SELECT j.id,j.job_number jobNumber,j.title,j.status,j.printer_id printerId,j.route_pool_id routePoolId,j.created_at createdAt,u.display_name requesterName,
    p.name printerName,p.location printerLocation,r.id credentialId,r.expires_at credentialExpiresAt,r.attempts credentialAttempts,r.max_attempts credentialMaxAttempts,r.locked_at credentialLockedAt
    FROM prn_jobs j LEFT JOIN users u ON u.id=j.created_by LEFT JOIN prn_printers p ON p.id=j.printer_id AND p.organization_id=j.organization_id
    LEFT JOIN prn_release_credentials r ON r.id=(SELECT r2.id FROM prn_release_credentials r2 WHERE r2.organization_id=j.organization_id AND r2.job_id=j.id AND r2.used_at IS NULL AND r2.revoked_at IS NULL ORDER BY r2.created_at DESC LIMIT 1)
    WHERE ${where} AND j.secure_release=1 AND j.status IN ('held','approval_pending') ORDER BY j.created_at DESC LIMIT 250`).bind(...args).all<any>();
  return (rows.results||[]).map((r:any)=>({...r,credentialActive:Boolean(r.credentialId&&r.credentialExpiresAt&&Date.parse(r.credentialExpiresAt)>Date.now()&&!r.credentialLockedAt)}));
}

export async function revokeCredential(db:any,organizationId:string,principal:any,jobId:string){
  const job=await db.prepare("SELECT created_by createdBy FROM prn_jobs WHERE id=? AND organization_id=?").bind(jobId,organizationId).first<any>();
  if(!job)throw new AppError(404,"PRINT_JOB_NOT_FOUND","Printerly job not found");if(!canManage(principal)&&job.createdBy!==principal.userId)throw new AppError(403,"FORBIDDEN","You can revoke release credentials only for your own jobs");
  await db.prepare("UPDATE prn_release_credentials SET revoked_at=CURRENT_TIMESTAMP WHERE organization_id=? AND job_id=? AND used_at IS NULL AND revoked_at IS NULL").bind(organizationId,jobId).run();
  await event(db,organizationId,jobId,"release_credential_revoked",principal.userId,{});return {jobId,revoked:true};
}

async function logAttempt(db:any,org:string,nodeId:string,credentialId:string|null,success:boolean,code:string|null){await db.prepare("INSERT INTO prn_release_attempt_log(id,organization_id,node_id,credential_id,success,failure_code) VALUES(?,?,?,?,?,?)").bind(makeId("prnra"),org,nodeId,credentialId,success?1:0,code).run()}
async function reject(db:any,node:any,credential:any,code:string,message:string){if(credential){const attempts=Number(credential.attempts||0)+1,max=Number(credential.maxAttempts||5);await db.prepare("UPDATE prn_release_credentials SET attempts=?,locked_at=CASE WHEN ?>=? THEN CURRENT_TIMESTAMP ELSE locked_at END WHERE id=? AND organization_id=? AND used_at IS NULL").bind(attempts,attempts,max,credential.id,node.organization_id).run()}await logAttempt(db,node.organization_id,node.id,credential?.id||null,false,code);throw new AppError(code==="RELEASE_THROTTLED"?429:409,code,message)}

export async function redeemCredential(db:any,node:any,data:any){
  const recent=await db.prepare("SELECT COUNT(*) count FROM prn_release_attempt_log WHERE organization_id=? AND node_id=? AND success=0 AND created_at>datetime('now','-10 minutes')").bind(node.organization_id,node.id).first<any>();
  if(Number(recent?.count||0)>=20)throw new AppError(429,"RELEASE_THROTTLED","Too many failed release attempts. Wait before trying again.");
  let value=String(data.credential||data.pin||data.token||"").trim();if(value.startsWith("printerly-release:"))value=value.slice("printerly-release:".length);if(!value)await reject(db,node,null,"INVALID_RELEASE_CREDENTIAL","Enter a valid release PIN or scan the job QR code");
  const isPin=/^\d{6}$/.test(value),hash=await digest(value);
  const credential=await db.prepare(`SELECT r.id,r.job_id jobId,r.attempts,r.max_attempts maxAttempts,r.locked_at lockedAt,r.expires_at expiresAt,r.used_at usedAt,r.revoked_at revokedAt,
      j.job_number jobNumber,j.title,j.status,j.secure_release secureRelease,j.printer_id printerId,j.route_pool_id routePoolId,j.page_size pageSize,j.color_mode colorMode,j.duplex
    FROM prn_release_credentials r JOIN prn_jobs j ON j.id=r.job_id AND j.organization_id=r.organization_id
    WHERE r.organization_id=? AND ${isPin?"r.pin_digest":"r.token_digest"}=? ORDER BY r.created_at DESC LIMIT 1`).bind(node.organization_id,hash).first<any>();
  if(!credential)await reject(db,node,null,"INVALID_RELEASE_CREDENTIAL","Release credential is invalid or no longer available");
  if(credential.usedAt||credential.revokedAt||credential.lockedAt||Date.parse(credential.expiresAt)<=Date.now()||credential.status!=="held"||!credential.secureRelease)await reject(db,node,credential,"INVALID_RELEASE_CREDENTIAL","Release credential is invalid or no longer available");
  const names=(Array.isArray(data.printerSystemNames)?data.printerSystemNames:[]).map(String).filter(Boolean);if(!names.length)await reject(db,node,credential,"NO_LOCAL_PRINTER","This release station has no ready printers");const marks=names.map(()=>"?").join(",");
  let printer:any=null;
  if(credential.printerId)printer=await db.prepare(`SELECT id,name,system_name systemName FROM prn_printers WHERE id=? AND organization_id=? AND node_id=? AND status='ready' AND system_name IN (${marks})`).bind(credential.printerId,node.organization_id,node.id,...names).first<any>();
  else if(credential.routePoolId)printer=await db.prepare(`SELECT p.id,p.name,p.system_name systemName FROM prn_printer_pool_members m JOIN prn_printers p ON p.id=m.printer_id AND p.organization_id=m.organization_id WHERE m.organization_id=? AND m.pool_id=? AND m.enabled=1 AND p.node_id=? AND p.status='ready' AND p.system_name IN (${marks}) ORDER BY m.priority,p.name LIMIT 1`).bind(node.organization_id,credential.routePoolId,node.id,...names).first<any>();
  else printer=await db.prepare(`SELECT id,name,system_name systemName FROM prn_printers WHERE organization_id=? AND node_id=? AND status='ready' AND system_name IN (${marks}) ORDER BY name LIMIT 1`).bind(node.organization_id,node.id,...names).first<any>();
  if(!printer)await reject(db,node,credential,"RELEASE_WRONG_STATION","This job cannot be released at this Printerly station");
  const t=now(),moved=await db.prepare("UPDATE prn_jobs SET status='queued',printer_id=?,route_reason='Secure release station',routed_at=?,released_at=?,updated_at=? WHERE id=? AND organization_id=? AND status='held' AND secure_release=1").bind(printer.id,t,t,t,credential.jobId,node.organization_id).run();
  if(!moved.meta?.changes)await reject(db,node,credential,"RELEASE_ALREADY_USED","This job is no longer waiting for secure release");
  await db.batch([
    db.prepare("UPDATE prn_release_credentials SET used_at=?,used_node_id=?,used_printer_id=? WHERE id=? AND organization_id=? AND used_at IS NULL").bind(t,node.id,printer.id,credential.id,node.organization_id),
    db.prepare("UPDATE prn_release_credentials SET revoked_at=COALESCE(revoked_at,?) WHERE organization_id=? AND job_id=? AND id<>? AND used_at IS NULL").bind(t,node.organization_id,credential.jobId,credential.id),
  ]);
  await logAttempt(db,node.organization_id,node.id,credential.id,true,null);await event(db,node.organization_id,credential.jobId,"secure_release_station",node.id,{credentialId:credential.id,printerId:printer.id,printerName:printer.name,systemName:printer.systemName});
  return {released:true,jobId:credential.jobId,jobNumber:credential.jobNumber,title:credential.title,printerId:printer.id,printerName:printer.name};
}

export async function cleanupReleaseCredentials(db:any){await db.prepare("DELETE FROM prn_release_attempt_log WHERE created_at<datetime('now','-30 days')").run();await db.prepare("DELETE FROM prn_release_credentials WHERE (used_at IS NOT NULL OR revoked_at IS NOT NULL OR expires_at<CURRENT_TIMESTAMP) AND created_at<datetime('now','-90 days')").run()}
