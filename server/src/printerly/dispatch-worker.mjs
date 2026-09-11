function clamp(value,min,max,fallback){const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;}

export class PrinterlyDispatchWorker{
  constructor({database,queue,maxAttempts=8,leaseSeconds=60}){
    if(!database||typeof database.transaction!=='function')throw new TypeError('database.transaction is required');
    if(!queue||typeof queue.enqueue!=='function')throw new TypeError('queue.enqueue is required');
    this.database=database;this.queue=queue;this.maxAttempts=maxAttempts;this.leaseSeconds=leaseSeconds;
  }

  async recoverExpired(){
    return this.database.query(`UPDATE prn_dispatch_outbox SET status=CASE WHEN attempts>=$1 THEN 'dead' ELSE 'pending' END,lease_expires_at=NULL,available_at=CASE WHEN attempts>=$1 THEN available_at ELSE now() END,updated_at=now() WHERE status='processing' AND lease_expires_at<=now()`,[this.maxAttempts]);
  }

  async drain({limit=50}={}){
    const take=clamp(limit,1,200,50);let processed=0,failed=0;
    await this.recoverExpired();
    for(let i=0;i<take;i++){
      const item=await this.database.transaction(async tx=>{
        const row=(await tx.query(`SELECT * FROM prn_dispatch_outbox WHERE status='pending' AND available_at<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
        if(!row)return null;
        if(Number(row.attempts)>=this.maxAttempts){await tx.query(`UPDATE prn_dispatch_outbox SET status='dead',updated_at=now() WHERE id=$1`,[row.id]);return null;}
        await tx.query(`UPDATE prn_dispatch_outbox SET status='processing',attempts=attempts+1,lease_expires_at=now()+($2||' seconds')::interval,updated_at=now() WHERE id=$1`,[row.id,String(this.leaseSeconds)]);
        return {...row,attempts:Number(row.attempts)+1};
      });
      if(!item)break;
      try{
        await this.queue.enqueue({type:`printerly.${item.event_type}`,jobId:`printerly:${item.id}`,idempotencyKey:`printerly:${item.organization_id}:${item.job_id}:${item.event_type}`,payload:{organizationId:item.organization_id,jobId:item.job_id,eventType:item.event_type},maxAttempts:this.maxAttempts});
        await this.database.query(`UPDATE prn_dispatch_outbox SET status='sent',lease_expires_at=NULL,last_error=NULL,updated_at=now() WHERE id=$1 AND status='processing'`,[item.id]);
        processed++;
      }catch(error){
        const dead=item.attempts>=this.maxAttempts;const delay=Math.min(3600,5*(2**Math.min(item.attempts,9)));
        await this.database.query(`UPDATE prn_dispatch_outbox SET status=$2,lease_expires_at=NULL,last_error=$3,available_at=CASE WHEN $2='pending' THEN now()+($4||' seconds')::interval ELSE available_at END,updated_at=now() WHERE id=$1`,[item.id,dead?'dead':'pending',String(error?.message||error).slice(0,1000),String(delay)]);
        failed++;
      }
    }
    return {processed,failed};
  }
}
