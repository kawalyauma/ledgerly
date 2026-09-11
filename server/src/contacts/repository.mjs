function requireId(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} is required`);
  return value.trim();
}

async function recordChange(tx, { organizationId, recordId, payload, changedBy = null, operation = 'upsert' }) {
  const versionResult = await tx.query(
    `INSERT INTO mobile_sync_record_versions (organization_id,module_key,collection_key,record_id,version,deleted,server_updated_at)
     VALUES ($1,'contacts','contacts',$2,1,$3,now())
     ON CONFLICT (organization_id,module_key,collection_key,record_id)
     DO UPDATE SET version=mobile_sync_record_versions.version+1,deleted=EXCLUDED.deleted,server_updated_at=now()
     RETURNING version`,
    [organizationId, recordId, operation === 'delete'],
  );
  const version = Number(versionResult.rows[0].version);
  if (operation === 'delete') {
    await tx.query(
      `INSERT INTO mobile_sync_tombstones (organization_id,module_key,collection_key,record_id,version,deleted_at)
       VALUES ($1,'contacts','contacts',$2,$3,now())
       ON CONFLICT (organization_id,module_key,collection_key,record_id)
       DO UPDATE SET version=EXCLUDED.version,deleted_at=EXCLUDED.deleted_at`,
      [organizationId, recordId, version],
    );
  }
  await tx.query(
    `INSERT INTO mobile_sync_changes (organization_id,module_key,collection_key,record_id,version,operation,payload_json,changed_by,changed_at)
     VALUES ($1,'contacts','contacts',$2,$3,$4,$5,$6,now())`,
    [organizationId, recordId, version, operation, payload == null ? null : JSON.stringify(payload), changedBy],
  );
  return version;
}

export class PostgresContactsRepository {
  constructor({ database }) { if (!database?.query || !database?.transaction) throw new TypeError('database required'); this.database = database; }

  async get(organizationId, id) {
    const result = await this.database.query(
      `SELECT id,organization_id,type,code,name,email,active,created_at,updated_at FROM contacts WHERE organization_id=$1 AND id=$2 AND archived_at IS NULL`,
      [organizationId, id],
    );
    return result.rows[0] ?? null;
  }

  async list({ organizationId, limit = 100, afterId = null, type = null, active = null }) {
    const bounded = Math.max(1, Math.min(Number(limit) || 100, 500));
    const values = [organizationId]; const where = ['organization_id=$1', 'archived_at IS NULL'];
    if (afterId) { values.push(afterId); where.push(`id>$${values.length}`); }
    if (type) { values.push(type); where.push(`type=$${values.length}`); }
    if (active !== null && active !== undefined) { values.push(Boolean(active)); where.push(`active=$${values.length}`); }
    values.push(bounded);
    const result = await this.database.query(
      `SELECT id,organization_id,type,code,name,email,active,created_at,updated_at FROM contacts WHERE ${where.join(' AND ')} ORDER BY id LIMIT $${values.length}`,
      values,
    );
    return result.rows;
  }

  async create({ organizationId, contact, changedBy }) {
    return this.database.transaction(async (tx) => {
      const result = await tx.query(
        `INSERT INTO contacts (id,organization_id,type,code,name,email,tax_number,payment_terms_days,active,custom_fields,credit_limit_minor,pricing_tier,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now(),now())
         ON CONFLICT (id) DO NOTHING
         RETURNING id,organization_id,type,code,name,email,active,created_at,updated_at`,
        [contact.id,organizationId,contact.type,contact.code ?? null,contact.name,contact.email ?? null,contact.taxNumber ?? null,Number(contact.paymentTermsDays ?? 0),contact.active !== false,JSON.stringify(contact.customFields ?? {}),Number(contact.creditLimitMinor ?? 0),contact.pricingTier ?? null],
      );
      const row = result.rows[0];
      if (!row) {
        const existing = await tx.query(`SELECT organization_id FROM contacts WHERE id=$1`, [contact.id]);
        const error = new Error(existing.rows[0]?.organization_id === organizationId ? 'contact id already exists' : 'contact id belongs to another organization');
        error.code = existing.rows[0]?.organization_id === organizationId ? 'CONTACT_DUPLICATE' : 'CONTACT_CROSS_TENANT_ID'; error.status = 409; throw error;
      }
      await recordChange(tx, { organizationId, recordId: row.id, payload: row, changedBy });
      return row;
    });
  }
}

export { recordChange as recordContactSyncChange };
