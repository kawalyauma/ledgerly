import { randomUUID } from "node:crypto";
import { PROHIBITED_DIRECT_TOOLS } from "./constants.mjs";

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

function permissionError(message,details={}) {
  const error=new Error(message);
  error.status=403;
  error.code="AI_AGENT_CONFIGURATION_DENIED";
  error.details=details;
  return error;
}

function normalizedStrings(value,{name,max=128}={}) {
  if(value==null)return[];
  if(!Array.isArray(value))throw new TypeError(`${name} must be an array`);
  if(value.length>max)throw new TypeError(`${name} may contain at most ${max} items`);
  const output=[];
  for(const item of value){
    if(typeof item!=="string"||!item.trim())throw new TypeError(`${name} must contain non-empty strings`);
    const text=item.trim();if(!output.includes(text))output.push(text);
  }
  return output;
}

function parseArray(value){
  if(Array.isArray(value))return value;
  if(typeof value==="string")try{const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed:[];}catch{return[];}
  return [];
}

function hasApprovalAuthority(context){const permissions=new Set(context?.permissions??[]);return permissions.has("*")||permissions.has("ai:approve");}

function assertPermissionSubset(context,permissions) {
  const granted=new Set(normalizedStrings(context?.permissions??[],{name:"context permissions",max:512}));
  if(granted.has("*"))return;
  if(!granted.has("ai:approve"))throw permissionError("AI employee configuration requires ai:approve authority",{missingPermissions:["ai:approve"]});
  const missing=permissions.filter((permission)=>!granted.has(permission));
  if(missing.length)throw permissionError("An AI employee cannot be granted authority the configuring user does not currently hold",{missingPermissions:missing});
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

  async #validatedConfiguration(context,input,current=null) {
    const permissions=normalizedStrings(input.permissions??current?.permissions??[],{name:"AI employee permissions",max:256});
    const allowedTools=normalizedStrings(input.allowedTools??current?.allowedTools??[],{name:"AI employee allowedTools",max:256});
    const knowledgeSources=normalizedStrings(input.knowledgeSources??current?.knowledgeSources??[],{name:"AI employee knowledgeSources",max:256});
    assertPermissionSubset(context,permissions);
    const granted=new Set(context.permissions??[]),wildcard=granted.has("*");
    const restrictedTools=allowedTools.filter((tool)=>PROHIBITED_DIRECT_TOOLS.has(tool));
    if(restrictedTools.length&&!wildcard)throw permissionError("Restricted consequential tools may only be assigned by an organization owner/admin",{restrictedTools});
    const autonomyLevel=Number(input.autonomyLevel??current?.autonomyLevel??2);
    if(!Number.isInteger(autonomyLevel)||autonomyLevel<1||autonomyLevel>3)throw new TypeError("AI employee autonomyLevel must be 1, 2, or 3");
    if(knowledgeSources.length){
      if(!wildcard&&!granted.has("ai:knowledge:read"))throw permissionError("Assigning AI knowledge sources requires ai:knowledge:read",{missingPermissions:["ai:knowledge:read"]});
      const result=await this.database.query(`SELECT source_id,required_permissions FROM ledgerly_ai.knowledge_sources WHERE organization_id=$1 AND source_id=ANY($2::uuid[])`,[context.organizationId,knowledgeSources]);
      if(result.rows.length!==knowledgeSources.length){const found=new Set(result.rows.map((row)=>row.source_id));throw permissionError("One or more AI knowledge sources are missing or outside this organization",{sourceIds:knowledgeSources.filter((id)=>!found.has(id))});}
      for(const source of result.rows){
        const required=parseArray(source.required_permissions);
        const missing=wildcard?[]:required.filter((permission)=>!granted.has(permission));
        if(missing.length)throw permissionError("The configuring user cannot assign a knowledge source they cannot currently read",{sourceId:source.source_id,missingPermissions:missing});
      }
    }
    return {permissions,allowedTools,knowledgeSources,autonomyLevel};
  }

  async create(context, input) {
    const validated=await this.#validatedConfiguration(context,input);
    const agentId=input.agentId??randomUUID();
    const result=await this.database.query(`INSERT INTO ledgerly_ai.agents
      (agent_id,organization_id,name,avatar,role,department,description,system_instructions,provider,model,status,permissions,allowed_tools,autonomy_level,knowledge_sources,working_schedule,approval_rules)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15::jsonb,$16::jsonb,$17::jsonb) RETURNING *`,[
      agentId,context.organizationId,input.name,input.avatar??null,input.role,input.department??null,input.description??null,input.systemInstructions??"",
      input.provider??"ollama",input.model??null,input.status??"active",JSON.stringify(validated.permissions),JSON.stringify(validated.allowedTools),validated.autonomyLevel,
      JSON.stringify(validated.knowledgeSources),JSON.stringify(input.workingSchedule??{}),JSON.stringify(input.approvalRules??{})]);
    await this.audit?.write?.({organization_id:context.organizationId,actor_type:"human",actor_id:context.userId,action:"ai.agent.created",entity_type:"ai_agent",entity_id:agentId,reason:input.reason??null,after:result.rows[0]});
    return mapAgent(result.rows[0]);
  }

  async update(context, agentId, input) {
    const current=await this.get(context,agentId);
    if (!current) throw new Error("AI agent not found");
    const validated=await this.#validatedConfiguration(context,input,current);
    const next={...current,...input,...validated,agentId,organizationId:context.organizationId};
    const result=await this.database.query(`UPDATE ledgerly_ai.agents SET
      name=$1,avatar=$2,role=$3,department=$4,description=$5,system_instructions=$6,provider=$7,model=$8,status=$9,
      permissions=$10::jsonb,allowed_tools=$11::jsonb,autonomy_level=$12,knowledge_sources=$13::jsonb,working_schedule=$14::jsonb,approval_rules=$15::jsonb,updated_at=now()
      WHERE agent_id=$16 AND organization_id=$17 RETURNING *`,[
      next.name,next.avatar??null,next.role,next.department??null,next.description??null,next.systemInstructions??"",next.provider??"ollama",next.model??null,next.status??"active",
      JSON.stringify(validated.permissions),JSON.stringify(validated.allowedTools),validated.autonomyLevel,JSON.stringify(validated.knowledgeSources),JSON.stringify(next.workingSchedule??{}),JSON.stringify(next.approvalRules??{}),agentId,context.organizationId]);
    await this.audit?.write?.({organization_id:context.organizationId,actor_type:"human",actor_id:context.userId,action:"ai.agent.updated",entity_type:"ai_agent",entity_id:agentId,reason:input.reason??null,before:current,after:result.rows[0]});
    return mapAgent(result.rows[0]);
  }

  async disable(context,agentId,reason=null) {
    if(!hasApprovalAuthority(context))throw permissionError("Disabling an AI employee requires ai:approve authority",{missingPermissions:["ai:approve"]});
    const current=await this.get(context,agentId);if(!current)throw new Error("AI agent not found");
    const result=await this.database.query(`UPDATE ledgerly_ai.agents SET status='disabled',updated_at=now() WHERE agent_id=$1 AND organization_id=$2 RETURNING *`,[agentId,context.organizationId]);
    await this.audit?.write?.({organization_id:context.organizationId,actor_type:"human",actor_id:context.userId,action:"ai.agent.disabled",entity_type:"ai_agent",entity_id:agentId,reason,before:current,after:result.rows[0]});
    return mapAgent(result.rows[0]);
  }
}
