import {randomUUID} from 'node:crypto';
import {PrinterlyRuntimeError} from './runtime-service.mjs';

const makeId=prefix=>`${prefix}_${randomUUID().replaceAll('-','')}`;
const int=(value,fallback=0)=>Math.max(0,Math.round(Number(value)||fallback));
function breakdown(profile,impressions,sheets,colorMode){
  const paper=sheets*int(profile.paper_cost_minor),toner=impressions*int(colorMode==='color'?profile.color_toner_cost_minor:profile.bw_toner_cost_minor),maintenance=impressions*int(profile.maintenance_cost_minor),electricity=impressions*int(profile.electricity_cost_minor);
  return{paper,toner,maintenance,electricity,total:paper+toner+maintenance+electricity,currency:String(profile.currency||'UGX')};
}

export class PrinterlyCostingService{
  constructor({database}){if(!database?.transaction)throw new TypeError('database.transaction is required');this.database=database;}

  async completeClaimedJob({organizationId,nodeId,jobId,claimToken,impressionsCompleted,sheetsCompleted,actorId=nodeId}){
    return this.database.transaction(async tx=>{
      const job=(await tx.query(`SELECT * FROM prn_jobs WHERE id=$1 AND organization_id=$2 AND node_id=$3 FOR UPDATE`,[jobId,organizationId,nodeId])).rows[0];
      if(!job||job.claim_token!==claimToken)throw new PrinterlyRuntimeError('CLAIM_INVALID','Job claim is no longer valid');
      const existing=(await tx.query(`SELECT * FROM prn_cost_ledger WHERE organization_id=$1 AND job_id=$2`,[organizationId,jobId])).rows[0];
      if(job.status==='completed'&&existing)return{jobId,status:'completed',cost:existing,duplicate:true};
      if(job.status!=='printing')throw new PrinterlyRuntimeError('INVALID_JOB_TRANSITION',`Cannot complete a Printerly job from ${job.status}`);
      let profile=(await tx.query(`SELECT * FROM prn_cost_profiles WHERE organization_id=$1 FOR UPDATE`,[organizationId])).rows[0];
      if(!profile){
        const org=(await tx.query(`SELECT base_currency FROM organizations WHERE id=$1`,[organizationId])).rows[0];
        if(!org)throw new PrinterlyRuntimeError('ORGANIZATION_NOT_FOUND','Organization not found');
        await tx.query(`INSERT INTO prn_cost_profiles(organization_id,currency) VALUES($1,$2) ON CONFLICT(organization_id) DO NOTHING`,[organizationId,org.base_currency||'UGX']);
        profile=(await tx.query(`SELECT * FROM prn_cost_profiles WHERE organization_id=$1 FOR UPDATE`,[organizationId])).rows[0];
      }
      const impressions=int(impressionsCompleted,int(job.estimated_impressions,int(job.estimated_pages,1)*int(job.copies,1)));
      const sheets=int(sheetsCompleted,int(job.estimated_sheets,job.duplex?Math.ceil(impressions/2):impressions));
      const cost=breakdown(profile,impressions,sheets,job.color_mode);
      const ledgerId=existing?.id||makeId('prncost');
      if(!existing)await tx.query(`INSERT INTO prn_cost_ledger(id,organization_id,job_id,project_id,department_type,department_id,impressions,sheets,paper_cost_minor,toner_cost_minor,maintenance_cost_minor,electricity_cost_minor,total_cost_minor,currency,calculation_json)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,[ledgerId,organizationId,jobId,job.charge_project_id||null,job.charge_department_type||null,job.charge_department_id||null,impressions,sheets,cost.paper,cost.toner,cost.maintenance,cost.electricity,cost.total,cost.currency,JSON.stringify({colorMode:job.color_mode,duplex:Boolean(job.duplex),source:'node'})]);
      const reservations=(await tx.query(`SELECT * FROM prn_quota_reservations WHERE organization_id=$1 AND job_id=$2 AND status='reserved' FOR UPDATE`,[organizationId,jobId])).rows;
      for(const r of reservations){
        await tx.query(`UPDATE prn_quota_periods SET reserved_impressions=GREATEST(0,reserved_impressions-$1),reserved_sheets=GREATEST(0,reserved_sheets-$2),reserved_cost_minor=GREATEST(0,reserved_cost_minor-$3),consumed_impressions=consumed_impressions+$4,consumed_sheets=consumed_sheets+$5,consumed_cost_minor=consumed_cost_minor+$6,updated_at=now() WHERE quota_id=$7 AND period_key=$8`,[r.reserved_impressions,r.reserved_sheets,r.reserved_cost_minor,impressions,sheets,cost.total,r.quota_id,r.period_key]);
        await tx.query(`UPDATE prn_quota_reservations SET status='settled',actual_impressions=$1,actual_sheets=$2,actual_cost_minor=$3,updated_at=now() WHERE id=$4`,[impressions,sheets,cost.total,r.id]);
      }
      let journalEntryId=null;
      if(profile.auto_post_accounting&&cost.total>0&&profile.expense_account_id&&profile.offset_account_id){
        const prior=(await tx.query(`SELECT journal_entry_id FROM prn_cost_postings WHERE organization_id=$1 AND job_id=$2`,[organizationId,jobId])).rows[0];
        journalEntryId=prior?.journal_entry_id||null;
        if(!journalEntryId){
          const accounts=(await tx.query(`SELECT id FROM accounts WHERE organization_id=$1 AND active=true AND allow_posting=true AND id=ANY($2::text[])`,[organizationId,[profile.expense_account_id,profile.offset_account_id]])).rows;
          if(new Set(accounts.map(r=>r.id)).size!==new Set([profile.expense_account_id,profile.offset_account_id]).size)throw new PrinterlyRuntimeError('PRINTERLY_ACCOUNTS_INVALID','Printerly cost accounts are not active posting accounts');
          journalEntryId=makeId('je');const entryNumber=`PRN-${String(job.job_number).replace(/^PRT-/,'')}`;const date=new Date().toISOString().slice(0,10);
          await tx.query(`INSERT INTO journal_entries(id,organization_id,entry_number,transaction_date,posting_date,description,reference,source_type,source_id,status,currency,posted_at,posted_by,idempotency_key,metadata)
            VALUES($1,$2,$3,$4,$4,$5,$6,'printerly',$7,'posted',$8,now(),$9,$10,$11)`,[journalEntryId,organizationId,entryNumber,date,`Printerly cost · ${job.job_number} · ${job.title}`,job.job_number,jobId,cost.currency,actorId,`printerly-cost:${jobId}`,JSON.stringify({printerlyCostLedgerId:ledgerId})]);
          const dept=job.charge_department_type==='finance'?job.charge_department_id:null;
          await tx.query(`INSERT INTO journal_lines(id,organization_id,journal_entry_id,account_id,description,debit_minor,credit_minor,base_debit_minor,base_credit_minor,project_id,department_id) VALUES
            ($1,$2,$3,$4,$5,$6,0,$6,0,$7,$8),($9,$2,$3,$10,$11,0,$6,0,$6,$7,$8)`,[makeId('jl'),organizationId,journalEntryId,profile.expense_account_id,`Printing cost · ${job.title}`,cost.total,job.charge_project_id||null,dept,makeId('jl'),profile.offset_account_id,`Printerly cost allocation · ${job.title}`]);
          await tx.query(`INSERT INTO prn_cost_postings(id,organization_id,job_id,cost_ledger_id,journal_entry_id,posted_by) VALUES($1,$2,$3,$4,$5,$6)`,[makeId('prnpost'),organizationId,jobId,ledgerId,journalEntryId,actorId]);
        }
      }
      await tx.query(`UPDATE prn_jobs SET status='completed',actual_impressions=$1,actual_sheets=$2,actual_cost_minor=$3,total_sheets=$2,completed_at=now(),claim_expires_at=NULL,updated_at=now() WHERE id=$4 AND organization_id=$5`,[impressions,sheets,cost.total,jobId,organizationId]);
      await tx.query(`INSERT INTO prn_job_events(id,organization_id,job_id,event_type,actor_id,details_json) VALUES($1,$2,$3,'completed',$4,$5)`,[makeId('prnev'),organizationId,jobId,actorId,JSON.stringify({impressions,sheets,costMinor:cost.total,journalEntryId})]);
      await tx.query(`INSERT INTO prn_dispatch_outbox(id,organization_id,job_id,event_type,status,available_at) VALUES($1,$2,$3,'completed','pending',now()) ON CONFLICT(organization_id,job_id,event_type) DO NOTHING`,[makeId('prnout'),organizationId,jobId]);
      return{jobId,status:'completed',impressions,sheets,costMinor:cost.total,journalEntryId};
    });
  }
}
