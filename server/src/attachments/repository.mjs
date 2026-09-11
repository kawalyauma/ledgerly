export class PostgresAttachmentsRepository {
  constructor({ database }) {
    if (!database?.query || !database?.transaction) throw new TypeError('attachments repository requires database');
    this.database = database;
  }

  async ensureSchema() {
    await this.database.query(`
      CREATE TABLE IF NOT EXISTS shared_attachments (
        id text PRIMARY KEY,
        organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        object_key text NOT NULL,
        original_name text NOT NULL,
        mime_type text NOT NULL,
        size_bytes bigint NOT NULL CHECK(size_bytes >= 0),
        checksum_sha256 text NOT NULL,
        purpose text NOT NULL DEFAULT 'attachment',
        entity_type text,
        entity_id text,
        uploaded_by text REFERENCES users(id) ON DELETE SET NULL,
        storage_state text NOT NULL DEFAULT 'active' CHECK(storage_state IN ('active','delete_pending','deleted')),
        deleted_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(organization_id, object_key)
      );
      CREATE INDEX IF NOT EXISTS shared_attachments_org_created_idx ON shared_attachments(organization_id, created_at DESC, id);
      CREATE INDEX IF NOT EXISTS shared_attachments_entity_idx ON shared_attachments(organization_id, entity_type, entity_id, created_at DESC) WHERE deleted_at IS NULL;
    `);
  }

  async insert(record) {
    const result = await this.database.query(
      `INSERT INTO shared_attachments (
         id,organization_id,object_key,original_name,mime_type,size_bytes,checksum_sha256,purpose,entity_type,entity_id,uploaded_by,storage_state,created_at,updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active',now(),now())
       ON CONFLICT (id) DO NOTHING RETURNING *`,
      [record.id,record.organizationId,record.objectKey,record.originalName,record.mimeType,record.sizeBytes,record.checksumSha256,record.purpose,record.entityType,record.entityId,record.uploadedBy],
    );
    if (result.rows[0]) return result.rows[0];
    const existing = await this.database.query(`SELECT organization_id,checksum_sha256,size_bytes FROM shared_attachments WHERE id=$1`,[record.id]);
    const row=existing.rows[0];
    if (row?.organization_id !== record.organizationId) throw Object.assign(new Error('attachment id belongs to another organization'),{code:'ATTACHMENT_ID_CONFLICT',status:409});
    if (row?.checksum_sha256 === record.checksumSha256 && Number(row?.size_bytes) === Number(record.sizeBytes)) return this.get(record.organizationId,record.id,{includeDeleted:true});
    throw Object.assign(new Error('attachment id already exists with different content'),{code:'ATTACHMENT_IDEMPOTENCY_MISMATCH',status:409});
  }

  async get(organizationId,id,{includeDeleted=false}={}) {
    const result=await this.database.query(
      `SELECT * FROM shared_attachments WHERE organization_id=$1 AND id=$2 ${includeDeleted?'':"AND deleted_at IS NULL AND storage_state='active'"}`,
      [organizationId,id],
    );
    return result.rows[0] ?? null;
  }

  async list({organizationId,entityType=null,entityId=null,limit=100,afterCreatedAt=null,afterId=null}) {
    const bounded=Math.max(1,Math.min(Number(limit)||100,500));
    const values=[organizationId]; const clauses=[`organization_id=$1`,`deleted_at IS NULL`,`storage_state='active'`];
    const add=(sql,value)=>{values.push(value);clauses.push(sql.replace('?',`$${values.length}`));};
    if(entityType) add('entity_type=?',entityType);
    if(entityId) add('entity_id=?',entityId);
    if(afterCreatedAt && afterId){values.push(afterCreatedAt,afterId);clauses.push(`(created_at,id) < ($${values.length-1}::timestamptz,$${values.length})`);}
    values.push(bounded);
    const result=await this.database.query(`SELECT * FROM shared_attachments WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC,id DESC LIMIT $${values.length}`,values);
    return result.rows;
  }

  async markDeletePending(organizationId,id) {
    const result=await this.database.query(
      `UPDATE shared_attachments SET storage_state='delete_pending',updated_at=now()
       WHERE organization_id=$1 AND id=$2 AND deleted_at IS NULL AND storage_state IN ('active','delete_pending') RETURNING *`,[organizationId,id]);
    return result.rows[0] ?? null;
  }

  async finalizeDelete(organizationId,id) {
    const result=await this.database.query(
      `UPDATE shared_attachments SET storage_state='deleted',deleted_at=COALESCE(deleted_at,now()),updated_at=now()
       WHERE organization_id=$1 AND id=$2 AND storage_state='delete_pending' RETURNING *`,[organizationId,id]);
    return result.rows[0] ?? null;
  }
}
