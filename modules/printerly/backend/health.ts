// @ts-nocheck
import type { Env } from "../../../src/types";
import { AppError } from "../../../src/lib/errors";
import { notifyWork } from "../../tasks-work/backend/notifications";

const makeId=(prefix:string)=>`${prefix}_${crypto.randomUUID().replaceAll("-","")}`;
const EVENT_TYPES=["printerly.printer_fault","printerly.node_offline","printerly.job_failed","printerly.scan_failed"] as const;

function list(value:any):string[]{if(Array.isArray(value))return value.map(String).filter(Boolean);if(typeof value==="string"){try{const parsed=JSON.parse(value);if(Array.isArray(parsed))return parsed.map(String).filter(Boolean)}catch{}return value.split(/[;,]/).map(x=>x.trim()).filter(Boolean)}return []}
function markerList(value:any){if(Array.isArray(value))return value;return []}
function classify(status:string,reasons:string[]){
  const text=[status,...reasons].join(" ").toLowerCase();
  const critical=["media-empty","toner-empty","marker-supply-empty","door-open","cover-open","offline","stopped","shutdown","paused","unplugged","printer-error","jam"];
  const warning=["media-low","toner-low","marker-supply-low","marker-waste-almost-full","connecting-to-device","warming-up"];
  if(status==="offline"||critical.some(x=>text.includes(x)))return "critical";
  if(warning.some(x=>text.includes(x)))return "warning";
  return status==="ready"?"healthy":"unknown";
}
function humanReason(reason:string){return reason.replaceAll("-"," ").replace(/\b\w/g,x=>x.toUpperCase())}

async function ensureDefaultSubscriptions(db:any,organizationId:string){
  const count=await db.prepare("SELECT COUNT(*) count FROM prn_alert_subscriptions WHERE organization_id=?").bind(organizationId).first<any>();
  if(Number(count?.count||0)>0)return;
  const admins=(await db.prepare("SELECT user_id userId FROM memberships WHERE organization_id=? AND role IN ('owner','admin') ORDER BY created_at").bind(organizationId).all<any>()).results||[];
  const statements=[];
  for(const member of admins)for(const eventType of EVENT_TYPES)statements.push(db.prepare(`INSERT OR IGNORE INTO prn_alert_subscriptions(organization_id,user_id,event_type,enabled,email,sms,whatsapp) VALUES(?,?,?,1,1,0,0)`).bind(organizationId,member.userId,eventType));
  if(statements.length)await db.batch(statements);
}

async function notifySubscribers(env:Env,organizationId:string,eventType:string,title:string,body:string,entityType?:string,entityId?:string,data:any={}){
  await ensureDefaultSubscriptions(env.FINANCE_DB,organizationId);
  const subs=(await env.FINANCE_DB.prepare(`SELECT user_id userId,email,sms,whatsapp FROM prn_alert_subscriptions WHERE organization_id=? AND event_type=? AND enabled=1`).bind(organizationId,eventType).all<any>()).results||[];
  for(const sub of subs){
    await env.FINANCE_DB.prepare(`INSERT INTO work_notification_preferences(organization_id,user_id,event_type,in_app,email,sms,whatsapp)
      VALUES(?,?,?,1,?,?,?) ON CONFLICT(organization_id,user_id,event_type) DO UPDATE SET in_app=1,email=excluded.email,sms=excluded.sms,whatsapp=excluded.whatsapp`)
      .bind(organizationId,sub.userId,eventType,sub.email?1:0,sub.sms?1:0,sub.whatsapp?1:0).run();
    try{await notifyWork(env,{organizationId,userId:sub.userId,eventType,title,body,entityType,entityId,data})}catch(error){console.error(JSON.stringify({level:"error",component:"printerly-alert",eventType,userId:sub.userId,message:error instanceof Error?error.message:String(error)}))}
  }
}

export async function raiseAlert(env:Env,input:{organizationId:string;fingerprint:string;eventType:string;severity:"info"|"warning"|"critical";title:string;body:string;entityType?:string;entityId?:string;details?:any}){
  const prior=await env.FINANCE_DB.prepare("SELECT id FROM prn_alerts WHERE organization_id=? AND fingerprint=? AND resolved_at IS NULL").bind(input.organizationId,input.fingerprint).first<any>();
  if(prior){
    await env.FINANCE_DB.prepare("UPDATE prn_alerts SET severity=?,title=?,body=?,details_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?")
      .bind(input.severity,input.title,input.body,JSON.stringify(input.details||{}),prior.id,input.organizationId).run();
    return {id:prior.id,duplicate:true};
  }
  const id=makeId("prnalert");
  const inserted=await env.FINANCE_DB.prepare(`INSERT OR IGNORE INTO prn_alerts(id,organization_id,fingerprint,event_type,severity,title,body,entity_type,entity_id,details_json)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(id,input.organizationId,input.fingerprint,input.eventType,input.severity,input.title,input.body,input.entityType||null,input.entityId||null,JSON.stringify(input.details||{})).run();
  if(!inserted.meta?.changes){const race=await env.FINANCE_DB.prepare("SELECT id FROM prn_alerts WHERE organization_id=? AND fingerprint=? AND resolved_at IS NULL").bind(input.organizationId,input.fingerprint).first<any>();return {id:race?.id,duplicate:true}}
  await notifySubscribers(env,input.organizationId,input.eventType,input.title,input.body,input.entityType,input.entityId,{alertId:id,severity:input.severity,...(input.details||{})});
  return {id,duplicate:false};
}

async function resolveFaults(db:any,organizationId:string,entityType:string,entityId:string,exceptFingerprint?:string){
  const sql=exceptFingerprint?"UPDATE prn_alerts SET resolved_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND entity_type=? AND entity_id=? AND event_type='printerly.printer_fault' AND resolved_at IS NULL AND fingerprint<>?":"UPDATE prn_alerts SET resolved_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND entity_type=? AND entity_id=? AND event_type='printerly.printer_fault' AND resolved_at IS NULL";
  return exceptFingerprint?db.prepare(sql).bind(organizationId,entityType,entityId,exceptFingerprint).run():db.prepare(sql).bind(organizationId,entityType,entityId).run();
}

export async function processHeartbeat(env:Env,node:any,data:any){
  const db=env.FINANCE_DB,t=new Date().toISOString();
  // Any heartbeat proves a prior node-offline condition has recovered.
  await db.prepare("UPDATE prn_alerts SET resolved_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND entity_type='node' AND entity_id=? AND event_type='printerly.node_offline' AND resolved_at IS NULL").bind(node.organization_id,node.id).run();
  for(const payload of Array.isArray(data.printers)?data.printers:[]){
    const systemName=String(payload.systemName||payload.id||payload.name||"").trim();if(!systemName)continue;
    const printer=await db.prepare("SELECT id,name FROM prn_printers WHERE organization_id=? AND node_id=? AND system_name=?").bind(node.organization_id,node.id,systemName).first<any>();
    if(!printer)continue;
    const reasons=list(payload.health?.reasons||payload.stateReasons||[]),markers=markerList(payload.health?.markers||payload.markerLevels||[]);
    const state=classify(String(payload.status||"unknown"),reasons);
    const message=state==="healthy"?"Ready":reasons.length?reasons.map(humanReason).join(", "):state==="critical"?"Printer requires attention":"Printer status unavailable";
    await db.prepare(`UPDATE prn_printers SET health_status=?,state_reasons_json=?,marker_levels_json=?,health_message=?,last_health_at=?,updated_at=? WHERE id=? AND organization_id=?`)
      .bind(state,JSON.stringify(reasons),JSON.stringify(markers),message,t,t,printer.id,node.organization_id).run();
    if(state==="critical"||state==="warning"){
      const primary=reasons[0]||String(payload.status||state),fingerprint=`printer:${printer.id}:${primary}`;
      await resolveFaults(db,node.organization_id,"printer",printer.id,fingerprint);
      await raiseAlert(env,{organizationId:node.organization_id,fingerprint,eventType:"printerly.printer_fault",severity:state==="critical"?"critical":"warning",title:`Printer ${state}: ${printer.name}`,body:`${printer.name} at ${node.name||node.location||"Printerly Node"}: ${message}.`,entityType:"printer",entityId:printer.id,details:{nodeId:node.id,systemName,reasons,markers}});
    }else if(state==="healthy")await resolveFaults(db,node.organization_id,"printer",printer.id);
  }
}

export async function listPrinters(db:any,organizationId:string){
  const rows=await db.prepare(`SELECT p.id,p.node_id nodeId,p.name,p.system_name systemName,p.location,p.status,p.capabilities_json capabilitiesJson,p.last_seen_at lastSeenAt,
    p.health_status healthStatus,p.state_reasons_json stateReasonsJson,p.marker_levels_json markerLevelsJson,p.health_message healthMessage,p.last_health_at lastHealthAt,n.name nodeName
    FROM prn_printers p LEFT JOIN prn_nodes n ON n.id=p.node_id AND n.organization_id=p.organization_id WHERE p.organization_id=? ORDER BY p.name`).bind(organizationId).all<any>();
  return (rows.results||[]).map((r:any)=>({...r,stateReasons:safeJson(r.stateReasonsJson,[]),markerLevels:safeJson(r.markerLevelsJson,[]),capabilities:safeJson(r.capabilitiesJson,{})}));
}
function safeJson(value:any,fallback:any){try{return value?JSON.parse(String(value)):fallback}catch{return fallback}}

export async function healthSummary(db:any,organizationId:string){
  const printers=await db.prepare(`SELECT COUNT(*) total,SUM(CASE WHEN health_status='healthy' THEN 1 ELSE 0 END) healthy,SUM(CASE WHEN health_status='warning' THEN 1 ELSE 0 END) warning,SUM(CASE WHEN health_status='critical' THEN 1 ELSE 0 END) critical FROM prn_printers WHERE organization_id=?`).bind(organizationId).first<any>();
  const alerts=await db.prepare("SELECT COUNT(*) active,SUM(CASE WHEN severity='critical' THEN 1 ELSE 0 END) critical FROM prn_alerts WHERE organization_id=? AND resolved_at IS NULL").bind(organizationId).first<any>();
  return {printers,alerts};
}

export async function listAlerts(db:any,organizationId:string,limit=100){
  const rows=await db.prepare(`SELECT id,event_type eventType,severity,title,body,entity_type entityType,entity_id entityId,details_json detailsJson,acknowledged_by acknowledgedBy,acknowledged_at acknowledgedAt,resolved_at resolvedAt,created_at createdAt,updated_at updatedAt
    FROM prn_alerts WHERE organization_id=? ORDER BY CASE WHEN resolved_at IS NULL THEN 0 ELSE 1 END,CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,created_at DESC LIMIT ?`).bind(organizationId,Math.min(300,Math.max(1,limit))).all<any>();
  return (rows.results||[]).map((r:any)=>({...r,details:safeJson(r.detailsJson,{})}));
}

export async function acknowledgeAlert(db:any,organizationId:string,userId:string,alertId:string){
  const result=await db.prepare("UPDATE prn_alerts SET acknowledged_by=?,acknowledged_at=COALESCE(acknowledged_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(userId,alertId,organizationId).run();
  if(!result.meta?.changes)throw new AppError(404,"ALERT_NOT_FOUND","Printerly alert not found");
  return {id:alertId,acknowledged:true};
}

export async function getAlertPreferences(db:any,organizationId:string,userId:string){
  await ensureDefaultSubscriptions(db,organizationId);
  const rows=(await db.prepare(`SELECT event_type eventType,enabled,email,sms,whatsapp FROM prn_alert_subscriptions WHERE organization_id=? AND user_id=? ORDER BY event_type`).bind(organizationId,userId).all<any>()).results||[];
  const by=new Map(rows.map((r:any)=>[r.eventType,r]));
  return EVENT_TYPES.map(eventType=>{const r:any=by.get(eventType);return {eventType,enabled:r?Boolean(r.enabled):true,email:r?Boolean(r.email):true,sms:r?Boolean(r.sms):false,whatsapp:r?Boolean(r.whatsapp):false}});
}

export async function updateAlertPreferences(db:any,organizationId:string,userId:string,data:any){
  const items=Array.isArray(data.items)?data.items:[];
  const allowed=new Set(EVENT_TYPES as readonly string[]),statements=[];
  for(const item of items){const eventType=String(item.eventType||"");if(!allowed.has(eventType))continue;statements.push(db.prepare(`INSERT INTO prn_alert_subscriptions(organization_id,user_id,event_type,enabled,email,sms,whatsapp,updated_at) VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(organization_id,user_id,event_type) DO UPDATE SET enabled=excluded.enabled,email=excluded.email,sms=excluded.sms,whatsapp=excluded.whatsapp,updated_at=CURRENT_TIMESTAMP`).bind(organizationId,userId,eventType,item.enabled===false?0:1,item.email?1:0,item.sms?1:0,item.whatsapp?1:0))}
  if(statements.length)await db.batch(statements);
  return getAlertPreferences(db,organizationId,userId);
}

export async function raiseJobFailure(env:Env,node:any,jobId:string,errorMessage:string){
  const job=await env.FINANCE_DB.prepare("SELECT job_number jobNumber,title FROM prn_jobs WHERE id=? AND organization_id=?").bind(jobId,node.organization_id).first<any>();if(!job)return;
  await raiseAlert(env,{organizationId:node.organization_id,fingerprint:`job-failed:${jobId}`,eventType:"printerly.job_failed",severity:"warning",title:`Print job failed · ${job.jobNumber}`,body:`${job.title}: ${errorMessage||"The Printerly Node reported a printing failure."}`,entityType:"print_job",entityId:jobId,details:{nodeId:node.id}});
}

export async function raiseScanFailure(env:Env,node:any,scanJobId:string,errorMessage:string){
  const job=await env.FINANCE_DB.prepare("SELECT scan_number scanNumber,title FROM prn_scan_jobs WHERE id=? AND organization_id=?").bind(scanJobId,node.organization_id).first<any>();if(!job)return;
  await raiseAlert(env,{organizationId:node.organization_id,fingerprint:`scan-failed:${scanJobId}`,eventType:"printerly.scan_failed",severity:"warning",title:`Scannerly job failed · ${job.scanNumber}`,body:`${job.title}: ${errorMessage||"The Printerly Node reported a scanning failure."}`,entityType:"scan_job",entityId:scanJobId,details:{nodeId:node.id}});
}

export async function runHealthSweep(env:Env){
  const stale=(await env.FINANCE_DB.prepare(`SELECT id,organization_id organizationId,name,location,last_seen_at lastSeenAt FROM prn_nodes WHERE revoked_at IS NULL AND status='online' AND (last_seen_at IS NULL OR datetime(last_seen_at)<datetime('now','-90 seconds')) LIMIT 200`).all<any>()).results||[];
  for(const node of stale){
    await env.FINANCE_DB.batch([
      env.FINANCE_DB.prepare("UPDATE prn_nodes SET status='offline',updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(node.id,node.organizationId),
      env.FINANCE_DB.prepare("UPDATE prn_printers SET status='offline',health_status='critical',health_message='Printerly Node is offline',updated_at=CURRENT_TIMESTAMP WHERE node_id=? AND organization_id=?").bind(node.id,node.organizationId),
      env.FINANCE_DB.prepare("UPDATE prn_scanners SET status='offline',updated_at=CURRENT_TIMESTAMP WHERE node_id=? AND organization_id=?").bind(node.id,node.organizationId),
    ]);
    await raiseAlert(env,{organizationId:node.organizationId,fingerprint:`node-offline:${node.id}`,eventType:"printerly.node_offline",severity:"critical",title:`Printerly Node offline · ${node.name}`,body:`${node.name}${node.location?` (${node.location})`:""} has stopped reporting to Ledgerly. Remote printing and scanning on this node are unavailable until it reconnects.`,entityType:"node",entityId:node.id,details:{lastSeenAt:node.lastSeenAt}});
  }
}
