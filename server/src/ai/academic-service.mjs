import { randomUUID } from "node:crypto";

export class AiAcademicService{
  constructor({database,tasks,documents,audit}){this.database=database;this.tasks=tasks;this.documents=documents;this.audit=audit;}
  async createLessonPlanTask({context,agentId,instruction,academicContext={}}){
    return this.tasks.create({context,assignedAgent:agentId,instruction,priority:60,inputReferences:[{type:"academic_context",value:academicContext}],idempotencyKey:academicContext.lessonPlanId?`lesson-draft:${academicContext.lessonPlanId}`:null});
  }
  async createReviewTask({context,reviewerAgentId,documentId,instruction="Review this lesson plan for curriculum alignment, completeness, learner activities, assessment, resources, sequence and school standards."}){
    const document=(await this.database.query(`SELECT document_id,status,type FROM ledgerly_ai.documents WHERE document_id=$1 AND organization_id=$2`,[documentId,context.organizationId])).rows[0];
    if(!document)throw new Error("lesson-plan document not found");
    return this.tasks.create({context,assignedAgent:reviewerAgentId,instruction,priority:65,inputReferences:[{type:"document",id:documentId}],idempotencyKey:`academic-review:${documentId}:${document.status}`});
  }
  async recordReview({context,agent,taskId,documentId,recommendation,findings=[],sourceReferences=[]}){
    if(!["recommended_for_approval","changes_requested"].includes(recommendation))throw new Error("invalid academic review recommendation");
    const document=(await this.database.query(`SELECT document_id FROM ledgerly_ai.documents WHERE document_id=$1 AND organization_id=$2`,[documentId,context.organizationId])).rows[0];
    if(!document)throw new Error("lesson-plan document not found");
    const reviewId=randomUUID();
    const result=await this.database.query(`INSERT INTO ledgerly_ai.academic_reviews (review_id,organization_id,document_id,task_id,agent_id,review_label,recommendation,findings,source_references) VALUES ($1,$2,$3,$4,$5,'AI REVIEWED',$6,$7::jsonb,$8::jsonb) RETURNING *`,[reviewId,context.organizationId,documentId,taskId,agent.agentId,recommendation,JSON.stringify(findings),JSON.stringify(sourceReferences)]);
    if(recommendation==="changes_requested")await this.database.query(`UPDATE ledgerly_ai.documents SET status='changes_requested',updated_at=now() WHERE document_id=$1 AND organization_id=$2 AND status<>'approved'`,[documentId,context.organizationId]);
    else await this.database.query(`UPDATE ledgerly_ai.documents SET status='in_review',updated_at=now() WHERE document_id=$1 AND organization_id=$2 AND status<>'approved'`,[documentId,context.organizationId]);
    await this.audit?.write?.({organization_id:context.organizationId,actor_type:"ai_agent",actor_id:agent.agentId,agent_id:agent.agentId,agent_name:agent.name,agent_role:agent.role,action:"ai.academic.reviewed",entity_type:"document",entity_id:documentId,reason:recommendation,metadata:{task_id:taskId,review_id:reviewId,review_label:"AI REVIEWED",officially_approved:false,source_references:sourceReferences}});
    return {...result.rows[0],officially_approved:false};
  }
  async listReviews({context,documentId}){const result=await this.database.query(`SELECT * FROM ledgerly_ai.academic_reviews WHERE document_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,[documentId,context.organizationId]);return result.rows.map((row)=>({...row,officially_approved:false}));}
}
