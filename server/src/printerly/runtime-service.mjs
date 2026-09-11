import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';

const ACTIVE_JOB_STATUSES = new Set(['queued','held','claimed','downloading','spooling','printing']);
const NODE_TRANSITIONS = Object.freeze({
  claimed:new Set(['downloading','failed']),
  downloading:new Set(['spooling','failed']),
  spooling:new Set(['printing','failed']),
  printing:new Set(['completed','failed']),
});

function required(value,name){
  if(typeof value!=='string'||!value.trim()) throw new TypeError(`${name} is required`);
  return value.trim();
}
function nonNegative(value,name){
  const n=Number(value??0);
  if(!Number.isSafeInteger(n)||n<0) throw new TypeError(`${name} must be a non-negative safe integer`);
  return n;
}
function positive(value,name){const n=nonNegative(value,name);if(n===0)throw new TypeError(`${name} must be positive`);return n;}
function id(prefix){return `${prefix}_${randomUUID().replaceAll('-','')}`;}
function monthKey(date=new Date()){return date.toISOString().slice(0,7);}
function sha256(value){return createHash('sha256').update(String(value)).digest('hex');}
function secureEqual(a,b){
  const left=Buffer.from(String(a));const right=Buffer.from(String(b));
  return left.length===right.length&&timingSafeEqual(left,right);
}
function projectedExceeded(quota,period,request){
  const checks=[
    [quota.max_impressions,period.consumed_impressions,period.reserved_impressions,request.impressions],
    [quota.max_sheets,period.consumed_sheets,period.reserved_sheets,request.sheets],
    [quota.max_cost_minor,period.consumed_cost_minor,period.reserved_cost_minor,request.costMinor],
  ];
  return checks.some(([limit,consumed,reserved,needed])=>BigInt(limit??0)>0n&&BigInt(consumed??0)+BigInt(reserved??0)+BigInt(needed??0)>BigInt(limit));
}

export class PrinterlyRuntimeError extends Error{
  constructor(code,message,details){super(message);this.name='PrinterlyRuntimeError';this.code=code;this.details=details;}
}

export class PrinterlyRuntimeService{
  constructor({database,clock=()=>new Date(),digest=sha256,randomToken=()=>randomBytes(24).toString('base64url')}){
    if(!database||typeof database.transaction!=='function')throw new TypeError('database.transaction is required');
    this.database=database;this.clock=clock;this.digest=digest;this.randomToken=randomToken;
  }

  async createJob(input){
    const organizationId=required(input.organizationId,'organizationId');
    const userId=required(input.userId,'userId');
    const documentId=required(input.documentId,'documentId');
    const idempotencyKey=required(input.idempotencyKey,'idempotencyKey');
    const copies=positive(input.copies??1,'copies');
    const estimatedPages=positive(input.estimatedPages??1,'estimatedPages');
    const estimatedImpressions=nonNegative(input.estimatedImpressions??copies*estimatedPages,'estimatedImpressions');
    const estimatedSheets=nonNegative(input.estimatedSheets??copies*estimatedPages,'estimatedSheets');
    const estimatedCostMinor=nonNegative(input.estimatedCostMinor??0,'estimatedCostMinor');
    const secureRelease=Boolean(input.secureRelease);
    const sourceReference=`request:${idempotencyKey}`;
    return this.database.transaction(async tx=>{
      const duplicate=await tx.query(`SELECT id,job_number,status FROM prn_jobs WHERE organization_id=$1 AND source_module='selfhost-api' AND source_reference=$2`,[organizationId,sourceReference]);
      if(duplicate.rows[0])return {...duplicate.rows[0],alreadyCreated:true};
      const docResult=await tx.query(`SELECT id,mime_type,checksum_sha256,status FROM prn_documents WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[documentId,organizationId]);
      const doc=docResult.rows[0];
      if(!doc||doc.status!=='staged')throw new PrinterlyRuntimeError('DOCUMENT_UNAVAILABLE','The document is not staged or is already attached');
      let printerId=input.printerId?String(input.printerId):null;
      if(printerId){
        const printer=await tx.query(`SELECT id FROM prn_printers WHERE id=$1 AND organization_id=$2`,[printerId,organizationId]);
        if(!printer.rows[0])throw new PrinterlyRuntimeError('INVALID_PRINTER','Selected printer does not belong to this organization');
      }
      const jobId=input.jobId||id('prnjob');
      const created=this.clock();
      const jobNumber=input.jobNumber||`PRT-${created.getUTCFullYear()}-${jobId.slice(-8).toUpperCase()}`;
      const request={impressions:estimatedImpressions,sheets:estimatedSheets,costMinor:estimatedCostMinor};
      await this.#reserveQuotas(tx,{organizationId,userId,jobId,request,projectId:input.projectId??null,departmentType:input.departmentType??null,departmentId:input.departmentId??null,periodKey:monthKey(created)});
      const status=secureRelease?'held':'queued';
      await tx.query(`INSERT INTO prn_jobs(
        id,organization_id,job_number,title,document_url,document_id,document_mime,document_sha256,printer_id,status,priority,copies,page_size,color_mode,duplex,secure_release,total_sheets,created_by,created_at,updated_at,
        source_module,source_reference,charge_project_id,charge_department_type,charge_department_id,estimated_pages,estimated_impressions,estimated_sheets,estimated_cost_minor)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,now(),now(),'selfhost-api',$19,$20,$21,$22,$23,$24,$25,$26)`,[
        jobId,organizationId,jobNumber,String(input.title||'Print job').trim().slice(0,200),`printerly-document:${documentId}`,documentId,doc.mime_type,doc.checksum_sha256,printerId,status,
        input.priority||'normal',copies,input.pageSize||'A4',input.colorMode||'monochrome',Boolean(input.duplex),secureRelease,estimatedSheets,userId,sourceReference,
        input.projectId??null,input.departmentType??null,input.departmentId??null,estimatedPages,estimatedImpressions,estimatedSheets,estimatedCostMinor,
      ]);
      const attached=await tx.query(`UPDATE prn_documents SET status='attached',job_id=$1,attached_at=now() WHERE id=$2 AND organization_id=$3 AND status='staged'`,[jobId,documentId,organizationId]);
      if(attached.rowCount!==1)throw new PrinterlyRuntimeError('DOCUMENT_RACE','Document changed while the print job was being created');
      await this.#event(tx,{organizationId,jobId,eventType:'created',actorId:userId,details:{status,secureRelease}});
      if(status==='queued')await this.#outbox(tx,{organizationId,jobId,eventType:'dispatch'});
      return {id:jobId,job_number:jobNumber,status,alreadyCreated:false};
    });
  }

  async releaseHeldJob({organizationId,userId,jobId}){
    required(organizationId,'organizationId');required(userId,'userId');required(jobId,'jobId');
    return this.database.transaction(async tx=>{
      const job=(await tx.query(`SELECT id,status FROM prn_jobs WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[jobId,organizationId])).rows[0];
      if(!job)throw new PrinterlyRuntimeError('JOB_NOT_FOUND','Print job not found');
      if(job.status==='queued')return {id:jobId,status:'queued',alreadyReleased:true};
      if(job.status!=='held')throw new PrinterlyRuntimeError('INVALID_STATE','Only held jobs can be released');
      await tx.query(`UPDATE prn_jobs SET status='queued',released_at=now(),updated_at=now() WHERE id=$1 AND organization_id=$2`,[jobId,organizationId]);
      await this.#event(tx,{organizationId,jobId,eventType:'released',actorId:userId,details:{}});
      await this.#outbox(tx,{organizationId,jobId,eventType:'dispatch'});
      return {id:jobId,status:'queued'};
    });
  }

  async cancelJob({organizationId,userId,jobId}){
    required(organizationId,'organizationId');required(userId,'userId');required(jobId,'jobId');
    return this.database.transaction(async tx=>{
      const job=(await tx.query(`SELECT id,status FROM prn_jobs WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[jobId,organizationId])).rows[0];
      if(!job)throw new PrinterlyRuntimeError('JOB_NOT_FOUND','Print job not found');
      if(job.status==='cancelled')return {id:jobId,status:'cancelled',duplicate:true};
      if(!['queued','held'].includes(job.status))throw new PrinterlyRuntimeError('INVALID_STATE','Only queued or held jobs can be cancelled');
      await tx.query(`UPDATE prn_jobs SET status='cancelled',claim_token=NULL,claim_expires_at=NULL,updated_at=now() WHERE id=$1 AND organization_id=$2`,[jobId,organizationId]);
      await this.#releaseReservations(tx,{organizationId,jobId});
      await this.#event(tx,{organizationId,jobId,eventType:'cancelled',actorId:userId,details:{}});
      await this.#outbox(tx,{organizationId,jobId,eventType:'cancelled'});
      return {id:jobId,status:'cancelled'};
    });
  }

  async claimForNode({organizationId,nodeId,printerIds,leaseMinutes=15}){
    required(organizationId,'organizationId');required(nodeId,'nodeId');
    if(!Array.isArray(printerIds)||printerIds.length===0)return null;
    const lease=Math.max(1,Math.min(60,Number(leaseMinutes)||15));
    return this.database.transaction(async tx=>{
      await tx.query(`UPDATE prn_jobs SET status='queued',node_id=NULL,claim_token=NULL,claim_expires_at=NULL,updated_at=now()
        WHERE organization_id=$1 AND status IN ('claimed','downloading') AND claim_expires_at<=now()`,[organizationId]);
      const job=(await tx.query(`SELECT id,printer_id,status FROM prn_jobs WHERE organization_id=$1 AND status='queued' AND (printer_id IS NULL OR printer_id=ANY($2::text[]))
        ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,created_at FOR UPDATE SKIP LOCKED LIMIT 1`,[organizationId,printerIds])).rows[0];
      if(!job)return null;
      const printerId=job.printer_id||printerIds[0];
      const valid=(await tx.query(`SELECT id,system_name FROM prn_printers WHERE id=$1 AND organization_id=$2 AND node_id=$3 AND status='ready'`,[printerId,organizationId,nodeId])).rows[0];
      if(!valid)return null;
      const token=this.randomToken();
      await tx.query(`UPDATE prn_jobs SET status='claimed',node_id=$1,printer_id=$2,claim_token=$3,claim_expires_at=now()+($4||' minutes')::interval,updated_at=now() WHERE id=$5 AND organization_id=$6`,[nodeId,printerId,token,String(lease),job.id,organizationId]);
      await this.#event(tx,{organizationId,jobId:job.id,eventType:'claimed',actorId:nodeId,details:{printerId}});
      return {id:job.id,status:'claimed',nodeId,printerId,printerSystemName:valid.system_name,claimToken:token};
    });
  }

  async nodeTransition({organizationId,nodeId,jobId,claimToken,status,errorMessage=null,actualImpressions=null,actualSheets=null,actualCostMinor=null}){
    required(organizationId,'organizationId');required(nodeId,'nodeId');required(jobId,'jobId');required(claimToken,'claimToken');required(status,'status');
    return this.database.transaction(async tx=>{
      const job=(await tx.query(`SELECT * FROM prn_jobs WHERE id=$1 AND organization_id=$2 AND node_id=$3 FOR UPDATE`,[jobId,organizationId,nodeId])).rows[0];
      if(!job||job.claim_token!==claimToken)throw new PrinterlyRuntimeError('CLAIM_INVALID','Job claim is no longer valid');
      if(job.status===status)return {id:jobId,status,duplicate:true};
      if(!NODE_TRANSITIONS[job.status]?.has(status))throw new PrinterlyRuntimeError('INVALID_JOB_TRANSITION',`Cannot move a Printerly job from ${job.status} to ${status}`);
      if(status==='completed'){
        const impressions=nonNegative(actualImpressions??job.estimated_impressions??0,'actualImpressions');
        const sheets=nonNegative(actualSheets??job.estimated_sheets??job.total_sheets??0,'actualSheets');
        const cost=nonNegative(actualCostMinor??job.estimated_cost_minor??0,'actualCostMinor');
        await this.#settleReservations(tx,{organizationId,jobId,impressions,sheets,costMinor:cost});
        await tx.query(`UPDATE prn_jobs SET status='completed',actual_impressions=$1,actual_sheets=$2,actual_cost_minor=$3,completed_at=now(),claim_expires_at=NULL,updated_at=now() WHERE id=$4 AND organization_id=$5`,[impressions,sheets,cost,jobId,organizationId]);
        await this.#outbox(tx,{organizationId,jobId,eventType:'completed'});
      }else if(status==='failed'){
        await this.#releaseReservations(tx,{organizationId,jobId});
        await tx.query(`UPDATE prn_jobs SET status='failed',error_message=$1,claim_expires_at=NULL,updated_at=now() WHERE id=$2 AND organization_id=$3`,[String(errorMessage||'').slice(0,1000),jobId,organizationId]);
        await this.#outbox(tx,{organizationId,jobId,eventType:'failed'});
      }else{
        await tx.query(`UPDATE prn_jobs SET status=$1,claim_expires_at=now()+interval '15 minutes',updated_at=now() WHERE id=$2 AND organization_id=$3`,[status,jobId,organizationId]);
      }
      await this.#event(tx,{organizationId,jobId,eventType:status,actorId:nodeId,details:{errorMessage}});
      return {id:jobId,status};
    });
  }

  async issueReleaseCredential({organizationId,userId,jobId,ttlMinutes=10,maxAttempts=5}){
    required(organizationId,'organizationId');required(userId,'userId');required(jobId,'jobId');
    const pin=String(Math.floor(100000+Math.random()*900000));const token=this.randomToken();
    return this.database.transaction(async tx=>{
      const job=(await tx.query(`SELECT id,status,secure_release FROM prn_jobs WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[jobId,organizationId])).rows[0];
      if(!job)throw new PrinterlyRuntimeError('JOB_NOT_FOUND','Print job not found');
      if(!job.secure_release||job.status!=='held')throw new PrinterlyRuntimeError('SECURE_RELEASE_INVALID','Job is not awaiting secure release');
      await tx.query(`UPDATE prn_release_credentials SET revoked_at=now() WHERE organization_id=$1 AND job_id=$2 AND used_at IS NULL AND revoked_at IS NULL`,[organizationId,jobId]);
      const credentialId=id('prnrel');
      await tx.query(`INSERT INTO prn_release_credentials(id,organization_id,job_id,issued_by,pin_digest,token_digest,max_attempts,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+($8||' minutes')::interval)`,[credentialId,organizationId,jobId,userId,this.digest(pin),this.digest(token),Math.max(1,Math.min(20,maxAttempts)),String(Math.max(1,Math.min(1440,ttlMinutes)))]);
      return {credentialId,pin,token};
    });
  }

  async redeemReleaseCredential({organizationId,nodeId,printerId,pin,token}){
    required(organizationId,'organizationId');required(nodeId,'nodeId');required(printerId,'printerId');
    return this.database.transaction(async tx=>{
      const credential=(await tx.query(`SELECT c.*,j.status job_status,j.printer_id job_printer_id FROM prn_release_credentials c JOIN prn_jobs j ON j.id=c.job_id AND j.organization_id=c.organization_id
        WHERE c.organization_id=$1 AND c.used_at IS NULL AND c.revoked_at IS NULL AND c.locked_at IS NULL AND c.expires_at>now() ORDER BY c.created_at DESC FOR UPDATE OF c`,[organizationId])).rows.find(row=>secureEqual(row.pin_digest,this.digest(pin||''))&&secureEqual(row.token_digest,this.digest(token||'')));
      if(!credential)throw new PrinterlyRuntimeError('RELEASE_INVALID','Secure release credential is invalid, expired, locked, or used');
      const printer=(await tx.query(`SELECT id FROM prn_printers WHERE id=$1 AND organization_id=$2 AND node_id=$3 AND status='ready'`,[printerId,organizationId,nodeId])).rows[0];
      if(!printer)throw new PrinterlyRuntimeError('INVALID_PRINTER','Release printer is not ready on this node');
      if(credential.job_printer_id&&credential.job_printer_id!==printerId)throw new PrinterlyRuntimeError('WRONG_PRINTER','This secure job is assigned to a different printer');
      if(credential.job_status!=='held')throw new PrinterlyRuntimeError('INVALID_STATE','Secure job is no longer held');
      await tx.query(`UPDATE prn_release_credentials SET used_at=now(),used_node_id=$1,used_printer_id=$2 WHERE id=$3`,[nodeId,printerId,credential.id]);
      await tx.query(`UPDATE prn_jobs SET printer_id=$1,status='queued',released_at=now(),updated_at=now() WHERE id=$2 AND organization_id=$3 AND status='held'`,[printerId,credential.job_id,organizationId]);
      await tx.query(`INSERT INTO prn_release_attempt_log(id,organization_id,node_id,credential_id,success,created_at) VALUES($1,$2,$3,$4,true,now())`,[id('prnrela'),organizationId,nodeId,credential.id]);
      await this.#outbox(tx,{organizationId,jobId:credential.job_id,eventType:'dispatch'});
      await this.#event(tx,{organizationId,jobId:credential.job_id,eventType:'released',actorId:nodeId,details:{printerId,secure:true}});
      return {jobId:credential.job_id,status:'queued'};
    });
  }

  async recordReleaseFailure({organizationId,nodeId,credentialId,failureCode='INVALID_CREDENTIAL'}){
    required(organizationId,'organizationId');required(nodeId,'nodeId');required(credentialId,'credentialId');
    return this.database.transaction(async tx=>{
      const c=(await tx.query(`SELECT id,attempts,max_attempts FROM prn_release_credentials WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[credentialId,organizationId])).rows[0];
      if(!c)return {locked:false,missing:true};
      const attempts=Number(c.attempts)+1,locked=attempts>=Number(c.max_attempts);
      await tx.query(`UPDATE prn_release_credentials SET attempts=$1,locked_at=CASE WHEN $2 THEN now() ELSE locked_at END WHERE id=$3`,[attempts,locked,c.id]);
      await tx.query(`INSERT INTO prn_release_attempt_log(id,organization_id,node_id,credential_id,success,failure_code,created_at) VALUES($1,$2,$3,$4,false,$5,now())`,[id('prnrela'),organizationId,nodeId,c.id,String(failureCode).slice(0,100)]);
      return {attempts,locked};
    });
  }

  async receivePurchase({organizationId,userId,requestId,receiptId,receiptNumber,lines,deliveryNote=null,invoiceReference=null,notes=null}){
    required(organizationId,'organizationId');required(userId,'userId');required(requestId,'requestId');required(receiptId,'receiptId');required(receiptNumber,'receiptNumber');
    if(!Array.isArray(lines)||!lines.length)throw new PrinterlyRuntimeError('RECEIPT_LINES_REQUIRED','At least one receipt line is required');
    return this.database.transaction(async tx=>{
      const request=(await tx.query(`SELECT id,status FROM prn_purchase_requests WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[requestId,organizationId])).rows[0];
      if(!request)throw new PrinterlyRuntimeError('REQUEST_NOT_FOUND','Purchase request not found');
      if(!['approved','ordered','partially_received'].includes(request.status))throw new PrinterlyRuntimeError('INVALID_REQUEST_STATE','Purchase request cannot receive stock in its current state');
      const existing=(await tx.query(`SELECT id FROM prn_purchase_receipts WHERE id=$1 AND organization_id=$2`,[receiptId,organizationId])).rows[0];
      if(existing)return {id:receiptId,duplicate:true};
      let total=0;
      const prepared=[];
      for(const raw of lines){
        const lineId=required(raw.requestLineId,'requestLineId'),qty=positive(raw.quantity,'quantity');
        const line=(await tx.query(`SELECT * FROM prn_purchase_request_lines WHERE id=$1 AND request_id=$2 AND organization_id=$3 FOR UPDATE`,[lineId,requestId,organizationId])).rows[0];
        if(!line)throw new PrinterlyRuntimeError('REQUEST_LINE_NOT_FOUND','Purchase request line not found');
        if(Number(line.quantity_received)+qty>Number(line.quantity_requested))throw new PrinterlyRuntimeError('OVER_RECEIPT','Receipt quantity exceeds the outstanding purchase quantity');
        const consumable=(await tx.query(`SELECT id,on_hand FROM prn_consumables WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[line.consumable_id,organizationId])).rows[0];
        if(!consumable)throw new PrinterlyRuntimeError('CONSUMABLE_NOT_FOUND','Consumable not found');
        total+=qty*Number(line.unit_cost_minor);prepared.push({line,qty,consumable});
      }
      await tx.query(`INSERT INTO prn_purchase_receipts(id,organization_id,request_id,receipt_number,delivery_note,invoice_reference,notes,received_by,total_minor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[receiptId,organizationId,requestId,receiptNumber,deliveryNote,invoiceReference,notes,userId,total]);
      for(const item of prepared){
        const balance=Number(item.consumable.on_hand)+item.qty;
        await tx.query(`INSERT INTO prn_purchase_receipt_lines(id,organization_id,receipt_id,request_line_id,consumable_id,quantity,unit_cost_minor,line_total_minor) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[id('prnprl'),organizationId,receiptId,item.line.id,item.line.consumable_id,item.qty,item.line.unit_cost_minor,item.qty*Number(item.line.unit_cost_minor)]);
        await tx.query(`UPDATE prn_purchase_request_lines SET quantity_received=quantity_received+$1 WHERE id=$2 AND organization_id=$3`,[item.qty,item.line.id,organizationId]);
        await tx.query(`UPDATE prn_consumables SET on_hand=$1,updated_at=now() WHERE id=$2 AND organization_id=$3`,[balance,item.line.consumable_id,organizationId]);
        await tx.query(`INSERT INTO prn_consumable_movements(id,organization_id,consumable_id,movement_type,quantity_delta,balance_after,unit_cost_minor,reference,actor_id) VALUES($1,$2,$3,'restock',$4,$5,$6,$7,$8)`,[id('prnmov'),organizationId,item.line.consumable_id,item.qty,balance,item.line.unit_cost_minor,`purchase-receipt:${receiptId}`,userId]);
      }
      const outstanding=(await tx.query(`SELECT COUNT(*)::int count FROM prn_purchase_request_lines WHERE request_id=$1 AND organization_id=$2 AND quantity_received<quantity_requested`,[requestId,organizationId])).rows[0];
      const status=Number(outstanding?.count||0)===0?'received':'partially_received';
      await tx.query(`UPDATE prn_purchase_requests SET status=$1,updated_at=now() WHERE id=$2 AND organization_id=$3`,[status,requestId,organizationId]);
      await tx.query(`INSERT INTO prn_purchase_request_events(id,organization_id,request_id,event_type,actor_id,details_json) VALUES($1,$2,$3,'received',$4,$5)`,[id('prnpre'),organizationId,requestId,userId,JSON.stringify({receiptId,status})]);
      return {id:receiptId,status,totalMinor:total};
    });
  }

  async #reserveQuotas(tx,{organizationId,userId,jobId,request,projectId,departmentType,departmentId,periodKey}){
    const clauses=[`scope_type='organization'`];const values=[organizationId];let p=2;
    clauses.push(`(scope_type='user' AND scope_id=$${p++})`);values.push(userId);
    if(projectId){clauses.push(`(scope_type='project' AND scope_id=$${p++})`);values.push(projectId);}
    if(departmentType==='finance'&&departmentId){clauses.push(`(scope_type='finance_department' AND scope_id=$${p++})`);values.push(departmentId);}
    if(departmentType==='school'&&departmentId){clauses.push(`(scope_type='school_department' AND scope_id=$${p++})`);values.push(departmentId);}
    const quotas=(await tx.query(`SELECT * FROM prn_quotas WHERE organization_id=$1 AND active=true AND (${clauses.join(' OR ')}) ORDER BY CASE mode WHEN 'hard' THEN 0 ELSE 1 END,id`,values)).rows;
    for(const quota of quotas){
      await tx.query(`INSERT INTO prn_quota_periods(quota_id,organization_id,period_key) VALUES($1,$2,$3) ON CONFLICT(quota_id,period_key) DO NOTHING`,[quota.id,organizationId,periodKey]);
      const period=(await tx.query(`SELECT * FROM prn_quota_periods WHERE quota_id=$1 AND period_key=$2 AND organization_id=$3 FOR UPDATE`,[quota.id,periodKey,organizationId])).rows[0];
      if(quota.mode==='hard'&&projectedExceeded(quota,period,request))throw new PrinterlyRuntimeError('PRINTERLY_QUOTA_EXCEEDED',`${quota.name} would exceed its monthly Printerly limit`,{quotaId:quota.id,periodKey});
      await tx.query(`UPDATE prn_quota_periods SET reserved_impressions=reserved_impressions+$1,reserved_sheets=reserved_sheets+$2,reserved_cost_minor=reserved_cost_minor+$3,updated_at=now() WHERE quota_id=$4 AND period_key=$5`,[request.impressions,request.sheets,request.costMinor,quota.id,periodKey]);
      await tx.query(`INSERT INTO prn_quota_reservations(id,group_id,organization_id,quota_id,period_key,job_id,reserved_impressions,reserved_sheets,reserved_cost_minor,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'reserved')`,[id('prnqres'),`job:${jobId}`,organizationId,quota.id,periodKey,jobId,request.impressions,request.sheets,request.costMinor]);
    }
  }

  async #settleReservations(tx,{organizationId,jobId,impressions,sheets,costMinor}){
    const rows=(await tx.query(`SELECT * FROM prn_quota_reservations WHERE organization_id=$1 AND job_id=$2 AND status='reserved' FOR UPDATE`,[organizationId,jobId])).rows;
    for(const row of rows){
      await tx.query(`UPDATE prn_quota_periods SET reserved_impressions=GREATEST(0,reserved_impressions-$1),reserved_sheets=GREATEST(0,reserved_sheets-$2),reserved_cost_minor=GREATEST(0,reserved_cost_minor-$3),consumed_impressions=consumed_impressions+$4,consumed_sheets=consumed_sheets+$5,consumed_cost_minor=consumed_cost_minor+$6,updated_at=now() WHERE quota_id=$7 AND period_key=$8`,[row.reserved_impressions,row.reserved_sheets,row.reserved_cost_minor,impressions,sheets,costMinor,row.quota_id,row.period_key]);
      await tx.query(`UPDATE prn_quota_reservations SET status='settled',actual_impressions=$1,actual_sheets=$2,actual_cost_minor=$3,updated_at=now() WHERE id=$4`,[impressions,sheets,costMinor,row.id]);
    }
  }

  async #releaseReservations(tx,{organizationId,jobId}){
    const rows=(await tx.query(`SELECT * FROM prn_quota_reservations WHERE organization_id=$1 AND job_id=$2 AND status='reserved' FOR UPDATE`,[organizationId,jobId])).rows;
    for(const row of rows){
      await tx.query(`UPDATE prn_quota_periods SET reserved_impressions=GREATEST(0,reserved_impressions-$1),reserved_sheets=GREATEST(0,reserved_sheets-$2),reserved_cost_minor=GREATEST(0,reserved_cost_minor-$3),updated_at=now() WHERE quota_id=$4 AND period_key=$5`,[row.reserved_impressions,row.reserved_sheets,row.reserved_cost_minor,row.quota_id,row.period_key]);
      await tx.query(`UPDATE prn_quota_reservations SET status='released',updated_at=now() WHERE id=$1`,[row.id]);
    }
  }

  async #event(tx,{organizationId,jobId,eventType,actorId,details}){
    await tx.query(`INSERT INTO prn_job_events(id,organization_id,job_id,event_type,actor_id,details_json,created_at) VALUES($1,$2,$3,$4,$5,$6,now())`,[id('prnev'),organizationId,jobId,eventType,actorId||null,JSON.stringify(details||{})]);
  }
  async #outbox(tx,{organizationId,jobId,eventType}){
    await tx.query(`INSERT INTO prn_dispatch_outbox(id,organization_id,job_id,event_type,status,available_at) VALUES($1,$2,$3,$4,'pending',now()) ON CONFLICT(organization_id,job_id,event_type) DO NOTHING`,[id('prnout'),organizationId,jobId,eventType]);
  }
}

export {ACTIVE_JOB_STATUSES,NODE_TRANSITIONS,projectedExceeded};
