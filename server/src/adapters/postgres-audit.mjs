import { randomUUID } from "node:crypto";
import { ACTOR_TYPES } from "../contracts.mjs";

function requireText(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} is required`);
  return value.trim();
}

function toJson(value) {
  return value == null ? null : JSON.stringify(value);
}

export class PostgresAudit {
  constructor({ database }) {
    if (!database || typeof database.query !== "function") {
      throw new TypeError("PostgresAudit requires the Ledgerly database service");
    }
    this.provider = "postgresql-audit";
    this.database = database;
  }

  async ensureSchema() {
    await this.database.query(`
      CREATE TABLE IF NOT EXISTS ledgerly_meta.audit_events (
        id uuid PRIMARY KEY,
        organization_id text,
        actor_type text NOT NULL CHECK (actor_type IN ('human', 'ai_agent', 'system', 'integration')),
        actor_id text NOT NULL,
        agent_id text,
        agent_name text,
        agent_role text,
        action text NOT NULL,
        entity_type text NOT NULL,
        entity_id text,
        before_data jsonb,
        after_data jsonb,
        reason text,
        request_id text,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        occurred_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await this.database.query(`
      CREATE INDEX IF NOT EXISTS audit_events_org_time_idx
      ON ledgerly_meta.audit_events (organization_id, occurred_at DESC)
    `);
    await this.database.query(`
      CREATE INDEX IF NOT EXISTS audit_events_entity_time_idx
      ON ledgerly_meta.audit_events (entity_type, entity_id, occurred_at DESC)
    `);
    await this.database.query(`
      CREATE INDEX IF NOT EXISTS audit_events_actor_time_idx
      ON ledgerly_meta.audit_events (actor_type, actor_id, occurred_at DESC)
    `);
  }

  async write(event) {
    const actorType = requireText(event?.actor_type ?? event?.actorType, "actor_type");
    if (!ACTOR_TYPES.includes(actorType)) throw new TypeError(`Unsupported actor_type: ${actorType}`);

    const record = {
      id: event?.id ?? randomUUID(),
      organizationId: event?.organization_id ?? event?.organizationId ?? null,
      actorType,
      actorId: requireText(event?.actor_id ?? event?.actorId, "actor_id"),
      agentId: event?.agent_id ?? event?.agentId ?? null,
      agentName: event?.agent_name ?? event?.agentName ?? null,
      agentRole: event?.agent_role ?? event?.agentRole ?? null,
      action: requireText(event?.action, "action"),
      entityType: requireText(event?.entity_type ?? event?.entityType, "entity_type"),
      entityId: event?.entity_id ?? event?.entityId ?? null,
      before: event?.before ?? event?.before_data ?? null,
      after: event?.after ?? event?.after_data ?? null,
      reason: event?.reason ?? null,
      requestId: event?.request_id ?? event?.requestId ?? null,
      metadata: event?.metadata ?? {},
      occurredAt: event?.timestamp ?? event?.occurred_at ?? event?.occurredAt ?? new Date().toISOString(),
    };

    const result = await this.database.query(
      `INSERT INTO ledgerly_meta.audit_events (
        id, organization_id, actor_type, actor_id, agent_id, agent_name, agent_role,
        action, entity_type, entity_id, before_data, after_data, reason, request_id,
        metadata, occurred_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14,
        $15::jsonb, $16::timestamptz
      )
      RETURNING id, organization_id, actor_type, actor_id, agent_id, agent_name, agent_role,
        action, entity_type, entity_id, before_data, after_data, reason, request_id,
        metadata, occurred_at, created_at`,
      [
        record.id,
        record.organizationId,
        record.actorType,
        record.actorId,
        record.agentId,
        record.agentName,
        record.agentRole,
        record.action,
        record.entityType,
        record.entityId,
        toJson(record.before),
        toJson(record.after),
        record.reason,
        record.requestId,
        JSON.stringify(record.metadata),
        record.occurredAt,
      ],
    );
    return result.rows[0];
  }

  async list({
    organizationId = null,
    entityType = null,
    entityId = null,
    actorType = null,
    actorId = null,
    action = null,
    before = null,
    limit = 100,
  } = {}) {
    const boundedLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
    const clauses = [];
    const values = [];
    const add = (sql, value) => {
      values.push(value);
      clauses.push(sql.replace("?", `$${values.length}`));
    };

    if (organizationId != null) add("organization_id = ?", organizationId);
    if (entityType != null) add("entity_type = ?", entityType);
    if (entityId != null) add("entity_id = ?", entityId);
    if (actorType != null) add("actor_type = ?", actorType);
    if (actorId != null) add("actor_id = ?", actorId);
    if (action != null) add("action = ?", action);
    if (before != null) add("occurred_at < ?::timestamptz", before instanceof Date ? before.toISOString() : before);
    values.push(boundedLimit);

    const result = await this.database.query(
      `SELECT id, organization_id, actor_type, actor_id, agent_id, agent_name, agent_role,
        action, entity_type, entity_id, before_data, after_data, reason, request_id,
        metadata, occurred_at, created_at
       FROM ledgerly_meta.audit_events
       ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
       ORDER BY occurred_at DESC, created_at DESC
       LIMIT $${values.length}`,
      values,
    );
    return result.rows;
  }

  async health() {
    try {
      await this.database.query("SELECT id FROM ledgerly_meta.audit_events LIMIT 1");
      return { ok: true, provider: this.provider, durable: true };
    } catch (error) {
      return {
        ok: false,
        provider: this.provider,
        durable: true,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export async function createPostgresAudit({ database }) {
  const audit = new PostgresAudit({ database });
  await audit.ensureSchema();
  return audit;
}
