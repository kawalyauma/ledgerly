import { randomUUID } from "node:crypto";
import { assertTenant } from "./policy.mjs";

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
  constructor({ database, storage, audit, embedder=null, embeddingDimensions=768 }) {
    this.database=database; this.storage=storage; this.audit=audit; this.embedder=embedder; this.embeddingDimensions=embeddingDimensions;
  }

  async createSource({ context, name, sourceType, storageRef=null, metadata={} }) {
    const org=context.organizationId;
    const sourceId=randomUUID();
    const result=await this.database.query(`INSERT INTO ledgerly_ai.knowledge_sources
      (source_id,organization_id,name,source_type,storage_ref,metadata,created_by)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING *`, [sourceId,org,name,sourceType,storageRef,JSON.stringify(metadata),context.userId]);
    return result.rows[0];
  }

  async indexChunks({ context, sourceId, chunks }) {
    const org=context.organizationId;
    const source=(await this.database.query(`SELECT * FROM ledgerly_ai.knowledge_sources WHERE source_id=$1 AND organization_id=$2`,[sourceId,org])).rows[0];
    if (!source) throw new Error("knowledge source not found");
    let indexed=0;
    for (let i=0;i<chunks.length;i++) {
      const chunk=typeof chunks[i]==="string" ? {content:chunks[i]} : chunks[i];
      const embedding=this.embedder ? await this.embedder.embed(chunk.content) : null;
      if (embedding && embedding.length!==this.embeddingDimensions) throw new Error("embedding dimension mismatch");
      await this.database.query(`INSERT INTO ledgerly_ai.knowledge_chunks
        (chunk_id,organization_id,source_id,chunk_index,content,token_count,embedding,metadata)
        VALUES ($1,$2,$3,$4,$5,$6,$7::vector,$8::jsonb)
        ON CONFLICT (source_id,chunk_index) DO UPDATE SET content=EXCLUDED.content,token_count=EXCLUDED.token_count,embedding=EXCLUDED.embedding,metadata=EXCLUDED.metadata`,
        [randomUUID(),org,sourceId,i,chunk.content,chunk.tokenCount??null,embedding?`[${embedding.join(",")}]`:null,JSON.stringify(chunk.metadata??{})]);
      indexed++;
    }
    await this.database.query(`UPDATE ledgerly_ai.knowledge_sources SET status='indexed',indexed_at=now() WHERE source_id=$1 AND organization_id=$2`,[sourceId,org]);
    await this.audit?.write?.({ organization_id:org,actor_type:"human",actor_id:context.userId,action:"ai.knowledge.indexed",entity_type:"ai_knowledge_source",entity_id:sourceId,metadata:{chunks:indexed} });
    return { sourceId,indexed };
  }

  async retrieve({ context, query, sourceIds=null, limit=8 }) {
    const org=context.organizationId;
    if (!org) throw new Error("organization context required");
    const bounded=Math.max(1,Math.min(Number(limit)||8,20));
    if (this.embedder) {
      const embedding=await this.embedder.embed(query);
      const values=[org,`[${embedding.join(",")}]`,bounded];
      let filter="organization_id=$1";
      if (sourceIds?.length) { values.push(sourceIds); filter+=` AND source_id=ANY($4::uuid[])`; }
      const result=await this.database.query(`SELECT chunk_id,source_id,content,metadata,(embedding <=> $2::vector) AS distance
        FROM ledgerly_ai.knowledge_chunks WHERE ${filter} AND embedding IS NOT NULL ORDER BY embedding <=> $2::vector LIMIT $3`,values);
      return result.rows;
    }
    const values=[org,query,bounded];
    let filter="c.organization_id=$1";
    if (sourceIds?.length) { values.push(sourceIds); filter+=` AND c.source_id=ANY($4::uuid[])`; }
    const result=await this.database.query(`SELECT c.chunk_id,c.source_id,c.content,c.metadata,
      ts_rank_cd(to_tsvector('simple',c.content),plainto_tsquery('simple',$2)) AS rank
      FROM ledgerly_ai.knowledge_chunks c WHERE ${filter} AND to_tsvector('simple',c.content) @@ plainto_tsquery('simple',$2)
      ORDER BY rank DESC LIMIT $3`,values);
    return result.rows;
  }
}
