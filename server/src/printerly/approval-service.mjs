import {randomUUID} from 'node:crypto';
import {PrinterlyRuntimeError} from './runtime-service.mjs';

const id=p=>`${p}_${randomUUID().replaceAll('-','')}`;
const json=(v,f)=>{try{return v?JSON.parse(String(v)):f}catch{return f}};

export class PrinterlyApprovalService{
  constructor({database}){if(!database?.query||!database?.transaction)throw new TypeError('database is required');this.database=database;}

  async list(organizationId,principal,status=null){
    const values=[organizationId],clauses=['a.organization_id=$1'];
    if(status&&['pending','approved','rejected','cancelled'].includes(status)){values.push(status);clauses.push(`a.status=$${values.length}`);}
    const rows=(await this.database.query(`SELECT a.id,a.job_id "jobId",a.status,a.rule_ids_json "ruleIdsJson",a.requested_by "requestedBy",a.requested_at "requestedAt",a.approver_roles_json "approverRolesJson",a.approver_user_ids_json "approverUserIdsJson",a.allow_self_approval "allowSelfApproval",a.decided_by "decidedBy",a.decided_at "decidedAt",a.decision_note "decisionNote",j.job_number "jobNumber",j.title,j.priority,j.copies,j.page_size "pageSize",j.color_mode "colorMode",j.duplex,j.secure_release "secureRelease",j.estimated_impressions "estimatedImpressions",j.estimated_cost_minor "estimatedCostMinor",u.display_name "requesterName",u.email "requesterEmail" FROM prn_approvals a JOIN prn_jobs j ON j.id=a.job_id AND j.organization_id=a.organization_id LEFT JOIN users u ON u.id=a.requested_by WHERE ${clauses.join(' AND ')} ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END,a.requested_at DESC LIMIT 200`,values)).rows;
    const all=principal.role==='owner'||principal.role==='admin'||principal.scopes?.includes('admin:read');
    return rows.map(row=>({...row,ruleIds:json(row.ruleIdsJson,[]),approverRoles:json(row.approverRolesJson,[]),approverUserIds:json(row.approverUserIdsJson,[]),allowSelfApproval:Boolean(row.allowSelfApproval),duplex:Boolean(row.duplex),secureRelease:Boolean(row.secureRelease)})).filter(row=>all||row.requestedBy===principal.userId||row.approverUserIds.includes(principal.userId)||row.approverRoles.includes(principal.role));
  }

  async decide({organizationId,principal,approvalId,decision,note=''}){
    if(!['approved','rejected'].includes(decision))throw new PrinterlyRuntimeError('INVALID_APPROVAL_DECISION','Approval decision must be approved or rejected');
    return this.database.transaction(async tx=>{
      const row=(await tx.query(`SELECT a.*,j.status AS job_status,j.secure_release,j.job_number,j.title FROM prn_approvals a JOIN prn_jobs j ON j.id=a.job_id AND j.organization_id=a.organization_id WHERE a.id=$1 AND a.organization_id=$2 FOR UPDATE OF a,j`,[approvalId,organizationId])).rows[0];
      if(!row)throw Object.assign(new PrinterlyRuntimeError('APPROVAL_NOT_FOUND','Printerly approval request not found'),{status:404});
      if(row.status!=='pending')throw new PrinterlyRuntimeError('APPROVAL_DECIDED','This Printerly approval has already been decided');
      if(row.job_status!=='approval_pending')throw new PrinterlyRuntimeError('JOB_NOT_PENDING_APPROVAL','This print job is no longer waiting for approval');
      const roles=json(row.approver_roles_json,[]),users=json(row.approver_user_ids_json,[]),can=principal.role==='owner'||principal.role==='admin'||roles.includes(principal.role)||users.includes(principal.userId);
      if(!can)throw Object.assign(new PrinterlyRuntimeError('APPROVER_REQUIRED','You are not an authorized approver for this print job'),{status:403});
      if(row.requested_by===principal.userId&&!Boolean(row.allow_self_approval))throw Object.assign(new PrinterlyRuntimeError('SELF_APPROVAL_FORBIDDEN','This policy does not allow the requester to approve their own print job'),{status:403});
      const next=decision==='approved'?(row.secure_release?'held':'queued'):'cancelled',message=decision==='rejected'?`Rejected: ${String(note||'No reason supplied').slice(0,500)}`:null,nonce=randomUUID();
      await tx.query(`UPDATE prn_approvals SET status=$1,decided_by=$2,decided_at=now(),decision_note=$3,decision_nonce=$4 WHERE id=$5 AND organization_id=$6 AND status='pending'`,[decision,principal.userId,String(note||'').slice(0,1000)||null,nonce,approvalId,organizationId]);
      const moved=await tx.query(`UPDATE prn_jobs SET status=$1,error_message=$2,updated_at=now() WHERE id=$3 AND organization_id=$4 AND status='approval_pending'`,[next,message,row.job_id,organizationId]);if(moved.rowCount!==1)throw new PrinterlyRuntimeError('JOB_NOT_PENDING_APPROVAL','The print job changed while the approval was being decided');
      if(decision==='rejected')await this.#releaseQuota(tx,organizationId,row.job_id);
      if(next==='queued')await tx.query(`INSERT INTO prn_dispatch_outbox(id,organization_id,job_id,event_type,status,available_at) VALUES($1,$2,$3,'dispatch','pending',now()) ON CONFLICT(organization_id,job_id,event_type) DO NOTHING`,[id('prnout'),organizationId,row.job_id]);
      await tx.query(`INSERT INTO prn_job_events(id,organization_id,job_id,event_type,actor_id,details_json) VALUES($1,$2,$3,$4,$5,$6)`,[id('prnev'),organizationId,row.job_id,decision==='approved'?'approval_approved':'approval_rejected',principal.userId,JSON.stringify({approvalId,note:String(note||'').slice(0,1000),nextStatus:next,decisionNonce:nonce})]);
      return{id:approvalId,jobId:row.job_id,jobNumber:row.job_number,status:decision,jobStatus:next,releaseQuota:decision==='rejected'};
    });
  }

  async #releaseQuota(tx,organizationId,jobId){const rows=(await tx.query(`SELECT * FROM prn_quota_reservations WHERE organization_id=$1 AND job_id=$2 AND status='reserved' FOR UPDATE`,[organizationId,jobId])).rows;for(const row of rows){await tx.query(`UPDATE prn_quota_periods SET reserved_impressions=GREATEST(0,reserved_impressions-$1),reserved_sheets=GREATEST(0,reserved_sheets-$2),reserved_cost_minor=GREATEST(0,reserved_cost_minor-$3),updated_at=now() WHERE quota_id=$4 AND period_key=$5`,[row.reserved_impressions,row.reserved_sheets,row.reserved_cost_minor,row.quota_id,row.period_key]);await tx.query(`UPDATE prn_quota_reservations SET status='released',updated_at=now() WHERE id=$1`,[row.id]);}}
}
