import {createHash,randomInt,randomUUID} from 'node:crypto';
import {PrinterlyManagementService} from './management-service.mjs';
import {PrinterlyRuntimeError} from './runtime-service.mjs';

const id=prefix=>`${prefix}_${randomUUID().replaceAll('-','')}`;
const int=(value,min=0,max=Number.MAX_SAFE_INTEGER,fallback=0)=>{const n=Math.round(Number(value));return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;};
const fail=(code,message,status=409,details)=>Object.assign(new PrinterlyRuntimeError(code,message,details),{status});

export class PrinterlyHardenedManagementService extends PrinterlyManagementService{
  async createNode(organizationId,userId,data={}){
    const name=String(data.name||'').trim().slice(0,160);
    if(!name)throw fail('VALIDATION_ERROR','Node name is required',422);
    let pairingCode='',pairingDigest='';
    for(let attempt=0;attempt<20;attempt++){
      pairingCode=String(randomInt(0,1_000_000)).padStart(6,'0');
      pairingDigest=createHash('sha256').update(pairingCode).digest('hex');
      const clash=(await this.database.query(`SELECT 1 FROM prn_nodes WHERE pairing_code_hash=$1 AND revoked_at IS NULL AND pairing_expires_at>now() LIMIT 1`,[pairingDigest])).rows[0];
      if(!clash)break;
      if(attempt===19)throw fail('PAIRING_CODE_BUSY','Could not allocate a unique Printerly pairing code. Try again.',503);
    }
    const nodeId=id('prnnode');
    const minutes=int(data.ttlMinutes,2,120,15);
    await this.database.query(
      `INSERT INTO prn_nodes(id,organization_id,name,location,status,pairing_code_hash,pairing_expires_at,created_by) VALUES($1,$2,$3,$4,'pairing',$5,now()+($6||' minutes')::interval,$7)`,
      [nodeId,organizationId,name,String(data.location||'').trim().slice(0,240)||null,pairingDigest,String(minutes),userId],
    );
    return{id:nodeId,name,pairingCode,expiresAt:new Date(Date.now()+minutes*60_000).toISOString(),nodeProtocol:3};
  }

  async postJobCost(organizationId,userId,jobId){
    return this.database.transaction(async tx=>{
      // The cost/job lock serializes manual posting with other manual requests and
      // with node completion, which locks the job before auto-posting accounting.
      const row=(await tx.query(
        `SELECT c.*,j.job_number,j.title,j.charge_project_id,j.charge_department_type,j.charge_department_id FROM prn_cost_ledger c JOIN prn_jobs j ON j.id=c.job_id AND j.organization_id=c.organization_id WHERE c.organization_id=$1 AND c.job_id=$2 FOR UPDATE OF c,j`,
        [organizationId,jobId],
      )).rows[0];
      if(!row)throw fail('COST_NOT_FOUND','Completed Printerly cost record not found',404);

      // Re-check only after the serialization lock. A concurrent poster that won
      // while this transaction was waiting is now visible and no second journal is created.
      const prior=(await tx.query(
        `SELECT journal_entry_id FROM prn_cost_postings WHERE organization_id=$1 AND job_id=$2`,
        [organizationId,jobId],
      )).rows[0];
      if(prior)return{jobId,journalEntryId:prior.journal_entry_id,duplicate:true};

      const profile=(await tx.query(
        `SELECT * FROM prn_cost_profiles WHERE organization_id=$1 FOR UPDATE`,
        [organizationId],
      )).rows[0];
      if(!profile?.expense_account_id||!profile?.offset_account_id)throw fail('PRINTERLY_ACCOUNTS_REQUIRED','Configure Printerly expense and offset accounts first',409);

      const total=Number(row.total_cost_minor||0);
      const journalEntryId=id('je');
      const date=new Date().toISOString().slice(0,10);
      await tx.query(
        `INSERT INTO journal_entries(id,organization_id,entry_number,transaction_date,posting_date,description,reference,source_type,source_id,status,currency,posted_at,posted_by,idempotency_key,metadata) VALUES($1,$2,$3,$4,$4,$5,$6,'printerly',$7,'posted',$8,now(),$9,$10,$11)`,
        [journalEntryId,organizationId,`PRN-${String(row.job_number).replace(/^PRT-/,'')}`,date,`Printerly cost · ${row.job_number} · ${row.title}`,row.job_number,jobId,row.currency,userId,`printerly-cost:${jobId}`,JSON.stringify({printerlyCostLedgerId:row.id})],
      );
      const departmentId=row.charge_department_type==='finance'?row.charge_department_id:null;
      await tx.query(
        `INSERT INTO journal_lines(id,organization_id,journal_entry_id,account_id,description,debit_minor,credit_minor,base_debit_minor,base_credit_minor,project_id,department_id) VALUES($1,$2,$3,$4,$5,$6,0,$6,0,$7,$8),($9,$2,$3,$10,$11,0,$6,0,$6,$7,$8)`,
        [id('jl'),organizationId,journalEntryId,profile.expense_account_id,`Printing cost · ${row.title}`,total,row.charge_project_id||null,departmentId,id('jl'),profile.offset_account_id,`Printerly cost allocation · ${row.title}`],
      );
      await tx.query(
        `INSERT INTO prn_cost_postings(id,organization_id,job_id,cost_ledger_id,journal_entry_id,posted_by) VALUES($1,$2,$3,$4,$5,$6)`,
        [id('prnpost'),organizationId,jobId,row.id,journalEntryId,userId],
      );
      return{jobId,journalEntryId,duplicate:false};
    });
  }
}
