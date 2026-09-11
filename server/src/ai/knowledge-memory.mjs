import { randomUUID } from "node:crypto";

const KNOWLEDGE_READ_SCOPE="ai:knowledge:read";
const KNOWLEDGE_WRITE_SCOPE="ai:knowledge:write";

function permissionError(message,details={}){
  const error=new Error(message);
  error.status=403;
  error.code="AI_KNOWLEDGE_PERMISSION_DENIED";
  error.details=details;
  return error;
}
function contextPermissions(context){return Array.isArray(context?.permissions)?context.permissions.filter((item)=>typeof item==="string"):[];}
function hasPermission(context,permission){const granted=new Set(contextPermissions(context));return granted.has("*")||granted.has(permission);}
function requirePermission(context,permission){if(!hasPermission(context,permission))throw permissionError(`Missing AI knowledge permission: ${permission}`,{permission});}
function parsePermissionArray(value){
  if(Array.isArray(value))return value;
  if(typeof value==="string")try{const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed:[];}catch{return[];}
  return [];
}
function normalizeRequiredPermissions(value){
  const raw=parsePermissionArray(value);
  if(raw.length>32)throw new TypeError("knowledge source requiredPermissions may contain at most 32 scopes");
  const normalized=[KNOWLEDGE_READ_SCOPE];
  for(const item of raw){
    if(typeof item!=="string"||!item.trim())throw new TypeError("knowledge source permissions must be non-empty strings");
    const permission=item.trim();
    if(!/^[a-z0-9][a-z0-9:_*-]*$/.test(permission))throw new TypeError(`invalid knowledge source permission: ${permission}`);
    if(!normalized.includes(permission))normalized.push(permission);
  }
  return normalized;
}
function assertRequiredPermissions(context,required){
  const granted=new Set(contextPermissions(context));
  if(granted.has("*"))return;
  const missing=normalizeRequiredPermissions(required).filter((permission)=>!granted.has(permission));
  if(missing.length)throw permissionError("AI knowledge source exceeds current authority",{missingPermissions:missing});
}

export class AiMemoryService {
  constructor({ database, audit }) { this.database=database; this.audit=audit; }

  async put({ context, agentId, type="durable", key, value, expiresAt=null }) {
    const org=context.organizationId;
    if (!org) throw new Error("organization context required");
    const memoryId=randomUUID();
    const result=await this.database.query(`INSERT INTO ledgerly_ai.memories
      (memory_id,organization_id,agent_id,memory_type,key,value,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
      ON CONFLICT (organization_id,agent_id,memory_type,key) DO UPDATE SET value=EXCLUDED.value,expires_at=EXCLUDED.expires_at,disabled=false,updated_at=now()
      RETURNING *`, [memoryId,org,agentId,type,key,JSON.stringify(value),expiresAt]);
    await this.audit?.write?.({ organization_id:org,actor_type:"human",actor_id:context.userId,action:"ai.memory.updated",entity_type:"ai_memory",entity_id:result.rows[0]?.memory_id,metadata:{agent_id:agentId,type,key} });
    return result.rows[0];
  }

  async list({ context, agentId, type=null, includeDisabled=false }) {
    const org=context.organizationId;
    if (!org) throw new Error("organization context required");
    const values=[org,agentId];
    const filters=["organization_id=$1","agent_id=$2"];
    if (type) { values.push(type); filters.push(`memory_type=$${values.length}`); }
    if (!includeDisabled) filters.push("disabled=false");
    filters.push("(expires_at IS NULL OR expires_at>now())");
    const result=await this.database.query(`SELECT * FROM ledgerly_ai.memories WHERE ${filters.join(" AND ")} ORDER BY updated_at DESC`,values);
    return result.rows;
  }

  async disable({ context, memoryId, disabled=true }) {
    const org=context.organizationId;
    const result=await this.database.query(`UPDATE ledgerly_ai.memories SET disabled=$1,updated_at=now() WHERE memory_id=$2 AND organization_id=$3 RETURNING *`,[Boolean(disabled),memoryId,org]);
    if (!result.rowCount) throw new Error("memory not found");
    return result.rows[0];
  }

  async clear({ context, agentId, type=null }) {
    const org=context.organizationId;
    const values=[org,agentId];
    const filter=type ? ` AND memory_type=$3` : "";
    if (type) values.push(type);
    const result=await this.database.query(`DELETE FROM ledgerly_ai.memories WHERE organization_id=$1 AND agent_id=$2${filter}`,values);
    await this.audit?.write?.({ organization_id:org,actor_type:"human",actor_id:context.userId,action:"ai.memory.cleared",entity_type:"ai_agent",entity_id:agentId,metadata:{type} });
    return { cleared:result.rowCount };
  }
}

export class AiKnowledgeService {
  constructor({ database, audit, embedder=null, embeddingDimensions=768, vectorEnabled=false }) {
    this.database=database; this.audit=audit; this.embedder=embedder;
    this.embeddingDimensions=embeddingDimensions; this.vectorEnabled=Boolean(vectorEnabled && embedder);
  }

  async createSource({ context, name, sourceType, storageRef=null, metadata={}, requiredPermissions=[] }) {
    const org=context.organizationId;
    if(!org)throw new Error("organization context required");
    if(!context?.userId)throw new Error("knowledge source creation requires an attributable requester");
    requirePermission(context,KNOWLEDGE_WRITE_SCOPE);
    const required=normalizeRequiredPermissions(requiredPermissions);
    assertRequiredPermissions(context,required);
    const sourceId=randomUUID();
    const result=await this.database.query(`INSERT INTO ledgerly_ai.knowledge_sources
      (source_id,organization_id,name,source_type,storage_ref,metadata,required_permissions,created_by)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8) RETURNING *`, [sourceId,org,name,sourceType,storageRef,JSON.stringify(metadata),JSON.stringify(required),context.userId]);
    await this.audit?.write?.({organization_id:org,actor_type:"human",actor_id:context.userId,action:"ai.knowledge.source_created",entity_type:"ai_knowledge_source",entity_id:sourceId,metadata:{source_type:sourceType,storage_ref:storageRef,required_permissions:required}});
    return result.rows[0];
  }

  async listSources({context}){
    const org=context?.organizationId;
    if(!org)throw new Error("organization context required");
    requirePermission(context,KNOWLEDGE_READ_SCOPE);
    const permissions=contextPermissions(context),wildcard=permissions.includes("*");
    const result=await this.database.query(`SELECT * FROM ledgerly_ai.knowledge_sources
      WHERE organization_id=$1 AND ($2::boolean OR required_permissions <@ $3::jsonb)
      ORDER BY created_at DESC`,[org,wildcard,JSON.stringify(permissions)]);
    return result.rows;
  }

  async indexChunks({ context, sourceId, chunks }) {
    const org=context.organizationId;
    if(!org)throw new Error("organization context required");
    requirePermission(context,KNOWLEDGE_WRITE_SCOPE);
    const source=(await this.database.query(`SELECT * FROM ledgerly_ai.knowledge_sources WHERE source_id=$1 AND organization_id=$2`,[sourceId,org])).rows[0];
    if (!source) throw new Error("knowledge source not found");
    assertRequiredPermissions(context,source.required_permissions);
    let indexed=0;
    for (let i=0;i<chunks.length;i++) {
      const chunk=typeof chunks[i]==="string" ? {content:chunks[i]} : chunks[i];
      if(!chunk?.content||typeof chunk.content!=="string")throw new TypeError("knowledge chunks require text content");
      const embedding=this.vectorEnabled ? await this.embedder.embed(chunk.content) : null;
      if (embedding && embedding.length!==this.embeddingDimensions) throw new Error("embedding dimension mismatch");
      if (this.vectorEnabled) {
        await this.database.query(`INSERT INTO ledgerly_ai.knowledge_chunks
          (chunk_id,organization_id,source_id,chunk_index,content,token_count,embedding,metadata)
          VALUES ($1,$2,$3,$4,$5,$6,$7::vector,$8::jsonb)
          ON CONFLICT (source_id,chunk_index) DO UPDATE SET content=EXCLUDED.content,token_count=EXCLUDED.token_count,embedding=EXCLUDED.embedding,metadata=EXCLUDED.metadata`,
          [randomUUID(),org,sourceId,i,chunk.content,chunk.tokenCount??null,`[${embedding.join(",")}]`,JSON.stringify(chunk.metadata??{})]);
      } else {
        await this.database.query(`INSERT INTO ledgerly_ai.knowledge_chunks
          (chunk_id,organization_id,source_id,chunk_index,content,token_count,embedding_json,metadata)
          VALUES ($1,$2,$3,$4,$5,$6,NULL,$7::jsonb)
          ON CONFLICT (source_id,chunk_index) DO UPDATE SET content=EXCLUDED.content,token_count=EXCLUDED.token_count,metadata=EXCLUDED.metadata`,
          [randomUUID(),org,sourceId,i,chunk.content,chunk.tokenCount??null,JSON.stringify(chunk.metadata??{})]);
      }
      indexed++;
    }
    await this.database.query(`UPDATE ledgerly_ai.knowledge_sources SET status='indexed',indexed_at=now() WHERE source_id=$1 AND organization_id=$2`,[sourceId,org]);
    await this.audit?.write?.({ organization_id:org,actor_type:"human",actor_id:context.userId,action:"ai.knowledge.indexed",entity_type:"ai_knowledge_source",entity_id:sourceId,metadata:{chunks:indexed,vector_search:this.vectorEnabled,required_permissions:normalizeRequiredPermissions(source.required_permissions)} });
    return { sourceId,indexed,vectorSearch:this.vectorEnabled };
  }

  async retrieve({ context, query, sourceIds=null, limit=8 }) {
    const org=context.organizationId;
    if (!org) throw new Error("organization context required");
    requirePermission(context,KNOWLEDGE_READ_SCOPE);
    if(typeof query!=="string"||!query.trim())throw new TypeError("knowledge retrieval query is required");
    const bounded=Math.max(1,Math.min(Number(limit)||8,20));
    const permissions=contextPermissions(context),wildcard=permissions.includes("*");
    const selected=Array.isArray(sourceIds)&&sourceIds.length?sourceIds:null;
    if(selected&&selected.length>100)throw new TypeError("knowledge retrieval supports at most 100 sourceIds");
    const permissionJson=JSON.stringify(permissions);
    if (this.vectorEnabled) {
      const embedding=await this.embedder.embed(query);
      const values=[org,`[${embedding.join(",")}]`,bounded,wildcard,permissionJson,selected];
      const result=await this.database.query(`SELECT c.chunk_id,c.source_id,c.content,c.metadata,(c.embedding <=> $2::vector) AS distance
        FROM ledgerly_ai.knowledge_chunks c
        JOIN ledgerly_ai.knowledge_sources s ON s.organization_id=c.organization_id AND s.source_id=c.source_id
        WHERE c.organization_id=$1 AND s.status='indexed' AND ($4::boolean OR s.required_permissions <@ $5::jsonb)
          AND ($6::uuid[] IS NULL OR c.source_id=ANY($6::uuid[])) AND c.embedding IS NOT NULL
        ORDER BY c.embedding <=> $2::vector LIMIT $3`,values);
      return result.rows;
    }
    const values=[org,query,bounded,wildcard,permissionJson,selected];
    const result=await this.database.query(`SELECT c.chunk_id,c.source_id,c.content,c.metadata,
      ts_rank_cd(to_tsvector('simple',c.content),plainto_tsquery('simple',$2)) AS rank
      FROM ledgerly_ai.knowledge_chunks c
      JOIN ledgerly_ai.knowledge_sources s ON s.organization_id=c.organization_id AND s.source_id=c.source_id
      WHERE c.organization_id=$1 AND s.status='indexed' AND ($4::boolean OR s.required_permissions <@ $5::jsonb)
        AND ($6::uuid[] IS NULL OR c.source_id=ANY($6::uuid[]))
        AND to_tsvector('simple',c.content) @@ plainto_tsquery('simple',$2)
      ORDER BY rank DESC LIMIT $3`,values);
    return result.rows;
  }
}
