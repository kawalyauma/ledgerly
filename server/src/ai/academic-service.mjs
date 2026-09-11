import { randomUUID } from "node:crypto";

const reviewable=(document)=>document?.type==="lesson_plan"&&["draft","in_review","changes_requested"].includes(document.status);

export class AiAcademicService{
  constructor({database,tasks,documents,audit}){this.database=database;this.tasks=tasks;this.documents=documents;this.audit=audit;}
  async requestDraft(input){return this.createLessonPlanTask(input);}
  async requestReview(input){return this.createReviewTask(input);}
  async createLessonPlanTask({context,agentId,instruction,academicContext={}}){
    if(!agentId)throw new Error("academic draft requires an AI employee");
    if(!instruction)throw new Error("academic draft instruction is required");
    return this.tasks.create({context,assignedAgent:agentId,instruction,priority:60,inputReferences:[{type:"academic_context",value:academicContext}],idempotencyKey:academicContext.lessonPlanId?`lesson-draft:${academicContext.lessonPlanId}`:null});
  }
  async createReviewTask({context,reviewerAgentId,documentId,instruction="Review this lesson plan for curriculum alignment, completeness, learner activities, assessment, resources, sequence and school standards."}){
    if(!reviewerAgentId)throw new Error("academic review requires a reviewer AI employee");
    const document=(await this.database.query(`SELECT document_id,status,type FROM ledgerly_ai.documents WHERE document_id=$1 AND organization_id=$2`,[documentId,context.organizationId])).rows[0];
    if(!document)throw new Error("lesson-plan document not found");
    if(document.type!=="lesson_plan"){const error=new Error("academic AI review only supports lesson-plan documents");error.status=409;throw error;}
    if(!reviewable(document)){const error=new Error(`lesson-plan document is not reviewable while ${document.status}`);error.status=409;throw error;}
    return this.tasks.create({context,assignedAgent:reviewerAgentId,instruction,priority:65,inputReferences:[{type:"document",id:documentId}],idempotencyKey:`academic-review:${documentId}:${document.status}`});
  }
  async recordReview({context,agent,taskId,documentId,recommendation,findings=[],sourceReferences=[]}){
    if(!["recommended_for_approval","changes_requested"].includes(recommendation))throw new Error("invalid academic review recommendation");
    const document=(await this.database.query(`SELECT document_id,status,type FROM ledgerly_ai.documents WHERE document_id=$1 AND organization_id=$2`,[documentId,context.organizationId])).rows[0];
    if(!document)throw new Error("lesson-plan document not found");
    if(!reviewable(document)){const error=new Error("lesson-plan document is no longer eligible for AI review");error.status=409;throw error;}
    const reviewId=randomUUID();
    const result=await this.database.query(`INSERT INTO ledgerly_ai.academic_reviews (review_id,organization_id,document_id,task_id,agent_id,review_label,recommendation,findings,source_references) VALUES ($1,$2,$3,$4,$5,'AI REVIEWED',$6,$7::jsonb,$8::jsonb) RETURNING *`,[reviewId,context.organizationId,documentId,taskId,agent.agentId,recommendation,JSON.stringify(findings),JSON.stringify(sourceReferences)]);
    const nextStatus=recommendation==="changes_requested"?"changes_requested":"in_review";
    await this.database.query(`UPDATE ledgerly_ai.documents SET status=$1,updated_at=now() WHERE document_id=$2 AND organization_id=$3 AND status IN ('draft','in_review','changes_requested')`,[nextStatus,documentId,context.organizationId]);
    await this.audit?.write?.({organization_id:context.organizationId,actor_type:"ai_agent",actor_id:agent.agentId,agent_id:agent.agentId,agent_name:agent.name,agent_role:agent.role,action:"ai.academic.reviewed",entity_type:"document",entity_id:documentId,reason:recommendation,metadata:{task_id:taskId,review_id:reviewId,review_label:"AI REVIEWED",officially_approved:false,source_references:sourceReferences}});
    return {...result.rows[0],officially_approved:false};
  }
  async listReviews({context,documentId}){const result=await this.database.query(`SELECT * FROM ledgerly_ai.academic_reviews WHERE document_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,[documentId,context.organizationId]);return result.rows.map((row)=>({...row,officially_approved:false}));}
}
