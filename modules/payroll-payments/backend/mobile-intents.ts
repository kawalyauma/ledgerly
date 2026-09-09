import{AppError}from'../../../src/lib/errors';
import{createPayment}from'../../../src/services/payments';
const MAX_ATTEMPTS=10;
const retrySeconds=(attempt:number)=>Math.min(86400,60*2**Math.max(0,Math.min(attempt-1,10)));
const msg=(e:unknown)=>(e instanceof Error?e.message:String(e)).slice(0,1000);
const isTerminal=(e:unknown,attempt:number)=>e instanceof AppError&&e.status<500||attempt>=MAX_ATTEMPTS;
export async function processPendingPaymentMobileIntents(db:D1Database,options:{organizationId?:string;limit?:number}={}){
  const org=options.organizationId,limit=Math.min(Math.max(options.limit||25,1),100);
  await db.prepare(`UPDATE pay_mobile_payment_intents SET status='pending',error_message=COALESCE(error_message,'Recovered interrupted conversion'),next_attempt_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE status='processing' AND updated_at<datetime('now','-10 minutes')${org?' AND organization_id=?':''}`).bind(...(org?[org]:[])).run();
  const q=await db.prepare(`SELECT * FROM pay_mobile_payment_intents WHERE status='pending' AND (next_attempt_at IS NULL OR next_attempt_at<=CURRENT_TIMESTAMP)${org?' AND organization_id=?':''} ORDER BY created_at LIMIT ?`).bind(...(org?[org,limit]:[limit])).all<any>();
  let processed=0;
  for(const r of q.results){
    const attempt=Number(r.attempts||0)+1;
    const claimed=await db.prepare("UPDATE pay_mobile_payment_intents SET status='processing',attempts=attempts+1,last_attempt_at=CURRENT_TIMESTAMP,next_attempt_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND status='pending' AND (next_attempt_at IS NULL OR next_attempt_at<=CURRENT_TIMESTAMP)").bind(r.id,r.organization_id).run();
    if(!claimed.meta.changes)continue;
    processed++;
    try{
      const payload=JSON.parse(r.payload_json),created=await createPayment(db,r.organization_id,r.created_by,payload,`mobile-payment:${r.id}`);
      await db.prepare("UPDATE pay_mobile_payment_intents SET status='applied',server_payment_id=?,error_message=NULL,applied_at=COALESCE(applied_at,CURRENT_TIMESTAMP),next_attempt_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind((created as any).id,r.id,r.organization_id).run();
    }catch(e){
      const error=msg(e);
      if(isTerminal(e,attempt))await db.prepare("UPDATE pay_mobile_payment_intents SET status='rejected',error_message=?,next_attempt_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(error,r.id,r.organization_id).run();
      else await db.prepare("UPDATE pay_mobile_payment_intents SET status='pending',error_message=?,next_attempt_at=datetime('now',?),updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(error,`+${retrySeconds(attempt)} seconds`,r.id,r.organization_id).run();
    }
  }
  return{processed};
}
