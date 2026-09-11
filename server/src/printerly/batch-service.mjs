import {randomUUID} from 'node:crypto';
import {PrinterlyRuntimeError} from './runtime-service.mjs';

const makeId=prefix=>`${prefix}_${randomUUID().replaceAll('-','')}`;
const json=(value,fallback)=>{try{return value?JSON.parse(String(value)):fallback}catch{return fallback}};
const clamp=(value,min,max,fallback)=>{const n=Math.round(Number(value));return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback};
const array=value=>Array.isArray(value)?value.map(String).filter(Boolean):[];

function normalizeMatch(input={}){
  return {roles:array(input.roles),userIds:array(input.userIds),projectIds:array(input.projectIds),departments:array(input.departments),sourceModules:array(input.sourceModules),priorities:array(input.priorities),colorModes:array(input.colorModes),pageSizes:array(input.pageSizes),minImpressions:Number.isFinite(Number(input.minImpressions))?Number(input.minImpressions):null,maxImpressions:Number.isFinite(Number(input.maxImpressions))?Number(input.maxImpressions):null,minCostMinor:Number.isFinite(Number(input.minCostMinor))?Number(input.minCostMinor):null,maxCostMinor:Number.isFinite(Number(input.maxCostMinor))?Number(input.maxCostMinor):null,minCopies:Number.isFinite(Number(input.minCopies))?Number(input.minCopies):null,maxCopies:Number.isFinite(Number(input.maxCopies))?Number(input.maxCopies):null};
}
function normalizeAction(input={}){
  return {block:Boolean(input.block),blockMessage:String(input.blockMessage||'This print request is blocked by an organization Printerly policy.').slice(0,500),requireApproval:Boolean(input.requireApproval),approverRoles:array(input.approverRoles).length?array(input.approverRoles):['owner','admin'],approverUserIds:array(input.approverUserIds),allowSelfApproval:Boolean(input.allowSelfApproval),forceDuplex:Boolean(input.forceDuplex),forceMonochrome:Boolean(input.forceMonochrome),forceSecureRelease:Boolean(input.forceSecureRelease),printerId:input.printerId?String(input.printerId):null,priority:input.priority?String(input.priority):null};
}
export function policyApplies(match,principal,options,prepared){
  const m=normalizeMatch(match),department=options.departmentId?`${options.departmentType||'finance'}:${options.departmentId}`:'';
  if(m.roles.length&&!m.roles.includes(String(principal.role)))return false;
  if(m.userIds.length&&!m.userIds.includes(String(principal.userId)))return false;
  if(m.projectIds.length&&!m.projectIds.includes(String(options.projectId||'')))return false;
  if(m.departments.length&&!m.departments.includes(department))return false;
  if(m.sourceModules.length&&!m.sourceModules.some(value=>options.sourceModule===value||String(options.sourceModule||'').startsWith(`${value}.`)||String(options.sourceModule||'').startsWith(`${value}/`)))return false;
  if(m.priorities.length&&!m.priorities.includes(String(options.priority||'normal')))return false;
  if(m.colorModes.length&&!m.colorModes.includes(String(options.colorMode||'monochrome')))return false;
  if(m.pageSizes.length&&!m.pageSizes.includes(String(options.pageSize||'A4')))return false;
  const impressions=Number(prepared.estimatedImpressions||0),cost=Number(prepared.estimatedCostMinor||0),copies=Number(options.copies||1);
  return !((m.minImpressions!==null&&impressions<m.minImpressions)||(m.maxImpressions!==null&&impressions>m.maxImpressions)||(m.minCostMinor!==null&&cost<m.minCostMinor)||(m.maxCostMinor!==null&&cost>m.maxCostMinor)||(m.minCopies!==null&&copies<m.minCopies)||(m.maxCopies!==null&&copies>m.maxCopies));
}

export class PrinterlyBatchService{
  constructor({database}){if(!database?.query||!database?.transaction)throw new TypeError('database is required');this.database=database;}

  async dispatch(organizationId,{batchLimit=8,itemLimit=25}={}){
    await this.database.query(`UPDATE prn_batch_items SET status='pending',claim_token=NULL,claim_expires_at=NULL,updated_at=now() WHERE organization_id=$1 AND status='dispatching' AND claim_expires_at<now()`,[organizationId]);
    const batches=(await this.database.query(`SELECT * FROM prn_batches WHERE organization_id=$1 AND status IN ('scheduled','ready','dispatching') AND (scheduled_at IS NULL OR scheduled_at<=now()) ORDER BY COALESCE(scheduled_at,created_at),created_at LIMIT $2`,[organizationId,clamp(batchLimit,1,50,8)])).rows;
    let submitted=0,failed=0;
    for(const batch of batches){
      const member=(await this.database.query(`SELECT role FROM memberships WHERE organization_id=$1 AND user_id=$2`,[organizationId,batch.created_by])).rows[0];
      if(!member){await this.database.query(`UPDATE prn_batches SET status='failed',last_error='Batch creator is no longer an organization member',completed_at=now(),updated_at=now() WHERE id=$1 AND organization_id=$2`,[batch.id,organizationId]);continue;}
      await this.database.query(`UPDATE prn_batches SET status='dispatching',started_at=COALESCE(started_at,now()),last_error=NULL,updated_at=now() WHERE id=$1 AND organization_id=$2 AND status IN ('scheduled','ready','dispatching')`,[batch.id,organizationId]);
      for(let i=0;i<clamp(itemLimit,1,50,25);i++){
        const claim=await this.#claimItem(organizationId,batch.id);if(!claim)break;
        try{await this.#submitClaim(organizationId,batch,member,claim);submitted++;}catch(error){failed++;await this.database.query(`UPDATE prn_batch_items SET status='failed',error_message=$1,claim_token=NULL,claim_expires_at=NULL,updated_at=now() WHERE id=$2 AND organization_id=$3 AND status='dispatching' AND claim_token=$4`,[String(error?.message||error).slice(0,1000),claim.id,organizationId,claim.claim_token]).catch(()=>{});}
      }
    }
    return{submitted,failed,batches:batches.length};
  }

  async #claimItem(organizationId,batchId){
    return this.database.transaction(async tx=>{
      const item=(await tx.query(`SELECT i.* FROM prn_batch_items i WHERE i.organization_id=$1 AND i.batch_id=$2 AND i.status='pending' ORDER BY i.sort_order,i.created_at FOR UPDATE SKIP LOCKED LIMIT 1`,[organizationId,batchId])).rows[0];
      if(!item)return null;const token=randomUUID();
      const moved=await tx.query(`UPDATE prn_batch_items SET status='dispatching',claim_token=$1,claim_expires_at=now()+interval '10 minutes',attempts=attempts+1,updated_at=now() WHERE id=$2 AND organization_id=$3 AND status='pending' RETURNING *`,[token,item.id,organizationId]);
      return moved.rows[0]||null;
    });
  }

  async #submitClaim(organizationId,batch,member,item){
    return this.database.transaction(async tx=>{
      const locked=(await tx.query(`SELECT i.*,d.status document_status,d.mime_type,d.checksum_sha256 FROM prn_batch_items i JOIN prn_documents d ON d.id=i.document_id AND d.organization_id=i.organization_id WHERE i.id=$1 AND i.organization_id=$2 AND i.status='dispatching' AND i.claim_token=$3 FOR UPDATE OF i,d`,[item.id,organizationId,item.claim_token])).rows[0];
      if(!locked)throw new PrinterlyRuntimeError('BATCH_ITEM_LEASE_LOST','Printerly batch item lease was lost');
      const sourceReference=`${batch.id}:${locked.id}`;
      const duplicate=(await tx.query(`SELECT id FROM prn_jobs WHERE organization_id=$1 AND source_module='printerly-batch' AND source_reference=$2`,[organizationId,sourceReference])).rows[0];
      if(duplicate){await tx.query(`UPDATE prn_batch_items SET status='submitted',job_id=$1,error_message=NULL,claim_token=NULL,claim_expires_at=NULL,updated_at=now() WHERE id=$2 AND organization_id=$3`,[duplicate.id,locked.id,organizationId]);return{jobId:duplicate.id,duplicate:true};}
      if(locked.document_status!=='staged')throw new PrinterlyRuntimeError('DOCUMENT_UNAVAILABLE','Batch document is no longer staged');
      const defaults=json(batch.defaults_json,{}),settings={...defaults,...json(locked.settings_json,{})};
      let options=this.#options(settings,{sourceModule:'printerly-batch',sourceReference});
      let prepared=await this.#prepareCost(tx,organizationId,options);
      const policy=await this.#evaluatePolicy(tx,organizationId,{userId:batch.created_by,role:member.role,scopes:json(batch.creator_scopes_json,[])},options,prepared);
      if(policy.blocked)throw new PrinterlyRuntimeError('PRINT_POLICY_BLOCKED',policy.blockedReason,{rules:policy.applied});
      options=this.#options({...options,...policy.effective},{sourceModule:'printerly-batch',sourceReference});
      prepared=await this.#prepareCost(tx,organizationId,options);
      const printerId=options.printerId||null;
      if(printerId&&!((await tx.query(`SELECT id FROM prn_printers WHERE id=$1 AND organization_id=$2`,[printerId,organizationId])).rows[0]))throw new PrinterlyRuntimeError('INVALID_PRINTER','Selected Printerly printer is unavailable');
      const jobId=makeId('prnjob'),jobNumber=`PRT-${new Date().getUTCFullYear()}-${jobId.slice(-8).toUpperCase()}`;
      await this.#reserveQuotas(tx,{organizationId,userId:batch.created_by,jobId,request:{impressions:prepared.estimatedImpressions,sheets:prepared.estimatedSheets,costMinor:prepared.estimatedCostMinor},projectId:prepared.projectId,departmentType:prepared.departmentType,departmentId:prepared.departmentId,periodKey:new Date().toISOString().slice(0,7)});
      const status=policy.requiresApproval?'approval_pending':options.secureRelease?'held':'queued';
      await tx.query(`INSERT INTO prn_jobs(id,organization_id,job_number,title,document_url,document_id,document_mime,document_sha256,printer_id,status,priority,copies,page_size,color_mode,duplex,secure_release,total_sheets,created_by,source_module,source_reference,charge_project_id,charge_department_type,charge_department_id,estimated_pages,estimated_impressions,estimated_sheets,estimated_cost_minor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'printerly-batch',$19,$20,$21,$22,$23,$24,$25,$26)`,[jobId,organizationId,jobNumber,String(locked.title||'Batch print').slice(0,200),`printerly-document:${locked.document_id}`,locked.document_id,locked.mime_type,locked.checksum_sha256,printerId,status,options.priority,options.copies,options.pageSize,options.colorMode,options.duplex,options.secureRelease,prepared.estimatedSheets,batch.created_by,sourceReference,prepared.projectId,prepared.departmentType,prepared.departmentId,prepared.estimatedPages,prepared.estimatedImpressions,prepared.estimatedSheets,prepared.estimatedCostMinor]);
      const attached=await tx.query(`UPDATE prn_documents SET status='attached',job_id=$1,attached_at=now() WHERE id=$2 AND organization_id=$3 AND status='staged'`,[jobId,locked.document_id,organizationId]);if(attached.rowCount!==1)throw new PrinterlyRuntimeError('DOCUMENT_RACE','Batch document changed while its job was being created');
      await tx.query(`INSERT INTO prn_job_events(id,organization_id,job_id,event_type,actor_id,details_json) VALUES($1,$2,$3,$4,$5,$6)`,[makeId('prnev'),organizationId,jobId,policy.requiresApproval?'approval_requested':'batch_submitted',batch.created_by,JSON.stringify({batchId:batch.id,batchItemId:locked.id,appliedRules:policy.applied})]);
      if(policy.requiresApproval){await tx.query(`INSERT INTO prn_approvals(id,organization_id,job_id,rule_ids_json,status,requested_by,approver_roles_json,approver_user_ids_json,allow_self_approval) VALUES($1,$2,$3,$4,'pending',$5,$6,$7,$8)`,[makeId('prnappr'),organizationId,jobId,JSON.stringify(policy.ruleIds),batch.created_by,JSON.stringify(policy.approverRoles),JSON.stringify(policy.approverUserIds),policy.allowSelfApproval]);}
      else if(status==='queued')await tx.query(`INSERT INTO prn_dispatch_outbox(id,organization_id,job_id,event_type,status,available_at) VALUES($1,$2,$3,'dispatch','pending',now()) ON CONFLICT(organization_id,job_id,event_type) DO NOTHING`,[makeId('prnout'),organizationId,jobId]);
      const done=await tx.query(`UPDATE prn_batch_items SET status='submitted',job_id=$1,error_message=NULL,claim_token=NULL,claim_expires_at=NULL,updated_at=now() WHERE id=$2 AND organization_id=$3 AND status='dispatching' AND claim_token=$4`,[jobId,locked.id,organizationId,item.claim_token]);if(done.rowCount!==1)throw new PrinterlyRuntimeError('BATCH_ITEM_LEASE_LOST','Printerly batch item lease was lost before commit');
      return{jobId,status};
    });
  }

  #options(settings,source){
    const priority=new Set(['urgent','high','normal','bulk']).has(String(settings.priority))?String(settings.priority):'normal',pageSize=new Set(['A4','A5','Letter','Legal']).has(String(settings.pageSize))?String(settings.pageSize):'A4',colorMode=String(settings.colorMode)==='color'?'color':'monochrome';
    return{printerId:settings.printerId?String(settings.printerId):null,copies:clamp(settings.copies,1,1000,1),estimatedPages:clamp(settings.estimatedPages,1,10000,1),priority,pageSize,colorMode,duplex:Boolean(settings.duplex),secureRelease:Boolean(settings.secureRelease),projectId:settings.projectId?String(settings.projectId):null,departmentType:settings.departmentId?(String(settings.departmentType)==='school'?'school':'finance'):null,departmentId:settings.departmentId?String(settings.departmentId):null,...source};
  }

  async #prepareCost(tx,organizationId,options){
    if(options.projectId&&!((await tx.query(`SELECT 1 FROM projects WHERE id=$1 AND organization_id=$2 AND status='active'`,[options.projectId,organizationId])).rows[0]))throw new PrinterlyRuntimeError('INVALID_PROJECT','Selected project is not active in this organization');
    if(options.departmentId){const table=options.departmentType==='school'?'school_departments':'dimensions',extra=options.departmentType==='school'?`active=true`:`type='department' AND active=true`;if(!((await tx.query(`SELECT 1 FROM ${table} WHERE id=$1 AND organization_id=$2 AND ${extra}`,[options.departmentId,organizationId])).rows[0]))throw new PrinterlyRuntimeError('INVALID_DEPARTMENT','Selected department is invalid');}
    const profile=(await tx.query(`SELECT * FROM prn_cost_profiles WHERE organization_id=$1`,[organizationId])).rows[0]||{};
    const impressions=options.estimatedPages*options.copies,sheets=options.duplex?Math.ceil(impressions/2):impressions,paper=sheets*Number(profile.paper_cost_minor||0),toner=impressions*Number(options.colorMode==='color'?profile.color_toner_cost_minor||0:profile.bw_toner_cost_minor||0),maintenance=impressions*Number(profile.maintenance_cost_minor||0),electricity=impressions*Number(profile.electricity_cost_minor||0);
    return{projectId:options.projectId,departmentType:options.departmentType,departmentId:options.departmentId,estimatedPages:options.estimatedPages,estimatedImpressions:impressions,estimatedSheets:sheets,estimatedCostMinor:paper+toner+maintenance+electricity};
  }

  async #evaluatePolicy(tx,organizationId,principal,options,prepared){
    const rules=(await tx.query(`SELECT id,name,priority,match_json,action_json FROM prn_print_rules WHERE organization_id=$1 AND active=true ORDER BY priority,created_at`,[organizationId])).rows,effective={...options},applied=[],roles=new Set(),users=new Set(),ruleIds=[];let blocked=false,blockedReason='',requiresApproval=false,allowSelfApproval=true,routeChosen=false,priorityChosen=false;
    for(const row of rules){const match=json(row.match_json,{}),action=normalizeAction(json(row.action_json,{}));if(!policyApplies(match,principal,options,prepared))continue;applied.push({id:row.id,name:row.name});if(action.block&&!blocked){blocked=true;blockedReason=action.blockMessage;}if(action.requireApproval){requiresApproval=true;ruleIds.push(row.id);action.approverRoles.forEach(v=>roles.add(v));action.approverUserIds.forEach(v=>users.add(v));if(!action.allowSelfApproval)allowSelfApproval=false;}if(action.forceDuplex)effective.duplex=true;if(action.forceMonochrome)effective.colorMode='monochrome';if(action.forceSecureRelease)effective.secureRelease=true;if(action.printerId&&!routeChosen){effective.printerId=action.printerId;routeChosen=true;}if(action.priority&&!priorityChosen){effective.priority=action.priority;priorityChosen=true;}}
    if(requiresApproval&&!roles.size&&!users.size){roles.add('owner');roles.add('admin');}
    return{blocked,blockedReason,requiresApproval,effective,applied,ruleIds,approverRoles:[...roles],approverUserIds:[...users],allowSelfApproval};
  }

  async #reserveQuotas(tx,{organizationId,userId,jobId,request,projectId,departmentType,departmentId,periodKey}){
    const clauses=[`scope_type='organization'`],values=[organizationId];let p=2;clauses.push(`(scope_type='user' AND scope_id=$${p++})`);values.push(userId);if(projectId){clauses.push(`(scope_type='project' AND scope_id=$${p++})`);values.push(projectId);}if(departmentType==='finance'&&departmentId){clauses.push(`(scope_type='finance_department' AND scope_id=$${p++})`);values.push(departmentId);}if(departmentType==='school'&&departmentId){clauses.push(`(scope_type='school_department' AND scope_id=$${p++})`);values.push(departmentId);}
    const quotas=(await tx.query(`SELECT * FROM prn_quotas WHERE organization_id=$1 AND active=true AND (${clauses.join(' OR ')}) ORDER BY CASE mode WHEN 'hard' THEN 0 ELSE 1 END,id`,values)).rows;
    for(const quota of quotas){await tx.query(`INSERT INTO prn_quota_periods(quota_id,organization_id,period_key) VALUES($1,$2,$3) ON CONFLICT(quota_id,period_key) DO NOTHING`,[quota.id,organizationId,periodKey]);const period=(await tx.query(`SELECT * FROM prn_quota_periods WHERE quota_id=$1 AND period_key=$2 AND organization_id=$3 FOR UPDATE`,[quota.id,periodKey,organizationId])).rows[0];const exceeded=[[quota.max_impressions,period.consumed_impressions,period.reserved_impressions,request.impressions],[quota.max_sheets,period.consumed_sheets,period.reserved_sheets,request.sheets],[quota.max_cost_minor,period.consumed_cost_minor,period.reserved_cost_minor,request.costMinor]].some(([limit,used,reserved,needed])=>BigInt(limit||0)>0n&&BigInt(used||0)+BigInt(reserved||0)+BigInt(needed||0)>BigInt(limit));if(quota.mode==='hard'&&exceeded)throw new PrinterlyRuntimeError('PRINTERLY_QUOTA_EXCEEDED',`${quota.name} would exceed its monthly Printerly limit`,{quotaId:quota.id,periodKey});await tx.query(`UPDATE prn_quota_periods SET reserved_impressions=reserved_impressions+$1,reserved_sheets=reserved_sheets+$2,reserved_cost_minor=reserved_cost_minor+$3,updated_at=now() WHERE quota_id=$4 AND period_key=$5`,[request.impressions,request.sheets,request.costMinor,quota.id,periodKey]);await tx.query(`INSERT INTO prn_quota_reservations(id,group_id,organization_id,quota_id,period_key,job_id,reserved_impressions,reserved_sheets,reserved_cost_minor,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'reserved')`,[makeId('prnqres'),`job:${jobId}`,organizationId,quota.id,periodKey,jobId,request.impressions,request.sheets,request.costMinor]);}
  }
}
