import { randomUUID } from "node:crypto";
import { DOCUMENT_STATUSES } from "./constants.mjs";
import { aiAttribution, humanEditProvenance, createFieldProvenance, updateFieldProvenance } from "./provenance.mjs";

const org=(context)=>{if(!context?.organizationId)throw new Error("organization context required");return context.organizationId;};
const stamp=()=>new Date().toISOString();
const transitions=Object.freeze({draft:new Set(["in_review","archived"]),in_review:new Set(["changes_requested","approved","archived"]),changes_requested:new Set(["draft","in_review","archived"]),approved:new Set(["published","archived"]),published:new Set(["archived"]),archived:new Set()});
const editable=(status)=>["draft","in_review","changes_requested"].includes(status);
const hasPermission=(context,permission)=>{const permissions=context?.permissions??[];return permissions.includes("*")||permissions.includes(permission);};

export class AiDocumentEngine{
  constructor({database,audit,renderer=null}){this.database=database;this.audit=audit;this.renderer=renderer;}
  async createAiDraft({context,agent,taskId=null,type,title,content,reason}){
    const organizationId=org(context),documentId=randomUUID(),attribution=aiAttribution({agent,taskId,reason});
    const provenance={document:attribution,fields:createFieldProvenance(content,attribution)};
    const result=await this.database.query(`INSERT INTO ledgerly_ai.documents (document_id,organization_id,type,title,content,creator,ai_provenance) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb) RETURNING *`,[documentId,organizationId,type,title,JSON.stringify(content),JSON.stringify(attribution),JSON.stringify(provenance)]);
    await this.database.query(`INSERT INTO ledgerly_ai.document_versions (document_id,version,organization_id,content,provenance,edited_by) VALUES ($1,1,$2,$3::jsonb,$4::jsonb,$5::jsonb)`,[documentId,organizationId,JSON.stringify(content),JSON.stringify(provenance),JSON.stringify(attribution)]);
    await this.audit?.write?.({organization_id:organizationId,actor_type:"ai_agent",actor_id:agent.agentId,agent_id:agent.agentId,agent_name:agent.name,agent_role:agent.role,action:"ai.document.created",entity_type:"document",entity_id:documentId,reason,after:content,metadata:{task_id:taskId,type,title,field_provenance:true}});
    return result.rows[0];
  }
  async reviseAi({context,agent,taskId=null,documentId,content,reason=null}){
    const organizationId=org(context);
    return this.database.transaction(async(tx)=>{
      const current=(await tx.query(`SELECT * FROM ledgerly_ai.documents WHERE document_id=$1 AND organization_id=$2 FOR UPDATE`,[documentId,organizationId])).rows[0];
      if(!current)throw new Error("document not found");if(!editable(current.status))throw new Error("AI may only revise draft or review-state documents");
      const attribution=aiAttribution({agent,taskId,reason}),version=Number(current.version)+1;
      const provenance={document:current.ai_provenance?.document??current.ai_provenance??attribution,fields:updateFieldProvenance({before:current.content,after:content,existing:current.ai_provenance?.fields??{},actor:attribution})};
      await tx.query(`UPDATE ledgerly_ai.documents SET content=$1::jsonb,version=$2,ai_provenance=$3::jsonb,rendered_pdf_ref=NULL,updated_at=now() WHERE document_id=$4 AND organization_id=$5`,[JSON.stringify(content),version,JSON.stringify(provenance),documentId,organizationId]);
      await tx.query(`INSERT INTO ledgerly_ai.document_versions (document_id,version,organization_id,content,provenance,edited_by) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb)`,[documentId,version,organizationId,JSON.stringify(content),JSON.stringify(provenance),JSON.stringify(attribution)]);
      await this.audit?.write?.({organization_id:organizationId,actor_type:"ai_agent",actor_id:agent.agentId,agent_id:agent.agentId,agent_name:agent.name,agent_role:agent.role,action:"ai.document.revised",entity_type:"document",entity_id:documentId,reason,before:current.content,after:content,metadata:{task_id:taskId,version}});
      return {...current,content,version,ai_provenance:provenance,rendered_pdf_ref:null};
    });
  }
  async reviseHuman({context,documentId,content,reason=null}){
    const organizationId=org(context);
    return this.database.transaction(async(tx)=>{
      const current=(await tx.query(`SELECT * FROM ledgerly_ai.documents WHERE document_id=$1 AND organization_id=$2 FOR UPDATE`,[documentId,organizationId])).rows[0];if(!current)throw new Error("document not found");
      if(!editable(current.status)){const error=new Error("Approved, published or archived documents are immutable; create a new draft/version workflow instead");error.status=409;throw error;}
      const version=Number(current.version)+1,actor={actor_type:"human",actor_id:context.userId,actor_name:context.userName??context.userId,timestamp:stamp(),reason};
      const provenance={document:humanEditProvenance(current.ai_provenance??{},{userId:context.userId,userName:context.userName??context.userId,reason}),fields:updateFieldProvenance({before:current.content,after:content,existing:current.ai_provenance?.fields??{},actor})};
      await tx.query(`UPDATE ledgerly_ai.documents SET content=$1::jsonb,version=$2,ai_provenance=$3::jsonb,human_editors=human_editors || $4::jsonb,rendered_pdf_ref=NULL,updated_at=now() WHERE document_id=$5 AND organization_id=$6`,[JSON.stringify(content),version,JSON.stringify(provenance),JSON.stringify([{user_id:context.userId,user_name:context.userName??context.userId,timestamp:actor.timestamp}]),documentId,organizationId]);
      await tx.query(`INSERT INTO ledgerly_ai.document_versions (document_id,version,organization_id,content,provenance,edited_by) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb)`,[documentId,version,organizationId,JSON.stringify(content),JSON.stringify(provenance),JSON.stringify(actor)]);
      await this.audit?.write?.({organization_id:organizationId,actor_type:"human",actor_id:context.userId,action:"document.edited",entity_type:"document",entity_id:documentId,reason,before:current.content,after:content,metadata:{version,original_ai:current.ai_provenance?.document??current.ai_provenance??null}});
      return {...current,content,version,ai_provenance:provenance,rendered_pdf_ref:null};
    });
  }
  async setStatus({context,documentId,status,reason=null}){
    if(!DOCUMENT_STATUSES.includes(status))throw new Error(`invalid document status ${status}`);const organizationId=org(context);
    if(["approved","published"].includes(status)&&!hasPermission(context,"ai:approve")){const error=new Error(`Missing permission: ai:approve`);error.code="AI_PERMISSION_DENIED";error.status=403;throw error;}
    return this.database.transaction(async(tx)=>{
      const current=(await tx.query(`SELECT * FROM ledgerly_ai.documents WHERE document_id=$1 AND organization_id=$2 FOR UPDATE`,[documentId,organizationId])).rows[0];if(!current)throw new Error("document not found");
      if(current.status===status)return current;
      if(!transitions[current.status]?.has(status)){const error=new Error(`invalid document transition ${current.status} -> ${status}`);error.status=409;throw error;}
      const result=await tx.query(`UPDATE ledgerly_ai.documents SET status=$1,updated_at=now() WHERE document_id=$2 AND organization_id=$3 RETURNING *`,[status,documentId,organizationId]);
      await this.audit?.write?.({organization_id:organizationId,actor_type:"human",actor_id:context.userId,action:`document.${status}`,entity_type:"document",entity_id:documentId,reason,metadata:{from_status:current.status,to_status:status}});return result.rows[0];
    });
  }
  async renderPdf({context,documentId}){const organizationId=org(context);if(!this.renderer){const error=new Error("Document PDF renderer is not configured");error.status=503;throw error;}const document=(await this.database.query(`SELECT * FROM ledgerly_ai.documents WHERE document_id=$1 AND organization_id=$2`,[documentId,organizationId])).rows[0];if(!document)throw new Error("document not found");if(!["approved","published"].includes(document.status)){const error=new Error("Only approved or published structured documents may be rendered to PDF");error.status=409;throw error;}const rendered=await this.renderer({document,context});const ref=rendered?.ref??rendered?.storageRef??rendered;if(!ref)throw new Error("PDF renderer returned no storage reference");const result=await this.database.query(`UPDATE ledgerly_ai.documents SET rendered_pdf_ref=$1,updated_at=now() WHERE document_id=$2 AND organization_id=$3 RETURNING *`,[String(ref),documentId,organizationId]);await this.audit?.write?.({organization_id:organizationId,actor_type:"human",actor_id:context.userId,action:"document.pdf_rendered",entity_type:"document",entity_id:documentId,metadata:{pdf_ref:String(ref),version:document.version}});return result.rows[0];}
}
