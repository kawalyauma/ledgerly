import { randomUUID } from "node:crypto";

function mapAgent(row) {
  if (!row) return null;
  return {
    agentId:row.agent_id, organizationId:row.organization_id, name:row.name, avatar:row.avatar,
    role:row.role, department:row.department, description:row.description, systemInstructions:row.system_instructions,
    provider:row.provider, model:row.model, status:row.status, permissions:row.permissions??[], allowedTools:row.allowed_tools??[],
    autonomyLevel:Number(row.autonomy_level), knowledgeSources:row.knowledge_sources??[], workingSchedule:row.working_schedule??{}, approvalRules:row.approval_rules??{},
    templateKey:row.template_key, createdAt:row.created_at, updatedAt:row.updated_at,
  };
}

export class AiAgentService {
  constructor({ database, audit }) { this.database=database; this.audit=audit; }

  async list(context) {
    const result=await this.database.query(`SELECT * FROM ledgerly_ai.agents WHERE organization_id=$1 ORDER BY department,name`,[context.organizationId]);
    return result.rows.map(mapAgent);
  }

  async get(context, agentId) {
    const result=await this.database.query(`SELECT * FROM ledgerly_ai.agents WHERE agent_id=$1 AND organization_id=$2`,[agentId,context.organizationId]);
    return mapAgent(result.rows[0]);
  }

  async create(context, input) {
    const agentId=input.agentId??randomUUID();
    const result=await this.database.query(`INSERT INTO ledgerly_ai.agents
      (agent_id,organization_id,name,avatar,role,department,description,system_instructions,provider,model,status,permissions,allowed_tools,autonomy_level,knowledge_sources,working_schedule,approval_rules)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15::jsonb,$16::jsonb,$17::jsonb) RETURNING *`,[
      agentId,context.organizationId,input.name,input.avatar??null,input.role,input.department??null,input.description??null,input.systemInstructions??"",
      input.provider??"ollama",input.model??null,input.status??"active",JSON.stringify(input.permissions??[]),JSON.stringify(input.allowedTools??[]),Number(input.autonomyLevel??2),
      JSON.stringify(input.knowledgeSources??[]),JSON.stringify(input.workingSchedule??{}),JSON.stringify(input.approvalRules??{})]);
    await this.audit?.write?.({organization_id:context.organizationId,actor_type:"human",actor_id:context.userId,action:"ai.agent.created",entity_type:"ai_agent",entity_id:agentId,reason:input.reason??null,after:result.rows[0]});
    return mapAgent(result.rows[0]);
  }

  async update(context, agentId, input) {
    const current=await this.get(context,agentId);
    if (!current) throw new Error("AI agent not found");
    const next={...current,...input,agentId,organizationId:context.organizationId};
    const result=await this.database.query(`UPDATE ledgerly_ai.agents SET
      name=$1,avatar=$2,role=$3,department=$4,description=$5,system_instructions=$6,provider=$7,model=$8,status=$9,
      permissions=$10::jsonb,allowed_tools=$11::jsonb,autonomy_level=$12,knowledge_sources=$13::jsonb,working_schedule=$14::jsonb,approval_rules=$15::jsonb,updated_at=now()
      WHERE agent_id=$16 AND organization_id=$17 RETURNING *`,[
      next.name,next.avatar??null,next.role,next.department??null,next.description??null,next.systemInstructions??"",next.provider??"ollama",next.model??null,next.status??"active",
      JSON.stringify(next.permissions??[]),JSON.stringify(next.allowedTools??[]),Number(next.autonomyLevel??2),JSON.stringify(next.knowledgeSources??[]),JSON.stringify(next.workingSchedule??{}),JSON.stringify(next.approvalRules??{}),agentId,context.organizationId]);
    await this.audit?.write?.({organization_id:context.organizationId,actor_type:"human",actor_id:context.userId,action:"ai.agent.updated",entity_type:"ai_agent",entity_id:agentId,reason:input.reason??null,before:current,after:result.rows[0]});
    return mapAgent(result.rows[0]);
  }

  async disable(context,agentId,reason=null) { return this.update(context,agentId,{status:"disabled",reason}); }
}
