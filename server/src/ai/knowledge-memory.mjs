import { randomUUID } from "node:crypto";

const MEMORY_TYPES=new Set(["task","durable"]);
const MAX_MEMORY_JSON_BYTES=64*1024;
const MAX_INDEX_CHUNKS=1000;
const MAX_CHUNK_CHARS=12000;
const MAX_INDEX_CHARS=4_000_000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function invalid(code,message){const error=new Error(message);error.code=code;error.status=422;return error;}
function requiredText(value,name,max){const text=String(value??"").trim();if(!text)throw invalid("AI_INPUT_INVALID",`${name} is required`);if(text.length>max)throw invalid("AI_INPUT_INVALID",`${name} exceeds ${max} characters`);return text;}
function jsonSize(value){return Buffer.byteLength(JSON.stringify(value??null),"utf8");}

export class AiMemoryService {
  constructor({ database, audit }) { this.database=database; this.audit=audit; }

  async put({ context, agentId, type="durable", key, value, expiresAt=null }) {
    const org=context.organizationId;
    if (!org) throw new Error("organization context required");
    const employee=requiredText(agentId,"agentId",200),memoryType=String(type??"durable");if(!MEMORY_TYPES.has(memoryType))throw invalid("AI_MEMORY_TYPE_INVALID","memory type must be task or durable");const normalizedKey=requiredText(key,"memory key",200);if(jsonSize(value)>MAX_MEMORY_JSON_BYTES)throw invalid("AI_MEMORY_VALUE_TOO_LARGE",`memory value exceeds ${MAX_MEMORY_JSON_BYTES} bytes`);let expiry=null;if(expiresAt!=null&&expiresAt!==""){const parsed=new Date(expiresAt);if(Number.isNaN(parsed.getTime()))throw invalid("AI_MEMORY_EXPIRY_INVALID","memory expiresAt must be a valid date/time");expiry=parsed.toISOString();}
    const memoryId=randomUUID();
    const result=await this.database.query(`INSERT INTO ledgerly_ai.memories
      (memory_id,organization_id,agent_id,memory_type,key,value,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
      ON CONFLICT (organization_id,agent_id,memory_type,key) DO UPDATE SET value=EXCLUDED.value,expires_at=EXCLUDED.expires_at,disabled=false,updated_at=now()
      RETURNING *`, [memoryId,org,employee,memoryType,normalizedKey,JSON.stringify(value),expiry]);
    await this.audit?.write?.({ organization_id:org,actor_type:"human",actor_id:context.userId,action:"ai.memory.updated",entity_type:"ai_memory",entity_id:result.rows[0]?.memory_id,metadata:{agent_id:employee,type:memoryType,key:normalizedKey} });
    return result.rows[0];
  }

  async list({ context, agentId, type=null, includeDisabled=false }) {
    const org=context.organizationId;
    if (!org) throw new Error("organization context required");
    const employee=requiredText(agentId,"agentId",200);if(type&&!MEMORY_TYPES.has(type))throw invalid("AI_MEMORY_TYPE_INVALID","memory type must be task or durable");
    const values=[org,employee];
    const filters=["organization_id=$1","agent_id=$2"];
    if (type) { values.push(type); filters.push(`memory_type=$${values.length}`); }
    if (!includeDisabled) filters.push("disabled=false");
    filters.push("(expires_at IS NULL OR expires_at>now())");
    const result=await this.database.query(`SELECT * FROM ledgerly_ai.memories WHERE ${filters.join(" AND ")} ORDER BY updated_at DESC LIMIT 1000`,values);
    return result.rows;
  }

  async disable({ context, memoryId, disabled=true }) {
    const org=context.organizationId;if(!org)throw new Error("organization context required");
    const result=await this.database.query(`UPDATE ledgerly_ai.memories SET disabled=$1,updated_at=now() WHERE memory_id=$2 AND organization_id=$3 RETURNING *`,[Boolean(disabled),requiredText(memoryId,"memoryId",200),org]);
    if (!result.rowCount) throw new Error("memory not found");
    await this.audit?.write?.({organization_id:org,actor_type:"human",actor_id:context.userId,action:disabled?"ai.memory.disabled":"ai.memory.enabled",entity_type:"ai_memory",entity_id:memoryId});
    return result.rows[0];
  }

  async clear({ context, agentId, type=null }) {
    const org=context.organizationId;if(!org)throw new Error("organization context required");const employee=requiredText(agentId,"agentId",200);if(type&&!MEMORY_TYPES.has(type))throw invalid("AI_MEMORY_TYPE_INVALID","memory type must be task or durable");
    const values=[org,employee];
    const filter=type ? ` AND memory_type=$3` : "";
    if (type) values.push(type);
    const result=await this.database.query(`DELETE FROM ledgerly_ai.memories WHERE organization_id=$1 AND agent_id=$2${filter}`,values);
    await this.audit?.write?.({ organization_id:org,actor_type:"human",actor_id:context.userId,action:"ai.memory.cleared",entity_type:"ai_agent",entity_id:employee,metadata:{type} });
    return { cleared:result.rowCount };
  }
}

export class AiKnowledgeService {
  constructor({ database, storage, audit, embedder=null, embeddingDimensions=768, vectorEnabled=false }) {
    this.database=database; this.storage=storage; this.audit=audit; this.embedder=embedder;
    this.embeddingDimensions=embeddingDimensions; this.vectorEnabled=Boolean(vectorEnabled && embedder);
  }

  async createSource({ context, name, sourceType, storageRef=null, metadata={} }) {
    const org=context.organizationId;if(!org)throw new Error("organization context required");const sourceName=requiredText(name,"knowledge source name",240),kind=requiredText(sourceType,"knowledge source type",80);if(metadata==null||typeof metadata!=="object"||Array.isArray(metadata))throw invalid("AI_KNOWLEDGE_METADATA_INVALID","knowledge metadata must be an object");if(jsonSize(metadata)>128*1024)throw invalid("AI_KNOWLEDGE_METADATA_TOO_LARGE","knowledge metadata is too large");
    const sourceId=randomUUID();
    const result=await this.database.query(`INSERT INTO ledgerly_ai.knowledge_sources
      (source_id,organization_id,name,source_type,storage_ref,metadata,created_by)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING *`, [sourceId,org,sourceName,kind,storageRef,JSON.stringify(metadata),context.userId]);
    return result.rows[0];
  }

  async indexChunks({ context, sourceId, chunks }) {
    const org=context.organizationId;if(!org)throw new Error("organization context required");if(!UUID.test(String(sourceId??"")))throw invalid("AI_KNOWLEDGE_SOURCE_INVALID","knowledge source ID is invalid");if(!Array.isArray(chunks)||chunks.length===0)throw invalid("AI_KNOWLEDGE_CHUNKS_INVALID","knowledge chunks must be a non-empty array");if(chunks.length>MAX_INDEX_CHUNKS)throw invalid("AI_KNOWLEDGE_TOO_MANY_CHUNKS",`knowledge indexing is limited to ${MAX_INDEX_CHUNKS} chunks per source`);
    const normalized=[];let totalChars=0;for(let i=0;i<chunks.length;i++){const raw=typeof chunks[i]==="string"?{content:chunks[i]}:chunks[i];if(!raw||typeof raw!=="object")throw invalid("AI_KNOWLEDGE_CHUNK_INVALID",`knowledge chunk ${i} is invalid`);const content=requiredText(raw.content,`knowledge chunk ${i}`,MAX_CHUNK_CHARS);totalChars+=content.length;if(totalChars>MAX_INDEX_CHARS)throw invalid("AI_KNOWLEDGE_INDEX_TOO_LARGE",`knowledge source exceeds ${MAX_INDEX_CHARS} indexed characters`);normalized.push({...raw,content});}
    const source=(await this.database.query(`SELECT * FROM ledgerly_ai.knowledge_sources WHERE source_id=$1 AND organization_id=$2`,[sourceId,org])).rows[0];
    if (!source) throw new Error("knowledge source not found");
    let indexed=0;
    for (let i=0;i<normalized.length;i++) {
      const chunk=normalized[i];
      const embedding=this.vectorEnabled ? await this.embedder.embed(chunk.content) : null;
      if (embedding && embedding.length!==this.embeddingDimensions) throw invalid("AI_EMBEDDING_DIMENSION_MISMATCH","embedding dimension mismatch");
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
    await this.audit?.write?.({ organization_id:org,actor_type:"human",actor_id:context.userId,action:"ai.knowledge.indexed",entity_type:"ai_knowledge_source",entity_id:sourceId,metadata:{chunks:indexed,vector_search:this.vectorEnabled,total_chars:totalChars} });
    return { sourceId,indexed,vectorSearch:this.vectorEnabled };
  }

  async retrieve({ context, query, sourceIds=null, limit=8 }) {
    const org=context.organizationId;
    if (!org) throw new Error("organization context required");
    const search=requiredText(query,"knowledge query",12000),bounded=Math.max(1,Math.min(Number(limit)||8,20));let normalizedSources=null;if(sourceIds!=null){if(!Array.isArray(sourceIds)||sourceIds.length>100||sourceIds.some((id)=>!UUID.test(String(id))))throw invalid("AI_KNOWLEDGE_SOURCE_INVALID","knowledge source filter contains invalid IDs");normalizedSources=[...new Set(sourceIds.map(String))];}
    if (this.vectorEnabled) {
      const embedding=await this.embedder.embed(search);if(!Array.isArray(embedding)||embedding.length!==this.embeddingDimensions)throw invalid("AI_EMBEDDING_DIMENSION_MISMATCH","embedding dimension mismatch");
      const values=[org,`[${embedding.join(",")}]`,bounded];
      let filter="organization_id=$1";
      if (normalizedSources?.length) { values.push(normalizedSources); filter+=` AND source_id=ANY($4::uuid[])`; }
      const result=await this.database.query(`SELECT chunk_id,source_id,content,metadata,(embedding <=> $2::vector) AS distance
        FROM ledgerly_ai.knowledge_chunks WHERE ${filter} AND embedding IS NOT NULL ORDER BY embedding <=> $2::vector LIMIT $3`,values);
      return result.rows;
    }
    const values=[org,search,bounded];
    let filter="c.organization_id=$1";
    if (normalizedSources?.length) { values.push(normalizedSources); filter+=` AND c.source_id=ANY($4::uuid[])`; }
    const result=await this.database.query(`SELECT c.chunk_id,c.source_id,c.content,c.metadata,
      ts_rank_cd(to_tsvector('simple',c.content),plainto_tsquery('simple',$2)) AS rank
      FROM ledgerly_ai.knowledge_chunks c WHERE ${filter} AND to_tsvector('simple',c.content) @@ plainto_tsquery('simple',$2)
      ORDER BY rank DESC LIMIT $3`,values);
    return result.rows;
  }
}
