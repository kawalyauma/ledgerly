import { randomUUID } from "node:crypto";
import { DOCUMENT_STATUSES } from "./constants.mjs";
import { aiAttribution, humanEditProvenance, createFieldProvenance, updateFieldProvenance } from "./provenance.mjs";

const EDITABLE_STATUSES = new Set(["draft", "in_review", "changes_requested"]);
const OFFICIAL_STATUSES = new Set(["approved", "published"]);
const STATUS_TRANSITIONS = Object.freeze({
  draft: new Set(["in_review", "archived"]),
  in_review: new Set(["changes_requested", "approved", "archived"]),
  changes_requested: new Set(["draft", "in_review", "archived"]),
  approved: new Set(["changes_requested", "published", "archived"]),
  published: new Set(["archived"]),
  archived: new Set(),
});

const org=(context)=>{if(!context?.organizationId)throw new Error("organization context required");return context.organizationId;};
const stamp=()=>new Date().toISOString();
const canApprove=(context)=>{const permissions=Array.isArray(context?.permissions)?context.permissions:[];return permissions.includes("*")||permissions.includes("ai:approve");};

function parsePermissions(value){if(Array.isArray(value))return value;if(typeof value==="string")try{const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed:[];}catch{return[];}return[];}
function classification(requiredPermissions=[]){return [...new Set(["documents:read",...parsePermissions(requiredPermissions)].filter((item)=>typeof item==="string"&&item.trim()).map((item)=>item.trim()))].sort();}
function assertDocumentAccess(context,requiredPermissions){const required=classification(requiredPermissions),granted=new Set(context?.permissions??[]);if(granted.has("*"))return required;const missing=required.filter((permission)=>!granted.has(permission));if(missing.length){const error=new Error("Structured AI document is outside current delegated authority");error.status=403;error.code="AI_DOCUMENT_ACCESS_DENIED";error.details={missingPermissions:missing};throw error;}return required;}

function transitionError(from,status){
  const error=new Error(`document status transition ${from} -> ${status} is not allowed`);
  error.status=409;
  error.code="AI_DOCUMENT_INVALID_STATUS_TRANSITION";
  return error;
}
function editableError(status){const error=new Error(`document in ${status} state must be reopened before editing`);error.status=409;error.code="AI_DOCUMENT_NOT_EDITABLE";return error;}
function approvalAuthorityError(from,status){const error=new Error(`document status transition ${from} -> ${status} requires official approval authority`);error.status=403;error.code="AI_DOCUMENT_APPROVAL_REQUIRED";return error;}

export class AiDocumentEngine{
  constructor({database,audit,renderer=null}){this.database=database;this.audit=audit;this.renderer=renderer;}

  async createAiDraft({context,agent,taskId=null,type,title,content,reason,requiredPermissions=[]}){
    const organizationId=org(context),permissions=assertDocumentAccess(context,requiredPermissions),documentId=randomUUID(),attribution=aiAttribution({agent,taskId,reason});
    const provenance={document:attribution,fields:createFieldProvenance(content,attribution)};
    const result=await this.database.query(`INSERT INTO ledgerly_ai.documents (document_id,organization_id,type,title,content,creator,ai_provenance,required_permissions) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb) RETURNING *`,[documentId,organizationId,type,title,JSON.stringify(content),JSON.stringify(attribution),JSON.stringify(provenance),JSON.stringify(permissions)]);
    await this.database.query(`INSERT INTO ledgerly_ai.document_versions (document_id,version,organization_id,content,provenance,edited_by) VALUES ($1,1,$2,$3::jsonb,$4::jsonb,$5::jsonb)`,[documentId,organizationId,JSON.stringify(content),JSON.stringify(provenance),JSON.stringify(attribution)]);
    await this.audit?.write?.({organization_id:organizationId,actor_type:"ai_agent",actor_id:agent.agentId,agent_id:agent.agentId,agent_name:agent.name,agent_role:agent.role,action:"ai.document.created",entity_type:"document",entity_id:documentId,reason,after:content,metadata:{task_id:taskId,type,title,field_provenance:true,status:"draft",required_permissions:permissions}});
    return result.rows[0];
  }

  async reviseAi({context,agent,taskId=null,documentId,content,reason=null}){
    const organizationId=org(context);
    return this.database.transaction(async(tx)=>{
      const current=(await tx.query(`SELECT * FROM ledgerly_ai.documents WHERE document_id=$1 AND organization_id=$2 FOR UPDATE`,[documentId,organizationId])).rows[0];
      if(!current)throw new Error("document not found");
      assertDocumentAccess(context,current.required_permissions);
      if(!EDITABLE_STATUSES.has(current.status))throw editableError(current.status);
      const attribution=aiAttribution({agent,taskId,reason}),version=Number(current.version)+1;
      const provenance={document:current.ai_provenance?.document??current.ai_provenance??attribution,fields:updateFieldProvenance({before:current.content,after:content,existing:current.ai_provenance?.fields??{},actor:attribution})};
      await tx.query(`UPDATE ledgerly_ai.documents SET content=$1::jsonb,version=$2,ai_provenance=$3::jsonb,rendered_pdf_ref=NULL,updated_at=now() WHERE document_id=$4 AND organization_id=$5`,[JSON.stringify(content),version,JSON.stringify(provenance),documentId,organizationId]);
      await tx.query(`INSERT INTO ledgerly_ai.document_versions (document_id,version,organization_id,content,provenance,edited_by) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb)`,[documentId,version,organizationId,JSON.stringify(content),JSON.stringify(provenance),JSON.stringify(attribution)]);
      await this.audit?.write?.({organization_id:organizationId,actor_type:"ai_agent",actor_id:agent.agentId,agent_id:agent.agentId,agent_name:agent.name,agent_role:agent.role,action:"ai.document.revised",entity_type:"document",entity_id:documentId,reason,before:current.content,after:content,metadata:{task_id:taskId,version,status:current.status}});
      return {...current,content,version,ai_provenance:provenance,rendered_pdf_ref:null};
    });
  }

  async reviseHuman({context,documentId,content,reason=null}){
    const organizationId=org(context);
    return this.database.transaction(async(tx)=>{
      const current=(await tx.query(`SELECT * FROM ledgerly_ai.documents WHERE document_id=$1 AND organization_id=$2 FOR UPDATE`,[documentId,organizationId])).rows[0];
      if(!current)throw new Error("document not found");
      assertDocumentAccess(context,current.required_permissions);
      if(!EDITABLE_STATUSES.has(current.status))throw editableError(current.status);
      const version=Number(current.version)+1,actor={actor_type:"human",actor_id:context.userId,actor_name:context.userName??context.userId,timestamp:stamp(),reason};
      const provenance={document:humanEditProvenance(current.ai_provenance??{},{userId:context.userId,userName:context.userName??context.userId,reason}),fields:updateFieldProvenance({before:current.content,after:content,existing:current.ai_provenance?.fields??{},actor})};
      await tx.query(`UPDATE ledgerly_ai.documents SET content=$1::jsonb,version=$2,ai_provenance=$3::jsonb,human_editors=human_editors || $4::jsonb,rendered_pdf_ref=NULL,updated_at=now() WHERE document_id=$5 AND organization_id=$6`,[JSON.stringify(content),version,JSON.stringify(provenance),JSON.stringify([{user_id:context.userId,user_name:context.userName??context.userId,timestamp:actor.timestamp}]),documentId,organizationId]);
      await tx.query(`INSERT INTO ledgerly_ai.document_versions (document_id,version,organization_id,content,provenance,edited_by) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb)`,[documentId,version,organizationId,JSON.stringify(content),JSON.stringify(provenance),JSON.stringify(actor)]);
      await this.audit?.write?.({organization_id:organizationId,actor_type:"human",actor_id:context.userId,action:"document.edited",entity_type:"document",entity_id:documentId,reason,before:current.content,after:content,metadata:{version,status:current.status,original_ai:current.ai_provenance?.document??current.ai_provenance??null}});
      return {...current,content,version,ai_provenance:provenance,rendered_pdf_ref:null};
    });
  }

  async setStatus({context,documentId,status,reason=null}){
    if(!DOCUMENT_STATUSES.includes(status))throw new Error(`invalid document status ${status}`);
    const organizationId=org(context);
    return this.database.transaction(async(tx)=>{
      const current=(await tx.query(`SELECT * FROM ledgerly_ai.documents WHERE document_id=$1 AND organization_id=$2 FOR UPDATE`,[documentId,organizationId])).rows[0];
      if(!current)throw new Error("document not found");
      assertDocumentAccess(context,current.required_permissions);
      if(current.status===status)return current;
      if(!STATUS_TRANSITIONS[current.status]?.has(status))throw transitionError(current.status,status);
      const approvalAuthority=canApprove(context);
      if((OFFICIAL_STATUSES.has(current.status)||OFFICIAL_STATUSES.has(status))&&!approvalAuthority)throw approvalAuthorityError(current.status,status);
      const decidedAt=stamp();
      const approvalEntry=status==="approved"?{status:"approved",approved_by:context.userId,approved_by_name:context.userName??context.userId,approved_at:decidedAt,reason,version:Number(current.version)}:null;
      const result=await tx.query(`UPDATE ledgerly_ai.documents SET status=$1,approvals=CASE WHEN $2::jsonb IS NULL THEN approvals ELSE approvals || jsonb_build_array($2::jsonb) END,rendered_pdf_ref=CASE WHEN $1='changes_requested' THEN NULL ELSE rendered_pdf_ref END,updated_at=now() WHERE document_id=$3 AND organization_id=$4 RETURNING *`,[status,approvalEntry?JSON.stringify(approvalEntry):null,documentId,organizationId]);
      await this.audit?.write?.({organization_id:organizationId,actor_type:"human",actor_id:context.userId,action:`document.${status}`,entity_type:"document",entity_id:documentId,reason,metadata:{from_status:current.status,to_status:status,version:current.version,official_approval:approvalAuthority}});
      return result.rows[0];
    });
  }

  async renderPdf({context,documentId}){
    const organizationId=org(context);
    if(!this.renderer){const error=new Error("Document PDF renderer is not configured");error.status=503;throw error;}
    const document=(await this.database.query(`SELECT * FROM ledgerly_ai.documents WHERE document_id=$1 AND organization_id=$2`,[documentId,organizationId])).rows[0];
    if(!document)throw new Error("document not found");
    assertDocumentAccess(context,document.required_permissions);
    if(!OFFICIAL_STATUSES.has(document.status)){const error=new Error("Only approved or published structured documents may be rendered to PDF");error.status=409;throw error;}
    const rendered=await this.renderer({document,context});const ref=rendered?.ref??rendered?.storageRef??rendered;
    if(!ref)throw new Error("PDF renderer returned no storage reference");
    const result=await this.database.query(`UPDATE ledgerly_ai.documents SET rendered_pdf_ref=$1,updated_at=now() WHERE document_id=$2 AND organization_id=$3 AND version=$4 AND status=$5 RETURNING *`,[String(ref),documentId,organizationId,document.version,document.status]);
    if(!result.rowCount){const error=new Error("document changed while PDF was rendering");error.status=409;error.code="AI_DOCUMENT_RENDER_STALE";throw error;}
    await this.audit?.write?.({organization_id:organizationId,actor_type:"human",actor_id:context.userId,action:"document.pdf_rendered",entity_type:"document",entity_id:documentId,metadata:{pdf_ref:String(ref),version:document.version,status:document.status}});
    return result.rows[0];
  }
}
