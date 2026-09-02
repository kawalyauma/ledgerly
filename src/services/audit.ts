import { createId } from "../lib/ids";

export function auditStatement(db: D1Database, input: {
  organizationId: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  requestId?: string;
  after?: unknown;
}): D1PreparedStatement {
  return db.prepare(`INSERT INTO audit_logs
    (id, organization_id, actor_id, action, entity_type, entity_id, request_id, after)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(createId("aud"), input.organizationId, input.actorId, input.action, input.entityType, input.entityId,
      input.requestId ?? null, input.after == null ? null : JSON.stringify(input.after));
}
