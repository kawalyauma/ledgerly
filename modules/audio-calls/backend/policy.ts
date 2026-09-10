import type { Env } from "../../../src/types";

const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
export function ringTimeoutSeconds(env:Env){const n=Number(env.AUDIO_CALL_RING_TIMEOUT_SECONDS||35);return Number.isFinite(n)?clamp(Math.round(n),10,120):35;}
export function presenceFreshSeconds(){return 45;}
// WebRTC media can continue while mobile JS timers are suspended in the background.
// Keep accepted-call cleanup deliberately conservative; ordinary disconnects are ended by clients.
export function acceptedStaleSeconds(){return 8*60*60;}

export async function releaseCallState(db:D1Database,organizationId:string,callId:string){
  await db.batch([
    db.prepare("DELETE FROM audio_call_participant_locks WHERE organization_id=? AND call_id=?").bind(organizationId,callId),
    db.prepare("UPDATE audio_call_presence SET active_call_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND active_call_id=?").bind(organizationId,callId),
  ]);
}

export async function expireCallIfTimedOut(env:Env,organizationId:string,callId:string){
  const modifier=`-${ringTimeoutSeconds(env)} seconds`;
  const result=await env.FINANCE_DB.prepare(`UPDATE audio_calls SET status='missed',ended_at=CURRENT_TIMESTAMP,end_reason='ring_timeout',updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND status='ringing' AND started_at<datetime('now',?)`).bind(callId,organizationId,modifier).run();
  if(result.meta.changes)await releaseCallState(env.FINANCE_DB,organizationId,callId);
  return Boolean(result.meta.changes);
}

export async function expireStaleCalls(env:Env,limit=250){
  const db=env.FINANCE_DB,ringModifier=`-${ringTimeoutSeconds(env)} seconds`,acceptedModifier=`-${acceptedStaleSeconds()} seconds`;
  const ringing=await db.prepare(`SELECT id,organization_id AS organizationId FROM audio_calls WHERE status='ringing' AND started_at<datetime('now',?) LIMIT ?`).bind(ringModifier,limit).all<{id:string;organizationId:string}>();
  for(const call of ringing.results){
    const changed=await db.prepare(`UPDATE audio_calls SET status='missed',ended_at=CURRENT_TIMESTAMP,end_reason='ring_timeout',updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND status='ringing'`).bind(call.id,call.organizationId).run();
    if(changed.meta.changes)await releaseCallState(db,call.organizationId,call.id);
  }

  const accepted=await db.prepare(`SELECT ac.id,ac.organization_id AS organizationId FROM audio_calls ac WHERE ac.status='accepted' AND ac.answered_at<datetime('now',?) AND (NOT EXISTS(SELECT 1 FROM audio_call_presence p WHERE p.organization_id=ac.organization_id AND p.user_id=ac.caller_user_id AND p.active_call_id=ac.id AND p.last_seen_at>=datetime('now',?)) OR NOT EXISTS(SELECT 1 FROM audio_call_presence p WHERE p.organization_id=ac.organization_id AND p.user_id=ac.callee_user_id AND p.active_call_id=ac.id AND p.last_seen_at>=datetime('now',?))) LIMIT ?`).bind(acceptedModifier,acceptedModifier,acceptedModifier,limit).all<{id:string;organizationId:string}>();
  for(const call of accepted.results){
    const changed=await db.prepare(`UPDATE audio_calls SET status='failed',ended_at=CURRENT_TIMESTAMP,end_reason='stale_call_cleanup',updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND status='accepted'`).bind(call.id,call.organizationId).run();
    if(changed.meta.changes)await releaseCallState(db,call.organizationId,call.id);
  }

  await db.prepare(`DELETE FROM audio_call_participant_locks WHERE NOT EXISTS (SELECT 1 FROM audio_calls ac WHERE ac.id=audio_call_participant_locks.call_id AND ac.organization_id=audio_call_participant_locks.organization_id AND ac.status IN ('ringing','accepted'))`).run();
  await db.prepare(`DELETE FROM audio_call_signals WHERE created_at<datetime('now','-1 day') OR (consumed_at IS NOT NULL AND consumed_at<datetime('now','-10 minutes'))`).run();
  return{ringingExpired:ringing.results.length,acceptedExpired:accepted.results.length};
}
