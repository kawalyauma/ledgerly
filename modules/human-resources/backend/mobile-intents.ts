import{AppError}from'../../../src/lib/errors';

const MAX_ATTEMPTS=10;
const retrySeconds=(attempt:number)=>Math.min(86400,60*2**Math.max(0,Math.min(attempt-1,10)));
const terminal=(e:unknown,attempt:number)=>e instanceof AppError&&e.status<500||attempt>=MAX_ATTEMPTS;
const message=(e:unknown)=>(e instanceof Error?e.message:String(e)).slice(0,1000);

export async function processPendingHrMobileIntents(db:D1Database,options:{organizationId?:string;limit?:number}={}){
  const org=options.organizationId,limit=Math.min(Math.max(options.limit||25,1),100);
  await db.prepare(`UPDATE hr_mobile_leave_intents SET status='pending',error_message=COALESCE(error_message,'Recovered interrupted conversion'),next_attempt_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE status='processing' AND updated_at<datetime('now','-10 minutes')${org?' AND organization_id=?':''}`).bind(...(org?[org]:[])).run();
  const l=await db.prepare(`SELECT * FROM hr_mobile_leave_intents WHERE status='pending' AND (next_attempt_at IS NULL OR next_attempt_at<=CURRENT_TIMESTAMP)${org?' AND organization_id=?':''} ORDER BY created_at LIMIT ?`).bind(...(org?[org,limit]:[limit])).all<any>();
  let leaveProcessed=0,onboardingProcessed=0;
  for(const r of l.results){
    const attempt=Number(r.attempts||0)+1;
    const claim=await db.prepare("UPDATE hr_mobile_leave_intents SET status='processing',attempts=attempts+1,last_attempt_at=CURRENT_TIMESTAMP,next_attempt_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending' AND (next_attempt_at IS NULL OR next_attempt_at<=CURRENT_TIMESTAMP)").bind(r.id).run();
    if(!claim.meta.changes)continue;
    leaveProcessed++;
    try{
      const exists=await db.prepare('SELECT id FROM hr_leave_requests WHERE id=? AND organization_id=?').bind(r.id,r.organization_id).first();
      if(!exists)await db.prepare(`INSERT INTO hr_leave_requests(id,organization_id,employee_id,leave_type_id,starts_on,ends_on,days_micros,reason,status,requested_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?, 'pending',?,?,?)`).bind(r.id,r.organization_id,r.employee_id,r.leave_type_id,r.starts_on,r.ends_on,r.days_micros,r.reason,r.requested_by,r.client_created_at,r.client_created_at).run();
      await db.prepare("UPDATE hr_mobile_leave_intents SET status='applied',server_leave_request_id=id,applied_at=COALESCE(applied_at,CURRENT_TIMESTAMP),error_message=NULL,next_attempt_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(r.id).run();
    }catch(e){
      const msg=message(e);
      if(terminal(e,attempt))await db.prepare("UPDATE hr_mobile_leave_intents SET status='rejected',error_message=?,next_attempt_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(msg,r.id).run();
      else await db.prepare("UPDATE hr_mobile_leave_intents SET status='pending',error_message=?,next_attempt_at=datetime('now',?),updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(msg,`+${retrySeconds(attempt)} seconds`,r.id).run();
    }
  }
  const c=await db.prepare(`SELECT * FROM hr_mobile_onboarding_intents WHERE status='pending' AND (next_attempt_at IS NULL OR next_attempt_at<=CURRENT_TIMESTAMP)${org?' AND organization_id=?':''} ORDER BY created_at LIMIT ?`).bind(...(org?[org,limit]:[limit])).all<any>();
  for(const r of c.results){
    const attempt=Number(r.attempts||0)+1;
    const claim=await db.prepare("UPDATE hr_mobile_onboarding_intents SET attempts=attempts+1,last_attempt_at=CURRENT_TIMESTAMP,next_attempt_at=datetime('now','+10 minutes'),updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending' AND (next_attempt_at IS NULL OR next_attempt_at<=CURRENT_TIMESTAMP)").bind(r.id).run();
    if(!claim.meta.changes)continue;
    onboardingProcessed++;
    try{
      const x=await db.prepare("UPDATE hr_onboarding_tasks SET status='completed',completed_at=COALESCE(completed_at,?),updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND status<>'completed'").bind(r.client_completed_at,r.task_id,r.organization_id).run();
      if(!x.meta.changes){const exists=await db.prepare('SELECT id FROM hr_onboarding_tasks WHERE id=? AND organization_id=?').bind(r.task_id,r.organization_id).first();if(!exists)throw new AppError(404,'ONBOARDING_TASK_NOT_FOUND','Onboarding task not found')}
      await db.prepare("UPDATE hr_mobile_onboarding_intents SET status='applied',applied_at=COALESCE(applied_at,CURRENT_TIMESTAMP),error_message=NULL,next_attempt_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(r.id).run();
    }catch(e){
      const msg=message(e);
      if(terminal(e,attempt))await db.prepare("UPDATE hr_mobile_onboarding_intents SET status='rejected',error_message=?,next_attempt_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(msg,r.id).run();
      else await db.prepare("UPDATE hr_mobile_onboarding_intents SET error_message=?,next_attempt_at=datetime('now',?),updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").bind(msg,`+${retrySeconds(attempt)} seconds`,r.id).run();
    }
  }
  return{leaveProcessed,onboardingProcessed};
}
