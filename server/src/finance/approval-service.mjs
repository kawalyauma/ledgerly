import {randomUUID} from 'node:crypto';
import {createPostCommitInvalidator} from '../cache/tenant-cache.mjs';

function error(status,code,message,details){const e=new Error(message);e.status=status;e.code=code;if(details!==undefined)e.details=details;return e;}
function text(value,name){const valueText=String(value??'').trim();if(!valueText)throw error(422,'VALIDATION_ERROR',`${name} is required`);return valueText;}
function minor(value,name,{positive=false}={}){let amount;try{amount=BigInt(value??0);}catch{throw error(422,'VALIDATION_ERROR',`${name} must be an integer`);}if(amount<0n||(positive&&amount<=0n))throw error(422,'VALIDATION_ERROR',`${name} is invalid`);return amount;}
function audited(services,p,requestId,action,type,id,after){return services.audit.write({organizationId:p.organizationId,actorType:'human',actorId:p.userId,action,entityType:type,entityId:id,after,requestId});}

export class FinanceApprovalService{
  constructor({services}){if(!services?.database?.transaction)throw new TypeError('services.database is required');this.services=services;this.db=services.database;}
  async invalidate(org,...domains){const invalidator=createPostCommitInvalidator({cache:this.services.cache,organizationId:org});invalidator.mark(...domains);await invalidator.committed();}

  async createPolicy({principal:p,body={},requestId}){
    const documentType=text(body.documentType,'documentType');
    if(!['invoice','bill','expense'].includes(documentType))throw error(422,'VALIDATION_ERROR','documentType must be invoice, bill or expense');
    const minimum=minor(body.minimumMinor??0,'minimumMinor');
    const maximum=body.maximumMinor==null?null:minor(body.maximumMinor,'maximumMinor',{positive:true});
    if(maximum!=null&&maximum<minimum)throw error(422,'VALIDATION_ERROR','maximumMinor must be greater than or equal to minimumMinor');
    const levels=Number(body.levels);if(!Number.isInteger(levels)||levels<1||levels>10)throw error(422,'VALIDATION_ERROR','levels must be an integer from 1 to 10');
    const roles=Array.isArray(body.approverRoles)?body.approverRoles.map(v=>String(v).trim()).filter(Boolean):[];if(!roles.length)throw error(422,'VALIDATION_ERROR','approverRoles must contain at least one role');
    const id=body.id??randomUUID();
    await this.db.query(`INSERT INTO approval_policies(id,organization_id,document_type,minimum_minor,maximum_minor,levels,approver_roles,active,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,true,now(),now())`,[id,p.organizationId,documentType,minimum.toString(),maximum?.toString()??null,levels,JSON.stringify(roles)]);
    const result={id,documentType,minimumMinor:Number(minimum),...(maximum==null?{}:{maximumMinor:Number(maximum)}),levels,approverRoles:roles};
    await this.invalidate(p.organizationId,'reference-counts');await audited(this.services,p,requestId,'finance.approval-policy.create','approval-policy',id,result);return result;
  }

  async submitDocument({principal:p,documentId,requestId}){
    const org=p.organizationId,id=text(documentId,'documentId');
    const result=await this.db.transaction(async tx=>{
      const document=(await tx.query(`SELECT id,type,total_minor,status,approval_status FROM documents WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[id,org])).rows[0];
      if(!document)throw error(404,'DOCUMENT_NOT_FOUND','Document not found');
      if(document.approval_status==='pending'){
        const existing=(await tx.query(`SELECT id FROM document_approval_requests WHERE organization_id=$1 AND entity_type='document' AND entity_id=$2 AND status='pending' ORDER BY submitted_at DESC LIMIT 1 FOR UPDATE`,[org,id])).rows[0];
        if(existing)return{id:existing.id,status:'pending',alreadySubmitted:true};
      }
      if(document.status!=='draft')throw error(409,'INVALID_STATE','Draft document required');
      const policy=(await tx.query(`SELECT id FROM approval_policies WHERE organization_id=$1 AND document_type=$2 AND active=true AND minimum_minor<=$3 AND (maximum_minor IS NULL OR maximum_minor>=$3) ORDER BY levels DESC,id LIMIT 1 FOR UPDATE`,[org,document.type,document.total_minor])).rows[0];
      if(!policy)throw error(409,'NO_APPROVAL_POLICY','No applicable approval policy');
      const requestIdValue=randomUUID();
      await tx.query(`INSERT INTO document_approval_requests(id,organization_id,entity_type,entity_id,policy_id,status,current_level,submitted_by,submitted_at,created_at,updated_at) VALUES($1,$2,'document',$3,$4,'pending',1,$5,now(),now(),now())`,[requestIdValue,org,id,policy.id,p.userId]);
      const changed=await tx.query(`UPDATE documents SET approval_status='pending',updated_at=now() WHERE id=$1 AND organization_id=$2 AND status='draft' RETURNING id`,[id,org]);
      if(changed.rowCount!==1)throw error(409,'CONCURRENT_DOCUMENT_CHANGE','Document changed while submitting for approval');
      return{id:requestIdValue,status:'pending'};
    });
    await this.invalidate(org,'dashboard-summary','reference-counts');await audited(this.services,p,requestId,'finance.document.submit-approval','document',id,result);return result;
  }

  async decide({principal:p,approvalId,decision,body={},requestId}){
    const org=p.organizationId,id=text(approvalId,'approvalId'),choice=text(decision,'decision');
    if(!['approve','reject','revise'].includes(choice))throw error(404,'NOT_FOUND','Unknown decision');
    const comments=body.comments==null?null:String(body.comments);if(comments&&comments.length>1000)throw error(422,'VALIDATION_ERROR','comments must not exceed 1000 characters');
    const status=choice==='approve'?'approved':choice==='reject'?'rejected':'revision_required';
    const result=await this.db.transaction(async tx=>{
      const request=(await tx.query(`SELECT r.id,r.status,d.id AS document_id FROM document_approval_requests r JOIN documents d ON d.id=r.entity_id AND d.organization_id=r.organization_id WHERE r.id=$1 AND r.organization_id=$2 AND r.entity_type='document' FOR UPDATE OF r,d`,[id,org])).rows[0];
      if(!request)throw error(404,'NOT_FOUND','Approval request not found');
      if(request.status!=='pending')throw error(409,'INVALID_STATE','Pending approval not found');
      const updated=await tx.query(`UPDATE document_approval_requests SET status=$3,decided_by=$4,decided_at=now(),comments=$5,updated_at=now() WHERE id=$1 AND organization_id=$2 AND status='pending' RETURNING id`,[id,org,status,p.userId,comments]);
      if(updated.rowCount!==1)throw error(409,'CONCURRENT_APPROVAL_CHANGE','Approval changed while deciding');
      const document=await tx.query(`UPDATE documents SET approval_status=$3,updated_at=now() WHERE id=$1 AND organization_id=$2 RETURNING id`,[request.document_id,org,status]);
      if(document.rowCount!==1)throw error(409,'CONCURRENT_DOCUMENT_CHANGE','Document changed while deciding approval');
      return{id,status};
    });
    await this.invalidate(org,'dashboard-summary','reference-counts');await audited(this.services,p,requestId,`finance.approval.${choice}`,'document-approval',id,result);return result;
  }
}
