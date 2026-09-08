import { AppError } from "../../../src/lib/errors";
import { getMobileSyncCollection } from "./registry";

export type ServerSyncChangeInput = {
  organizationId: string;
  moduleKey: string;
  collectionKey: string;
  recordId: string;
  operation: "upsert" | "delete";
  payload?: unknown;
  actorId?: string | null;
  deviceId?: string | null;
};

/**
 * Build synchronization metadata/changelog statements for a normal server-side write.
 * Put these statements in the SAME db.batch() as the domain write so mobile clients
 * never observe a sync change without its domain transaction (or vice versa).
 */
export async function prepareServerSyncChange(db: D1Database, input: ServerSyncChangeInput) {
  if (!getMobileSyncCollection(input.moduleKey, input.collectionKey)) {
    throw new AppError(500, "SYNC_COLLECTION_NOT_REGISTERED", `Server write attempted to publish unregistered mobile collection ${input.moduleKey}:${input.collectionKey}`);
  }
  const row = await db.prepare(`SELECT version FROM mobile_sync_record_versions
    WHERE organization_id=? AND module_key=? AND collection_key=? AND record_id=?`)
    .bind(input.organizationId, input.moduleKey, input.collectionKey, input.recordId).first<{ version: number }>();
  const version = Number(row?.version ?? 0) + 1;
  const payload = input.operation === "delete" ? null : JSON.stringify(input.payload ?? null);
  const casId = `srv_${crypto.randomUUID()}`;
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT INTO mobile_sync_cas_checks (check_id,ok) VALUES (?,
      CASE WHEN COALESCE((SELECT version FROM mobile_sync_record_versions
        WHERE organization_id=? AND module_key=? AND collection_key=? AND record_id=?),0)=? THEN 1 ELSE 0 END)`)
      .bind(casId, input.organizationId, input.moduleKey, input.collectionKey, input.recordId, version - 1),
    db.prepare(`INSERT INTO mobile_sync_record_versions
      (organization_id,module_key,collection_key,record_id,version,deleted,server_updated_at,last_device_id)
      VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP,?) ON CONFLICT(organization_id,module_key,collection_key,record_id)
      DO UPDATE SET version=excluded.version,deleted=excluded.deleted,server_updated_at=CURRENT_TIMESTAMP,last_device_id=excluded.last_device_id`)
      .bind(input.organizationId, input.moduleKey, input.collectionKey, input.recordId, version, input.operation === "delete" ? 1 : 0, input.deviceId ?? null),
    input.operation === "delete"
      ? db.prepare(`INSERT INTO mobile_sync_tombstones (organization_id,module_key,collection_key,record_id,version,deleted_at,device_id)
          VALUES (?,?,?,?,?,CURRENT_TIMESTAMP,?) ON CONFLICT(organization_id,module_key,collection_key,record_id)
          DO UPDATE SET version=excluded.version,deleted_at=CURRENT_TIMESTAMP,device_id=excluded.device_id`)
          .bind(input.organizationId, input.moduleKey, input.collectionKey, input.recordId, version, input.deviceId ?? null)
      : db.prepare("DELETE FROM mobile_sync_tombstones WHERE organization_id=? AND module_key=? AND collection_key=? AND record_id=?")
          .bind(input.organizationId, input.moduleKey, input.collectionKey, input.recordId),
    db.prepare(`INSERT INTO mobile_sync_changes
      (organization_id,module_key,collection_key,record_id,version,operation,payload_json,changed_by,device_id,changed_at)
      VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`)
      .bind(input.organizationId, input.moduleKey, input.collectionKey, input.recordId, version, input.operation, payload, input.actorId ?? null, input.deviceId ?? null),
    db.prepare("DELETE FROM mobile_sync_cas_checks WHERE check_id=?").bind(casId),
  ];
  return { version, statements };
}
