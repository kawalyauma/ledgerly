import { Hono } from "hono";
import { z } from "zod";
import type { AppVariables, Env } from "../../../src/types";
import { requireScope } from "../../../src/lib/auth";
import { AppError } from "../../../src/lib/errors";
import { createId } from "../../../src/lib/ids";
import { buildIceConfig } from "./turn";
import { expireCallIfTimedOut, presenceFreshSeconds, releaseCallState, ringTimeoutSeconds } from "./policy";

export const audioCallRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
audioCallRoutes.use("*",requireScope("audio-calls:read"));

const activeStatuses=new Set(["ringing","accepted"]);
const signalSchema=z.object({toUserId:z.string().min(1).max(200),type:z.enum(["offer","answer","ice","hangup","renegotiate"]),payload:z.record(z.string(),z.unknown()).default({})});
const heartbeatSchema=z.object({availability:z.enum(["available","busy","do_not_disturb"]).default("available"),deviceId:z.string().max(200).optional().nullable()});
const startSchema=z.object({calleeUserId:z.string().min(1).max(200),metadata:z.record(z.string(),z.unknown()).default({})});

type CallRow={id:string;organization_id:string;caller_user_id:string;callee_user_id:string;status:string;started_at:string;answered_at:string|null;ended_at:string|null;ended_by_user_id:string|null;end_reason:string|null};
type Member={id:string;displayName:string;email:string;role:string};

async function activeMembership(db:D1Database,org:string,userId:string){
  return db.prepare(`SELECT u.id,u.display_name AS displayName,u.email,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=? AND m.user_id=? AND u.status='active' LIMIT 1`).bind(org,userId).first<Member>();
}
async function rawParticipantCall(db:D1Database,org:string,userId:string,callId:string){
  const row=await db.prepare(`SELECT id,organization_id,caller_user_id,callee_user_id,status,started_at,answered_at,ended_at,ended_by_user_id,end_reason FROM audio_calls WHERE id=? AND organization_id=? AND (caller_user_id=? OR callee_user_id=?)`).bind(callId,org,userId,userId).first<CallRow>();
  if(!row)throw new AppError(404,"AUDIO_CALL_NOT_FOUND","Call not found");
  return row;
}
async function participantCall(env:Env,org:string,userId:string,callId:string){
  await expireCallIfTimedOut(env,org,callId);
  return rawParticipantCall(env.FINANCE_DB,org,userId,callId);
}
async function hasActiveCall(db:D1Database,org:string,userId:string){
  return db.prepare(`SELECT id,status FROM audio_calls WHERE organization_id=? AND status IN ('ringing','accepted') AND (caller_user_id=? OR callee_user_id=?) ORDER BY started_at DESC LIMIT 1`).bind(org,userId,userId).first<{id:string;status:string}>();
}
function callView(row:CallRow){return{id:row.id,callerUserId:row.caller_user_id,calleeUserId:row.callee_user_id,status:row.status,startedAt:row.started_at,answeredAt:row.answered_at,endedAt:row.ended_at,endedByUserId:row.ended_by_user_id,endReason:row.end_reason};}
async function cleanOrphanLocks(db:D1Database,org:string,...userIds:string[]){
  for(const userId of userIds)await db.prepare(`DELETE FROM audio_call_participant_locks WHERE organization_id=? AND user_id=? AND NOT EXISTS(SELECT 1 FROM audio_calls ac WHERE ac.organization_id=? AND ac.id=audio_call_participant_locks.call_id AND ac.status IN ('ringing','accepted'))`).bind(org,userId,org).run();
}
async function freshDeclaredAvailability(db:D1Database,org:string,userId:string){
  const modifier=`-${presenceFreshSeconds()} seconds`;
  return db.prepare(`SELECT availability FROM audio_call_presence WHERE organization_id=? AND user_id=? AND last_seen_at>=datetime('now',?) LIMIT 1`).bind(org,userId,modifier).first<{availability:string}>();
}

// The directory is based on organization memberships, so Audio Calls remains a general Ledgerly module.
audioCallRoutes.get("/directory",async c=>{
  const p=c.get("principal"),q=(c.req.query("q")||"").trim().toLowerCase(),like=`%${q}%`;
  const rows=await c.env.FINANCE_DB.prepare(`SELECT u.id,u.display_name AS displayName,u.email,m.role,COALESCE(pr.availability,'offline') AS declaredAvailability,pr.last_seen_at AS lastSeenAt,pr.active_call_id AS activeCallId FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN audio_call_presence pr ON pr.organization_id=m.organization_id AND pr.user_id=m.user_id WHERE m.organization_id=? AND m.user_id<>? AND u.status='active' AND (?='' OR lower(u.display_name) LIKE ? OR lower(u.email) LIKE ?) ORDER BY u.display_name LIMIT 200`).bind(p.organizationId,p.userId,q,like,like).all<any>();
  const now=Date.now(),freshMs=presenceFreshSeconds()*1000;
  return c.json({data:rows.results.map(r=>({...r,availability:r.activeCallId?"busy":r.lastSeenAt&&now-new Date(String(r.lastSeenAt).replace(" ","T")+"Z").getTime()<freshMs?r.declaredAvailability:"offline"}))});
});

audioCallRoutes.get("/ice-config",async c=>{const p=c.get("principal");return c.json({data:await buildIceConfig(c.env,p.userId)})});
audioCallRoutes.get("/policy",c=>c.json({data:{ringTimeoutSeconds:ringTimeoutSeconds(c.env),presenceFreshSeconds:presenceFreshSeconds(),recordingEnabled:false,media:"webrtc-audio"}}));

audioCallRoutes.get("/recent",async c=>{
  const p=c.get("principal"),limit=Math.max(1,Math.min(Number(c.req.query("limit")||50),200));
  const rows=await c.env.FINANCE_DB.prepare(`SELECT ac.*,cu.display_name AS callerName,tu.display_name AS calleeName FROM audio_calls ac JOIN users cu ON cu.id=ac.caller_user_id JOIN users tu ON tu.id=ac.callee_user_id WHERE ac.organization_id=? AND (ac.caller_user_id=? OR ac.callee_user_id=?) ORDER BY ac.started_at DESC LIMIT ?`).bind(p.organizationId,p.userId,p.userId,limit).all<any>();
  return c.json({data:rows.results.map(r=>({...callView(r as CallRow),callerName:r.callerName,calleeName:r.calleeName,direction:r.caller_user_id===p.userId?"outgoing":"incoming"}))});
});

audioCallRoutes.get("/active",async c=>{
  const p=c.get("principal"),active=await hasActiveCall(c.env.FINANCE_DB,p.organizationId,p.userId);
  if(active?.status==="ringing")await expireCallIfTimedOut(c.env,p.organizationId,active.id);
  const row=await c.env.FINANCE_DB.prepare(`SELECT ac.*,cu.display_name AS callerName,cu.email AS callerEmail,tu.display_name AS calleeName,tu.email AS calleeEmail FROM audio_calls ac JOIN users cu ON cu.id=ac.caller_user_id JOIN users tu ON tu.id=ac.callee_user_id WHERE ac.organization_id=? AND (ac.caller_user_id=? OR ac.callee_user_id=?) AND ac.status IN ('ringing','accepted') ORDER BY ac.started_at DESC LIMIT 1`).bind(p.organizationId,p.userId,p.userId).first<any>();
  if(!row)return c.json({data:null});
  const mine=row.caller_user_id===p.userId;
  return c.json({data:{...callView(row as CallRow),direction:mine?"outgoing":"incoming",peerUserId:mine?row.callee_user_id:row.caller_user_id,peerName:mine?row.calleeName:row.callerName,peerEmail:mine?row.calleeEmail:row.callerEmail}});
});

audioCallRoutes.get("/incoming",async c=>{
  const p=c.get("principal"),candidate=await c.env.FINANCE_DB.prepare(`SELECT id FROM audio_calls WHERE organization_id=? AND callee_user_id=? AND status='ringing' ORDER BY started_at DESC LIMIT 1`).bind(p.organizationId,p.userId).first<{id:string}>();
  if(candidate)await expireCallIfTimedOut(c.env,p.organizationId,candidate.id);
  const row=await c.env.FINANCE_DB.prepare(`SELECT ac.*,u.display_name AS callerName,u.email AS callerEmail FROM audio_calls ac JOIN users u ON u.id=ac.caller_user_id WHERE ac.organization_id=? AND ac.callee_user_id=? AND ac.status='ringing' ORDER BY ac.started_at DESC LIMIT 1`).bind(p.organizationId,p.userId).first<any>();
  return c.json({data:row?{...callView(row as CallRow),callerName:row.callerName,callerEmail:row.callerEmail}:null});
});

audioCallRoutes.get("/calls/:id",async c=>{
  const p=c.get("principal"),call=await participantCall(c.env,p.organizationId,p.userId,c.req.param("id"));
  return c.json({data:callView(call)});
});

audioCallRoutes.post("/presence/heartbeat",async c=>{
  const p=c.get("principal"),s=heartbeatSchema.safeParse(await c.req.json().catch(()=>({})));
  if(!s.success)throw new AppError(422,"VALIDATION_ERROR","Invalid call presence",s.error.flatten());
  let active=await hasActiveCall(c.env.FINANCE_DB,p.organizationId,p.userId);
  if(active?.status==="ringing"){await expireCallIfTimedOut(c.env,p.organizationId,active.id);active=await hasActiveCall(c.env.FINANCE_DB,p.organizationId,p.userId)}
  await c.env.FINANCE_DB.prepare(`INSERT INTO audio_call_presence(organization_id,user_id,availability,active_call_id,device_id,last_seen_at,updated_at) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(organization_id,user_id) DO UPDATE SET availability=excluded.availability,active_call_id=excluded.active_call_id,device_id=excluded.device_id,last_seen_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`).bind(p.organizationId,p.userId,s.data.availability,active?.id||null,s.data.deviceId||null).run();
  return c.json({data:{availability:active?"busy":s.data.availability,declaredAvailability:s.data.availability,activeCallId:active?.id||null}});
});

audioCallRoutes.post("/calls",requireScope("audio-calls:write"),async c=>{
  const p=c.get("principal"),s=startSchema.safeParse(await c.req.json().catch(()=>({})));
  if(!s.success)throw new AppError(422,"VALIDATION_ERROR","Invalid call request",s.error.flatten());
  const calleeId=s.data.calleeUserId;if(calleeId===p.userId)throw new AppError(422,"SELF_CALL_NOT_ALLOWED","You cannot call yourself");
  if(!await activeMembership(c.env.FINANCE_DB,p.organizationId,calleeId))throw new AppError(404,"CALLEE_NOT_FOUND","Worker is not an active member of this organization");
  const metadataJson=JSON.stringify(s.data.metadata);if(metadataJson.length>8192)throw new AppError(413,"CALL_METADATA_TOO_LARGE","Call metadata is too large");
  const presence=await freshDeclaredAvailability(c.env.FINANCE_DB,p.organizationId,calleeId);
  if(presence?.availability==="do_not_disturb")throw new AppError(409,"CALLEE_DO_NOT_DISTURB","Worker is in Do Not Disturb mode");
  if(presence?.availability==="busy")throw new AppError(409,"CALLEE_BUSY","Worker has marked themselves busy");
  let mine=await hasActiveCall(c.env.FINANCE_DB,p.organizationId,p.userId),theirs=await hasActiveCall(c.env.FINANCE_DB,p.organizationId,calleeId);
  if(mine?.status==="ringing"){await expireCallIfTimedOut(c.env,p.organizationId,mine.id);mine=await hasActiveCall(c.env.FINANCE_DB,p.organizationId,p.userId)}
  if(theirs?.status==="ringing"){await expireCallIfTimedOut(c.env,p.organizationId,theirs.id);theirs=await hasActiveCall(c.env.FINANCE_DB,p.organizationId,calleeId)}
  if(mine)throw new AppError(409,"CALLER_BUSY","You already have an active call",mine);
  if(theirs)throw new AppError(409,"CALLEE_BUSY","Worker is already on another call",theirs);
  await cleanOrphanLocks(c.env.FINANCE_DB,p.organizationId,p.userId,calleeId);
  const id=createId("acl");
  try{
    await c.env.FINANCE_DB.batch([
      c.env.FINANCE_DB.prepare(`INSERT INTO audio_call_participant_locks(organization_id,user_id,call_id) VALUES(?,?,?)`).bind(p.organizationId,p.userId,id),
      c.env.FINANCE_DB.prepare(`INSERT INTO audio_call_participant_locks(organization_id,user_id,call_id) VALUES(?,?,?)`).bind(p.organizationId,calleeId,id),
      c.env.FINANCE_DB.prepare(`INSERT INTO audio_calls(id,organization_id,caller_user_id,callee_user_id,status,metadata_json) VALUES(?,?,?,?, 'ringing',?)`).bind(id,p.organizationId,p.userId,calleeId,metadataJson),
      c.env.FINANCE_DB.prepare(`INSERT INTO audio_call_presence(organization_id,user_id,availability,active_call_id,last_seen_at,updated_at) VALUES(?,?,'available',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(organization_id,user_id) DO UPDATE SET active_call_id=excluded.active_call_id,updated_at=CURRENT_TIMESTAMP`).bind(p.organizationId,p.userId,id),
      c.env.FINANCE_DB.prepare(`INSERT INTO audio_call_presence(organization_id,user_id,availability,active_call_id,last_seen_at,updated_at) VALUES(?,?,'available',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(organization_id,user_id) DO UPDATE SET active_call_id=excluded.active_call_id,updated_at=CURRENT_TIMESTAMP`).bind(p.organizationId,calleeId,id),
    ]);
  }catch{
    mine=await hasActiveCall(c.env.FINANCE_DB,p.organizationId,p.userId);theirs=await hasActiveCall(c.env.FINANCE_DB,p.organizationId,calleeId);
    if(mine)throw new AppError(409,"CALLER_BUSY","You already have an active call",mine);
    if(theirs)throw new AppError(409,"CALLEE_BUSY","Worker became busy before the call could start",theirs);
    throw new AppError(409,"CALL_COLLISION","The call could not start because one participant became busy. Try again.");
  }
  return c.json({data:{id,status:"ringing",callerUserId:p.userId,calleeUserId:calleeId,ringTimeoutSeconds:ringTimeoutSeconds(c.env)}},201);
});

async function finish(c:any,callId:string,next:"declined"|"cancelled"|"ended"|"failed",reason:string){
  const p=c.get("principal"),call=await participantCall(c.env,p.organizationId,p.userId,callId);
  if(!activeStatuses.has(call.status))return callView(call);
  if(next==="declined"&&!(call.status==="ringing"&&call.callee_user_id===p.userId))throw new AppError(409,"INVALID_CALL_STATE","Only the callee can decline a ringing call");
  if(next==="cancelled"&&!(call.status==="ringing"&&call.caller_user_id===p.userId))throw new AppError(409,"INVALID_CALL_STATE","Only the caller can cancel a ringing call");
  const changed=await c.env.FINANCE_DB.prepare(`UPDATE audio_calls SET status=?,ended_at=CURRENT_TIMESTAMP,ended_by_user_id=?,end_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND status IN ('ringing','accepted')`).bind(next,p.userId,reason.slice(0,120),callId,p.organizationId).run();
  if(changed.meta.changes)await releaseCallState(c.env.FINANCE_DB,p.organizationId,callId);
  const current=await rawParticipantCall(c.env.FINANCE_DB,p.organizationId,p.userId,callId);return callView(current);
}

audioCallRoutes.post("/calls/:id/accept",requireScope("audio-calls:write"),async c=>{
  const p=c.get("principal"),call=await participantCall(c.env,p.organizationId,p.userId,c.req.param("id"));
  if(call.callee_user_id!==p.userId||call.status!=="ringing")throw new AppError(409,"INVALID_CALL_STATE","Only the callee can accept a ringing call");
  const r=await c.env.FINANCE_DB.prepare(`UPDATE audio_calls SET status='accepted',answered_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND status='ringing'`).bind(call.id,p.organizationId).run();
  if(!r.meta.changes)throw new AppError(409,"CALL_ALREADY_HANDLED","Call is no longer ringing");
  const current=await rawParticipantCall(c.env.FINANCE_DB,p.organizationId,p.userId,call.id);return c.json({data:callView(current)});
});
audioCallRoutes.post("/calls/:id/decline",requireScope("audio-calls:write"),async c=>c.json({data:await finish(c,c.req.param("id"),"declined","declined")}));
audioCallRoutes.post("/calls/:id/cancel",requireScope("audio-calls:write"),async c=>c.json({data:await finish(c,c.req.param("id"),"cancelled","cancelled")}));
audioCallRoutes.post("/calls/:id/end",requireScope("audio-calls:write"),async c=>{const body=await c.req.json<{reason?:string}>().catch(()=>({}));return c.json({data:await finish(c,c.req.param("id"),"ended",String(body.reason||"ended"))})});
audioCallRoutes.post("/calls/:id/fail",requireScope("audio-calls:write"),async c=>{const body=await c.req.json<{reason?:string}>().catch(()=>({}));return c.json({data:await finish(c,c.req.param("id"),"failed",String(body.reason||"connection_failed"))})});

audioCallRoutes.post("/calls/:id/signals",requireScope("audio-calls:write"),async c=>{
  const p=c.get("principal"),call=await participantCall(c.env,p.organizationId,p.userId,c.req.param("id"));if(!activeStatuses.has(call.status))throw new AppError(409,"CALL_NOT_ACTIVE","Cannot signal a finished call");
  const s=signalSchema.safeParse(await c.req.json().catch(()=>({})));if(!s.success)throw new AppError(422,"VALIDATION_ERROR","Invalid WebRTC signal",s.error.flatten());
  const other=call.caller_user_id===p.userId?call.callee_user_id:call.caller_user_id;if(s.data.toUserId!==other)throw new AppError(403,"INVALID_SIGNAL_RECIPIENT","Signals may only be sent to the other call participant");
  const payloadJson=JSON.stringify(s.data.payload);if(payloadJson.length>65536)throw new AppError(413,"SIGNAL_TOO_LARGE","WebRTC signal payload is too large");
  const recent=await c.env.FINANCE_DB.prepare(`SELECT COUNT(*) AS n FROM audio_call_signals WHERE organization_id=? AND call_id=? AND from_user_id=? AND created_at>=datetime('now','-1 minute')`).bind(p.organizationId,call.id,p.userId).first<{n:number}>();if(Number(recent?.n||0)>=600)throw new AppError(429,"SIGNAL_RATE_LIMITED","Too many WebRTC signaling messages");
  const id=createId("acs");await c.env.FINANCE_DB.prepare(`INSERT INTO audio_call_signals(id,organization_id,call_id,from_user_id,to_user_id,signal_type,payload_json) VALUES(?,?,?,?,?,?,?)`).bind(id,p.organizationId,call.id,p.userId,other,s.data.type,payloadJson).run();return c.json({data:{id}},201);
});

audioCallRoutes.get("/calls/:id/signals",async c=>{
  const p=c.get("principal"),call=await participantCall(c.env,p.organizationId,p.userId,c.req.param("id")),after=Math.max(0,Number(c.req.query("after")||0));
  const rows=await c.env.FINANCE_DB.prepare(`SELECT sequence,id,from_user_id AS fromUserId,signal_type AS type,payload_json AS payloadJson,created_at AS createdAt FROM audio_call_signals WHERE organization_id=? AND call_id=? AND to_user_id=? AND sequence>? ORDER BY sequence LIMIT 200`).bind(p.organizationId,call.id,p.userId,after).all<any>();
  const data=rows.results.map(r=>({sequence:r.sequence,id:r.id,fromUserId:r.fromUserId,type:r.type,payload:JSON.parse(r.payloadJson||"{}"),createdAt:r.createdAt}));
  if(data.length)await c.env.FINANCE_DB.prepare(`UPDATE audio_call_signals SET consumed_at=COALESCE(consumed_at,CURRENT_TIMESTAMP) WHERE organization_id=? AND call_id=? AND to_user_id=? AND sequence<=?`).bind(p.organizationId,call.id,p.userId,data[data.length-1]!.sequence).run();
  return c.json({data});
});
