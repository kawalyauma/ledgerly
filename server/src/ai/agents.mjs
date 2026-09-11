import { randomUUID } from "node:crypto";

const AGENT_STATUSES=new Set(["active","paused","disabled"]);
function invalid(message){const error=new Error(message);error.code="AI_AGENT_INVALID";error.status=422;return error;}
function requiredText(value,name,max=160){const text=String(value??"").trim();if(!text)throw invalid(`${name} is required`);if(text.length>max)throw invalid(`${name} exceeds ${max} characters`);return text;}
function optionalText(value,name,max){if(value==null||value==="")return null;const text=String(value).trim();if(text.length>max)throw invalid(`${name} exceeds ${max} characters`);return text||null;}
function stringList(value,name,maxItems=128){if(value==null)return [];if(!Array.isArray(value))throw invalid(`${name} must be an array`);if(value.length>maxItems)throw invalid(`${name} contains too many items`);const out=[];for(const item of value){const text=String(item??"").trim();if(!text)continue;if(text.length>160)throw invalid(`${name} contains an oversized item`);if(!out.includes(text))out.push(text);}return out;}
function plainObject(value,name){if(value==null)return {};if(typeof value!=="object"||Array.isArray(value))throw invalid(`${name} must be an object`);return value;}
function normalizeAgent(input,current={}){
 const autonomy=Number(input.autonomyLevel??current.autonomyLevel??2);if(!Number.isInteger(autonomy)||autonomy<1||autonomy>3)throw invalid("autonomyLevel must be 1, 2 or 3");
 const status=String(input.status??current.status??"active").trim();if(!AGENT_STATUSES.has(status))throw invalid(`invalid AI employee status ${status}`);
 return {
  name:requiredText(input.name??current.name,"name",120),avatar:optionalText(input.avatar??current.avatar,"avatar",2048),role:requiredText(input.role??current.role,"role",120),department:optionalText(input.department??current.department,"department",120),description:optionalText(input.description??current.description,"description",4000),
  systemInstructions:String(input.systemInstructions??current.systemInstructions??"").slice(0,30000),provider:requiredText(input.provider??current.provider??"ollama","provider",80),model:optionalText(input.model??current.model,"model",200),status,
  permissions:stringList(input.permissions??current.permissions,"permissions"),allowedTools:stringList(input.allowedTools??current.allowedTools,"allowedTools"),autonomyLevel:autonomy,
  knowledgeSources:stringList(input.knowledgeSources??current.knowledgeSources,"knowledgeSources",256),workingSchedule:plainObject(input.workingSchedule??current.workingSchedule,"workingSchedule"),approvalRules:plainObject(input.approvalRules??current.approvalRules,"approvalRules"),
 };
}

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
    const normalized=normalizeAgent(input),agentId=input.agentId??randomUUID();
    const result=await this.database.query(`INSERT INTO ledgerly_ai.agents
      (agent_id,organization_id,name,avatar,role,department,description,system_instructions,provider,model,status,permissions,allowed_tools,autonomy_level,knowledge_sources,working_schedule,approval_rules)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15::jsonb,$16::jsonb,$17::jsonb) RETURNING *`,[
      agentId,context.organizationId,normalized.name,normalized.avatar,normalized.role,normalized.department,normalized.description,normalized.systemInstructions,
      normalized.provider,normalized.model,normalized.status,JSON.stringify(normalized.permissions),JSON.stringify(normalized.allowedTools),normalized.autonomyLevel,
      JSON.stringify(normalized.knowledgeSources),JSON.stringify(normalized.workingSchedule),JSON.stringify(normalized.approvalRules)]);
    await this.audit?.write?.({organization_id:context.organizationId,actor_type:"human",actor_id:context.userId,action:"ai.agent.created",entity_type:"ai_agent",entity_id:agentId,reason:input.reason??null,after:result.rows[0]});
    return mapAgent(result.rows[0]);
  }

  async update(context, agentId, input) {
    const current=await this.get(context,agentId);
    if (!current) throw new Error("AI agent not found");
    const next=normalizeAgent(input,current);
    const result=await this.database.query(`UPDATE ledgerly_ai.agents SET
      name=$1,avatar=$2,role=$3,department=$4,description=$5,system_instructions=$6,provider=$7,model=$8,status=$9,
      permissions=$10::jsonb,allowed_tools=$11::jsonb,autonomy_level=$12,knowledge_sources=$13::jsonb,working_schedule=$14::jsonb,approval_rules=$15::jsonb,updated_at=now()
      WHERE agent_id=$16 AND organization_id=$17 RETURNING *`,[
      next.name,next.avatar,next.role,next.department,next.description,next.systemInstructions,next.provider,next.model,next.status,
      JSON.stringify(next.permissions),JSON.stringify(next.allowedTools),next.autonomyLevel,JSON.stringify(next.knowledgeSources),JSON.stringify(next.workingSchedule),JSON.stringify(next.approvalRules),agentId,context.organizationId]);
    await this.audit?.write?.({organization_id:context.organizationId,actor_type:"human",actor_id:context.userId,action:"ai.agent.updated",entity_type:"ai_agent",entity_id:agentId,reason:input.reason??null,before:current,after:result.rows[0]});
    return mapAgent(result.rows[0]);
  }

  async disable(context,agentId,reason=null) { return this.update(context,agentId,{status:"disabled",reason}); }
}
