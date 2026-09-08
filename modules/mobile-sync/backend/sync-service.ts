import { AppError } from "../../../src/lib/errors";
import { sha256 } from "../../../src/lib/crypto";
import { createId } from "../../../src/lib/ids";
import { auditStatement } from "../../../src/services/audit";
import type { AuthPrincipal } from "../../../src/types";
import {
  MOBILE_SYNC_PROTOCOL_VERSION,
  type MobileSyncCollectionDefinition,
  type MobileSyncDependency,
  type MobileSyncMutation,
  type MobileSyncRecord,
} from "./contracts";
import { getMobileSyncCollection, listMobileSyncCollections } from "./registry";
import { assertOwnedActiveDevice } from "./device-service";

const MAX_PUSH_OPERATIONS = 250;
const MAX_PULL_LIMIT = 1000;
const TERMINAL = new Set(["applied", "duplicate", "conflict", "rejected"]);
type R = Record<string, any>;
type PushInput = { deviceId: string; batchId: string; protocolVersion: number; operations: MobileSyncMutation[] };
type PullRequest = { moduleKey: string; collectionKey: string; limit?: number };
type PullInput = { deviceId: string; requestId: string; protocolVersion: number; collections: PullRequest[] };

function stable(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(k => `${JSON.stringify(k)}:${stable(object[k])}`).join(",")}}`;
}

function parse<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function hasScope(principal: AuthPrincipal, scope?: string) {
  return !scope || principal.role === "owner" || principal.role === "admin" || principal.scopes.includes(scope);
}

const collectionKey = (v: { moduleKey: string; collectionKey: string }) => `${v.moduleKey}:${v.collectionKey}`;

async function requireSchemaReady(db: D1Database, deviceId: string, definition: MobileSyncCollectionDefinition) {
  const row = await db.prepare(`SELECT schema_version AS schemaVersion FROM mobile_sync_device_schemas
    WHERE device_id=? AND module_key=? AND collection_key=?`)
    .bind(deviceId, definition.moduleKey, definition.collectionKey).first<{ schemaVersion: number }>();
  return Number(row?.schemaVersion ?? 0) === definition.schemaVersion;
}

async function currentRecordMeta(db: D1Database, organizationId: string, moduleKey: string, collection: string, recordId: string) {
  const version = await db.prepare(`SELECT version,deleted,server_updated_at AS serverUpdatedAt FROM mobile_sync_record_versions
    WHERE organization_id=? AND module_key=? AND collection_key=? AND record_id=?`)
    .bind(organizationId, moduleKey, collection, recordId).first<{ version: number; deleted: number; serverUpdatedAt: string }>();
  const change = await db.prepare(`SELECT payload_json AS payload,change_id AS changeId FROM mobile_sync_changes
    WHERE organization_id=? AND module_key=? AND collection_key=? AND record_id=? ORDER BY change_id DESC LIMIT 1`)
    .bind(organizationId, moduleKey, collection, recordId).first<{ payload: string | null; changeId: number }>();
  return {
    version: Number(version?.version ?? 0),
    deleted: Boolean(version?.deleted),
    serverUpdatedAt: version?.serverUpdatedAt ?? null,
    payload: parse(change?.payload, null as unknown),
    changeId: change?.changeId ?? null,
  };
}

async function dependenciesReady(db: D1Database, deviceId: string, organizationId: string, dependencies: MobileSyncDependency[]) {
  for (const dependency of dependencies) {
    if ("operationId" in dependency) {
      const op = await db.prepare("SELECT status FROM mobile_sync_operations WHERE device_id=? AND operation_uuid=?")
        .bind(deviceId, dependency.operationId).first<{ status: string }>();
      if (!op || op.status === "received" || op.status === "blocked") {
        return { ready: false, retryable: true, code: "DEPENDENCY_PENDING", message: `Operation dependency ${dependency.operationId} has not completed` };
      }
      if (!TERMINAL.has(op.status) || op.status === "conflict" || op.status === "rejected") {
        return { ready: false, retryable: false, code: "DEPENDENCY_FAILED", message: `Operation dependency ${dependency.operationId} did not apply successfully` };
      }
    } else {
      const row = await db.prepare(`SELECT version,deleted FROM mobile_sync_record_versions
        WHERE organization_id=? AND module_key=? AND collection_key=? AND record_id=?`)
        .bind(organizationId, dependency.moduleKey, dependency.collectionKey, dependency.recordId).first<{ version: number; deleted: number }>();
      if (!row || row.deleted || Number(row.version) < Number(dependency.minVersion ?? 1)) {
        return { ready: false, retryable: true, code: "RECORD_DEPENDENCY_PENDING", message: `Required record ${dependency.moduleKey}/${dependency.collectionKey}/${dependency.recordId} is not available yet` };
      }
    }
  }
  return { ready: true, retryable: false, code: "", message: "" };
}

function eventStatement(db: D1Database, input: { organizationId: string; deviceId: string; userId: string; eventType: string; batchId?: string | null; operationId?: string | null; details?: unknown }) {
  return db.prepare(`INSERT INTO mobile_sync_events
    (id,organization_id,device_id,user_id,event_type,batch_id,operation_id,details_json)
    VALUES (?,?,?,?,?,?,?,?)`)
    .bind(createId("mse"), input.organizationId, input.deviceId, input.userId, input.eventType, input.batchId ?? null,
      input.operationId ?? null, input.details == null ? null : JSON.stringify(input.details));
}

async function finishTerminal(
  db: D1Database,
  principal: AuthPrincipal,
  deviceId: string,
  batchServerId: string,
  mutation: MobileSyncMutation,
  status: "conflict" | "rejected",
  result: R,
  errorCode: string,
  errorMessage: string,
  conflict?: R,
) {
  const statements: D1PreparedStatement[] = [
    db.prepare(`UPDATE mobile_sync_operations SET status=?,retryable=0,result_json=?,error_code=?,error_message=?,processed_at=CURRENT_TIMESTAMP,attempts=attempts+1
      WHERE device_id=? AND operation_uuid=?`).bind(status, JSON.stringify(result), errorCode, errorMessage, deviceId, mutation.operationId),
    db.prepare("UPDATE mobile_sync_devices SET last_push_sequence=?,last_seen_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?")
      .bind(mutation.sequence, deviceId, principal.organizationId),
    eventStatement(db, { organizationId: principal.organizationId, deviceId, userId: principal.userId, eventType: `operation.${status}`, batchId: batchServerId, operationId: mutation.operationId, details: { errorCode, recordId: mutation.recordId } }),
  ];
  if (conflict) {
    statements.push(db.prepare(`INSERT INTO mobile_sync_conflicts
      (id,organization_id,device_id,batch_id,operation_id,module_key,collection_key,record_id,client_base_version,server_version,client_payload_json,server_payload_json,resolution)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'server_returned')`)
      .bind(createId("msc"), principal.organizationId, deviceId, batchServerId, mutation.operationId, mutation.moduleKey, mutation.collectionKey,
        mutation.recordId, mutation.baseVersion, conflict.serverVersion ?? 0, mutation.payload == null ? null : JSON.stringify(mutation.payload),
        conflict.serverPayload == null ? null : JSON.stringify(conflict.serverPayload)));
  }
  await db.batch(statements);
  return result;
}

async function blockOperation(db: D1Database, principal: AuthPrincipal, deviceId: string, batchServerId: string, mutation: MobileSyncMutation, code: string, message: string) {
  const result = { operationId: mutation.operationId, sequence: mutation.sequence, status: "blocked", retryable: true, error: { code, message } };
  await db.batch([
    db.prepare(`UPDATE mobile_sync_operations SET status='blocked',retryable=1,result_json=?,error_code=?,error_message=?,attempts=attempts+1
      WHERE device_id=? AND operation_uuid=?`).bind(JSON.stringify(result), code, message, deviceId, mutation.operationId),
    eventStatement(db, { organizationId: principal.organizationId, deviceId, userId: principal.userId, eventType: "operation.blocked", batchId: batchServerId, operationId: mutation.operationId, details: { code } }),
  ]);
  return result;
}

async function applyOperation(db: D1Database, principal: AuthPrincipal, deviceId: string, batchServerId: string, mutation: MobileSyncMutation) {
  const definition = getMobileSyncCollection(mutation.moduleKey, mutation.collectionKey);
  if (!definition) {
    const result = { operationId: mutation.operationId, sequence: mutation.sequence, status: "rejected", retryable: false, error: { code: "COLLECTION_NOT_REGISTERED", message: "This collection is not enabled for mobile synchronization" } };
    return { terminal: true, result: await finishTerminal(db, principal, deviceId, batchServerId, mutation, "rejected", result, "COLLECTION_NOT_REGISTERED", result.error.message) };
  }
  if (mutation.schemaVersion !== definition.schemaVersion || !await requireSchemaReady(db, deviceId, definition)) {
    const result = { operationId: mutation.operationId, sequence: mutation.sequence, status: "rejected", retryable: false,
      error: { code: "SCHEMA_MIGRATION_REQUIRED", message: "Apply and acknowledge the current local schema before synchronizing this collection", serverSchemaVersion: definition.schemaVersion } };
    return { terminal: true, result: await finishTerminal(db, principal, deviceId, batchServerId, mutation, "rejected", result, "SCHEMA_MIGRATION_REQUIRED", result.error.message) };
  }
  if (definition.mode === "read-only" || !definition.prepareMutation) {
    const result = { operationId: mutation.operationId, sequence: mutation.sequence, status: "rejected", retryable: false, error: { code: "READ_ONLY_COLLECTION", message: "This collection is server-managed and read-only on mobile" } };
    return { terminal: true, result: await finishTerminal(db, principal, deviceId, batchServerId, mutation, "rejected", result, "READ_ONLY_COLLECTION", result.error.message) };
  }
  if (definition.mode === "append-only" && mutation.kind === "delete") {
    const result = { operationId: mutation.operationId, sequence: mutation.sequence, status: "rejected", retryable: false, error: { code: "APPEND_ONLY_COLLECTION", message: "Records in this collection cannot be deleted from mobile" } };
    return { terminal: true, result: await finishTerminal(db, principal, deviceId, batchServerId, mutation, "rejected", result, "APPEND_ONLY_COLLECTION", result.error.message) };
  }
  if (!hasScope(principal, definition.pushScope)) {
    const result = { operationId: mutation.operationId, sequence: mutation.sequence, status: "rejected", retryable: false, error: { code: "SYNC_PERMISSION_DENIED", message: `Missing permission required to change ${collectionKey(definition)}` } };
    return { terminal: true, result: await finishTerminal(db, principal, deviceId, batchServerId, mutation, "rejected", result, "SYNC_PERMISSION_DENIED", result.error.message) };
  }

  const deps = await dependenciesReady(db, deviceId, principal.organizationId, mutation.dependencies ?? []);
  if (!deps.ready) {
    if (deps.retryable) return { terminal: false, result: await blockOperation(db, principal, deviceId, batchServerId, mutation, deps.code, deps.message) };
    const result = { operationId: mutation.operationId, sequence: mutation.sequence, status: "rejected", retryable: false, error: { code: deps.code, message: deps.message } };
    return { terminal: true, result: await finishTerminal(db, principal, deviceId, batchServerId, mutation, "rejected", result, deps.code, deps.message) };
  }

  const current = await currentRecordMeta(db, principal.organizationId, mutation.moduleKey, mutation.collectionKey, mutation.recordId);
  const stale = mutation.baseVersion !== current.version;
  const collision = definition.conflictPolicy === "append-only" ? current.version > 0 :
    (definition.conflictPolicy === "server-wins" || definition.conflictPolicy === "reject-stale") && stale;
  if (collision) {
    const conflict = { serverVersion: current.version, serverPayload: current.payload, deleted: current.deleted, serverUpdatedAt: current.serverUpdatedAt };
    const result = { operationId: mutation.operationId, sequence: mutation.sequence, status: "conflict", retryable: false, recordId: mutation.recordId, conflict };
    return { terminal: true, result: await finishTerminal(db, principal, deviceId, batchServerId, mutation, "conflict", result, "VERSION_CONFLICT", "The server record changed after this offline edit was based on it", conflict) };
  }

  const nextVersion = current.version + 1;
  try {
    const prepared = await definition.prepareMutation({ db, principal, organizationId: principal.organizationId, userId: principal.userId, deviceId, currentVersion: current.version, nextVersion }, mutation);
    const payloadJson = mutation.kind === "delete" ? null : JSON.stringify(prepared.serverPayload ?? mutation.payload ?? null);
    const result = {
      operationId: mutation.operationId,
      sequence: mutation.sequence,
      status: "applied",
      retryable: false,
      recordId: mutation.recordId,
      serverVersion: nextVersion,
      serverPayload: mutation.kind === "delete" ? undefined : (prepared.serverPayload ?? mutation.payload ?? null),
      result: prepared.result,
    };
    const casId = createId("cas");
    const statements: D1PreparedStatement[] = [
      db.prepare(`INSERT INTO mobile_sync_cas_checks (check_id,ok) VALUES (?,
        CASE WHEN COALESCE((SELECT version FROM mobile_sync_record_versions
          WHERE organization_id=? AND module_key=? AND collection_key=? AND record_id=?),0)=? THEN 1 ELSE 0 END)`)
        .bind(casId, principal.organizationId, mutation.moduleKey, mutation.collectionKey, mutation.recordId, current.version),
      ...prepared.statements,
      db.prepare(`INSERT INTO mobile_sync_record_versions
        (organization_id,module_key,collection_key,record_id,version,deleted,server_updated_at,last_device_id)
        VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP,?)
        ON CONFLICT(organization_id,module_key,collection_key,record_id) DO UPDATE SET version=excluded.version,deleted=excluded.deleted,
          server_updated_at=CURRENT_TIMESTAMP,last_device_id=excluded.last_device_id`)
        .bind(principal.organizationId, mutation.moduleKey, mutation.collectionKey, mutation.recordId, nextVersion, mutation.kind === "delete" ? 1 : 0, deviceId),
      mutation.kind === "delete"
        ? db.prepare(`INSERT INTO mobile_sync_tombstones (organization_id,module_key,collection_key,record_id,version,deleted_at,device_id)
            VALUES (?,?,?,?,?,CURRENT_TIMESTAMP,?) ON CONFLICT(organization_id,module_key,collection_key,record_id)
            DO UPDATE SET version=excluded.version,deleted_at=CURRENT_TIMESTAMP,device_id=excluded.device_id`)
            .bind(principal.organizationId, mutation.moduleKey, mutation.collectionKey, mutation.recordId, nextVersion, deviceId)
        : db.prepare("DELETE FROM mobile_sync_tombstones WHERE organization_id=? AND module_key=? AND collection_key=? AND record_id=?")
            .bind(principal.organizationId, mutation.moduleKey, mutation.collectionKey, mutation.recordId),
      db.prepare(`INSERT INTO mobile_sync_changes
        (organization_id,module_key,collection_key,record_id,version,operation,payload_json,changed_by,device_id,changed_at)
        VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`)
        .bind(principal.organizationId, mutation.moduleKey, mutation.collectionKey, mutation.recordId, nextVersion, mutation.kind, payloadJson, principal.userId, deviceId),
      db.prepare(`UPDATE mobile_sync_operations SET status='applied',retryable=0,server_version=?,result_json=?,error_code=NULL,error_message=NULL,
        processed_at=CURRENT_TIMESTAMP,attempts=attempts+1 WHERE device_id=? AND operation_uuid=?`)
        .bind(nextVersion, JSON.stringify(result), deviceId, mutation.operationId),
      db.prepare("UPDATE mobile_sync_devices SET last_push_sequence=?,last_seen_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?")
        .bind(mutation.sequence, deviceId, principal.organizationId),
      eventStatement(db, { organizationId: principal.organizationId, deviceId, userId: principal.userId, eventType: "operation.applied", batchId: batchServerId, operationId: mutation.operationId, details: { recordId: mutation.recordId, serverVersion: nextVersion } }),
      auditStatement(db, { organizationId: principal.organizationId, actorId: principal.userId, action: mutation.kind === "delete" ? "mobile.sync_deleted" : "mobile.sync_upserted", entityType: `${mutation.moduleKey}.${mutation.collectionKey}`, entityId: mutation.recordId, after: { deviceId, serverVersion: nextVersion } }),
      db.prepare("DELETE FROM mobile_sync_cas_checks WHERE check_id=?").bind(casId),
    ];
    await db.batch(statements);
    return { terminal: true, result };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    if (raw.includes("mobile_sync_cas_version_match")) {
      const latest = await currentRecordMeta(db, principal.organizationId, mutation.moduleKey, mutation.collectionKey, mutation.recordId);
      const conflict = { serverVersion: latest.version, serverPayload: latest.payload, deleted: latest.deleted, serverUpdatedAt: latest.serverUpdatedAt };
      const result = { operationId: mutation.operationId, sequence: mutation.sequence, status: "conflict", retryable: false, recordId: mutation.recordId, conflict };
      return { terminal: true, result: await finishTerminal(db, principal, deviceId, batchServerId, mutation, "conflict", result, "VERSION_CONFLICT", "The server record changed while this offline mutation was being committed", conflict) };
    }
    const app = error instanceof AppError ? error : null;
    if (app && app.status < 500) {
      const status = app.status === 409 ? "conflict" : "rejected";
      const result = { operationId: mutation.operationId, sequence: mutation.sequence, status, retryable: false, error: { code: app.code, message: app.message, details: app.details } };
      return { terminal: true, result: await finishTerminal(db, principal, deviceId, batchServerId, mutation, status, result, app.code, app.message) };
    }
    const message = error instanceof Error ? error.message : "Temporary synchronization failure";
    return { terminal: false, result: await blockOperation(db, principal, deviceId, batchServerId, mutation, "SYNC_RETRY_REQUIRED", message) };
  }
}

async function operationResult(db: D1Database, deviceId: string, operationId: string) {
  const row = await db.prepare(`SELECT batch_id AS batchId,sequence_number AS sequence,status,retryable,result_json AS result,request_hash AS requestHash
    FROM mobile_sync_operations WHERE device_id=? AND operation_uuid=?`)
    .bind(deviceId, operationId).first<{ batchId: string; sequence: number; status: string; retryable: number; result: string | null; requestHash: string }>();
  return row ? { ...row, result: parse<R | null>(row.result, null) } : null;
}

export function mobileSyncManifest() {
  return {
    protocolVersion: MOBILE_SYNC_PROTOCOL_VERSION,
    maximumPushOperations: MAX_PUSH_OPERATIONS,
    maximumPullLimit: MAX_PULL_LIMIT,
    ordering: "strict-per-device",
    pullCursor: "server-acknowledged-per-collection",
    collections: listMobileSyncCollections().map(c => ({
      moduleKey: c.moduleKey,
      collectionKey: c.collectionKey,
      schemaVersion: c.schemaVersion,
      minClientSchemaVersion: c.minClientSchemaVersion ?? c.schemaVersion,
      mode: c.mode,
      sourceOfTruth: c.sourceOfTruth,
      conflictPolicy: c.conflictPolicy,
      dependsOn: c.dependsOn ?? [],
    })),
  };
}

export async function acknowledgeSchemas(db: D1Database, principal: AuthPrincipal, input: { deviceId: string; schemas: Array<{ moduleKey: string; collectionKey: string; schemaVersion: number }> }) {
  await assertOwnedActiveDevice(db, principal, input.deviceId);
  const statements: D1PreparedStatement[] = [];
  for (const item of input.schemas) {
    const definition = getMobileSyncCollection(item.moduleKey, item.collectionKey);
    if (!definition) throw new AppError(422, "COLLECTION_NOT_REGISTERED", `Unknown mobile-sync collection ${item.moduleKey}:${item.collectionKey}`);
    if (item.schemaVersion !== definition.schemaVersion) {
      throw new AppError(409, "SCHEMA_VERSION_MISMATCH", `Collection ${item.moduleKey}:${item.collectionKey} requires schema ${definition.schemaVersion}`, { requiredSchemaVersion: definition.schemaVersion });
    }
    statements.push(db.prepare(`INSERT INTO mobile_sync_device_schemas (device_id,module_key,collection_key,schema_version,acknowledged_at)
      VALUES (?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(device_id,module_key,collection_key) DO UPDATE SET schema_version=excluded.schema_version,acknowledged_at=CURRENT_TIMESTAMP`)
      .bind(input.deviceId, item.moduleKey, item.collectionKey, item.schemaVersion));
  }
  if (statements.length) await db.batch(statements);
  return { acknowledged: input.schemas.length };
}

export async function push(db: D1Database, principal: AuthPrincipal, input: PushInput) {
  if (input.protocolVersion !== MOBILE_SYNC_PROTOCOL_VERSION) {
    throw new AppError(409, "SYNC_PROTOCOL_MISMATCH", "Mobile sync protocol upgrade required", { requiredProtocolVersion: MOBILE_SYNC_PROTOCOL_VERSION });
  }
  if (!input.operations.length || input.operations.length > MAX_PUSH_OPERATIONS) {
    throw new AppError(422, "INVALID_SYNC_BATCH", `Push batches must contain 1-${MAX_PUSH_OPERATIONS} operations`);
  }
  const device = await assertOwnedActiveDevice(db, principal, input.deviceId);
  const operations = [...input.operations].sort((a, b) => a.sequence - b.sequence);
  for (let i = 1; i < operations.length; i++) {
    if (operations[i]!.sequence === operations[i - 1]!.sequence) throw new AppError(409, "DUPLICATE_SEQUENCE", "A sync batch cannot reuse a sequence number");
  }
  const requestHash = await sha256(stable({ deviceId: input.deviceId, batchId: input.batchId, protocolVersion: input.protocolVersion, operations }));
  let batch = await db.prepare("SELECT id,status,request_hash AS requestHash,result_json AS result FROM mobile_sync_batches WHERE device_id=? AND batch_uuid=?")
    .bind(input.deviceId, input.batchId).first<{ id: string; status: string; requestHash: string; result: string | null }>();
  if (batch && batch.requestHash !== requestHash) throw new AppError(409, "IDEMPOTENCY_MISMATCH", "This batch ID was already used for different synchronization data");
  if (batch?.status === "completed" && batch.result) return parse(batch.result, {} as R);
  if (!batch) {
    const id = createId("msb");
    await db.batch([
      db.prepare(`INSERT INTO mobile_sync_batches (id,organization_id,device_id,batch_uuid,request_hash,status,first_sequence,last_sequence,received_count)
        VALUES (?,?,?,?,?,'processing',?,?,?)`).bind(id, principal.organizationId, input.deviceId, input.batchId, requestHash, operations[0]!.sequence, operations.at(-1)!.sequence, operations.length),
      eventStatement(db, { organizationId: principal.organizationId, deviceId: input.deviceId, userId: principal.userId, eventType: "batch.received", batchId: id, details: { batchUuid: input.batchId, operationCount: operations.length } }),
    ]);
    batch = { id, status: "processing", requestHash, result: null };
  } else {
    await db.prepare("UPDATE mobile_sync_batches SET status='processing',retry_count=retry_count+1,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(batch.id).run();
  }

  let lastSequence = Number(device.lastPushSequence || 0), blocked = false;
  const results: R[] = [];
  for (const mutation of operations) {
    const mutationHash = await sha256(stable(mutation));
    const existing = await operationResult(db, input.deviceId, mutation.operationId);
    if (existing) {
      if (existing.requestHash !== mutationHash || existing.sequence !== mutation.sequence) {
        throw new AppError(409, "IDEMPOTENCY_MISMATCH", `Operation ${mutation.operationId} was already used with different data`);
      }
      if (TERMINAL.has(existing.status) && mutation.sequence <= lastSequence) {
        results.push(existing.result ?? { operationId: mutation.operationId, sequence: mutation.sequence, status: existing.status });
        continue;
      }
      if (!TERMINAL.has(existing.status) && existing.batchId !== batch.id) {
        await db.prepare("UPDATE mobile_sync_operations SET batch_id=? WHERE device_id=? AND operation_uuid=?").bind(batch.id, input.deviceId, mutation.operationId).run();
      }
    } else {
      const sequenceOwner = await db.prepare("SELECT operation_uuid AS operationId FROM mobile_sync_operations WHERE device_id=? AND sequence_number=?")
        .bind(input.deviceId, mutation.sequence).first<{ operationId: string }>();
      if (sequenceOwner && sequenceOwner.operationId !== mutation.operationId) {
        throw new AppError(409, "SEQUENCE_REUSE", `Sequence ${mutation.sequence} is already assigned to another operation`);
      }
      await db.prepare(`INSERT INTO mobile_sync_operations
        (id,organization_id,device_id,batch_id,operation_uuid,request_hash,sequence_number,module_key,collection_key,record_id,operation_kind,
         schema_version,base_version,client_timestamp,payload_json,dependencies_json,status,retryable)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'received',1)`)
        .bind(createId("mso"), principal.organizationId, input.deviceId, batch.id, mutation.operationId, mutationHash, mutation.sequence,
          mutation.moduleKey, mutation.collectionKey, mutation.recordId, mutation.kind, mutation.schemaVersion, mutation.baseVersion,
          mutation.clientTimestamp, mutation.payload == null ? null : JSON.stringify(mutation.payload), JSON.stringify(mutation.dependencies ?? [])).run();
    }

    if (mutation.sequence <= lastSequence) {
      const row = await operationResult(db, input.deviceId, mutation.operationId);
      results.push(row?.result ?? { operationId: mutation.operationId, sequence: mutation.sequence, status: "duplicate" });
      continue;
    }
    if (mutation.sequence !== lastSequence + 1) {
      const result = await blockOperation(db, principal, input.deviceId, batch.id, mutation, "SYNC_SEQUENCE_GAP", `Expected sequence ${lastSequence + 1} before sequence ${mutation.sequence}`);
      results.push(result); blocked = true; break;
    }
    const outcome = await applyOperation(db, principal, input.deviceId, batch.id, mutation);
    results.push(outcome.result);
    if (!outcome.terminal) { blocked = true; break; }
    lastSequence = mutation.sequence;
  }

  const counts = await db.prepare(`SELECT
    SUM(CASE WHEN status='applied' THEN 1 ELSE 0 END) AS applied,
    SUM(CASE WHEN status='conflict' THEN 1 ELSE 0 END) AS conflicts,
    SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) AS rejected,
    SUM(CASE WHEN status='blocked' THEN 1 ELSE 0 END) AS blocked,
    SUM(CASE WHEN status='received' THEN 1 ELSE 0 END) AS received
    FROM mobile_sync_operations WHERE batch_id=?`).bind(batch.id).first<R>();
  const status = blocked || Number(counts?.blocked || 0) > 0 || Number(counts?.received || 0) > 0 ? "partial" : "completed";
  const response = {
    batchId: input.batchId,
    status,
    operations: results,
    nextExpectedSequence: lastSequence + 1,
    counts: {
      applied: Number(counts?.applied || 0),
      conflicts: Number(counts?.conflicts || 0),
      rejected: Number(counts?.rejected || 0),
      blocked: Number(counts?.blocked || 0),
    },
    serverTime: new Date().toISOString(),
  };
  await db.batch([
    db.prepare(`UPDATE mobile_sync_batches SET status=?,applied_count=?,conflict_count=?,rejected_count=?,blocked_count=?,result_json=?,
      completed_at=CASE WHEN ?='completed' THEN CURRENT_TIMESTAMP ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(status, response.counts.applied, response.counts.conflicts, response.counts.rejected, response.counts.blocked, JSON.stringify(response), status, batch.id),
    eventStatement(db, { organizationId: principal.organizationId, deviceId: input.deviceId, userId: principal.userId, eventType: `batch.${status}`, batchId: batch.id, details: response.counts }),
  ]);
  return response;
}

async function genericSnapshot(db: D1Database, organizationId: string, definition: MobileSyncCollectionDefinition, watermark: number): Promise<MobileSyncRecord[]> {
  if (watermark <= 0) return [];
  const result = await db.prepare(`SELECT c.record_id AS id,c.version,c.changed_at AS updatedAt,c.payload_json AS payload
    FROM mobile_sync_changes c
    JOIN (SELECT record_id,MAX(change_id) AS maxId FROM mobile_sync_changes
      WHERE organization_id=? AND module_key=? AND collection_key=? AND change_id<=? GROUP BY record_id) latest
      ON latest.record_id=c.record_id AND latest.maxId=c.change_id
    WHERE c.organization_id=? AND c.module_key=? AND c.collection_key=? AND c.operation<>'delete' ORDER BY c.change_id`)
    .bind(organizationId, definition.moduleKey, definition.collectionKey, watermark, organizationId, definition.moduleKey, definition.collectionKey)
    .all<{ id: string; version: number; updatedAt: string; payload: string | null }>();
  return result.results.map(r => ({ id: r.id, version: Number(r.version), updatedAt: r.updatedAt, payload: parse(r.payload, null as unknown) }));
}

async function seedSnapshotVersions(db: D1Database, organizationId: string, definition: MobileSyncCollectionDefinition, records: MobileSyncRecord[]) {
  const statements = records.filter(r => !r.deleted).map(r => db.prepare(`INSERT OR IGNORE INTO mobile_sync_record_versions
    (organization_id,module_key,collection_key,record_id,version,deleted,server_updated_at)
    VALUES (?,?,?,?,?,0,?)`).bind(organizationId, definition.moduleKey, definition.collectionKey, r.id, Math.max(1, Number(r.version || 1)), r.updatedAt || new Date().toISOString()));
  for (let i = 0; i < statements.length; i += 100) await db.batch(statements.slice(i, i + 100));
}

export async function bootstrap(db: D1Database, principal: AuthPrincipal, input: { deviceId: string; protocolVersion: number; collections: Array<{ moduleKey: string; collectionKey: string }> }) {
  if (input.protocolVersion !== MOBILE_SYNC_PROTOCOL_VERSION) {
    throw new AppError(409, "SYNC_PROTOCOL_MISMATCH", "Mobile sync protocol upgrade required", { requiredProtocolVersion: MOBILE_SYNC_PROTOCOL_VERSION });
  }
  await assertOwnedActiveDevice(db, principal, input.deviceId);
  const bootstrapId = createId("msx"), watermarks: Record<string, number> = {}, payload: R[] = [];
  for (const requested of input.collections) {
    const definition = getMobileSyncCollection(requested.moduleKey, requested.collectionKey);
    if (!definition) throw new AppError(422, "COLLECTION_NOT_REGISTERED", `Unknown mobile-sync collection ${requested.moduleKey}:${requested.collectionKey}`);
    if (!hasScope(principal, definition.pullScope)) throw new AppError(403, "SYNC_PERMISSION_DENIED", `Missing permission required to read ${collectionKey(definition)}`);
    if (!await requireSchemaReady(db, input.deviceId, definition)) {
      throw new AppError(409, "SCHEMA_MIGRATION_REQUIRED", `Acknowledge schema ${definition.schemaVersion} before bootstrapping ${collectionKey(definition)}`);
    }
    const watermarkRow = await db.prepare(`SELECT COALESCE(MAX(change_id),0) AS watermark FROM mobile_sync_changes
      WHERE organization_id=? AND module_key=? AND collection_key=?`).bind(principal.organizationId, definition.moduleKey, definition.collectionKey).first<{ watermark: number }>();
    const watermark = Number(watermarkRow?.watermark || 0);
    watermarks[collectionKey(definition)] = watermark;
    const rawRecords = definition.snapshot
      ? await definition.snapshot({ db, principal, organizationId: principal.organizationId, userId: principal.userId, deviceId: input.deviceId, watermark })
      : await genericSnapshot(db, principal.organizationId, definition, watermark);
    const records = rawRecords.map(r => ({ ...r, version: Math.max(1, Number(r.version || 1)) }));
    await seedSnapshotVersions(db, principal.organizationId, definition, records);
    payload.push({ moduleKey: definition.moduleKey, collectionKey: definition.collectionKey, schemaVersion: definition.schemaVersion, watermark, records });
  }
  await db.batch([
    db.prepare(`INSERT INTO mobile_sync_bootstraps (id,organization_id,device_id,status,watermarks_json,collection_count)
      VALUES (?,?,?,'pending',?,?)`).bind(bootstrapId, principal.organizationId, input.deviceId, JSON.stringify(watermarks), payload.length),
    eventStatement(db, { organizationId: principal.organizationId, deviceId: input.deviceId, userId: principal.userId, eventType: "bootstrap.created", details: { bootstrapId, collections: payload.length } }),
  ]);
  return { bootstrapId, status: "pending", collections: payload, serverTime: new Date().toISOString() };
}

export async function acknowledgeBootstrap(db: D1Database, principal: AuthPrincipal, input: { deviceId: string; bootstrapId: string }) {
  await assertOwnedActiveDevice(db, principal, input.deviceId);
  const row = await db.prepare("SELECT status,watermarks_json AS watermarks FROM mobile_sync_bootstraps WHERE id=? AND device_id=? AND organization_id=?")
    .bind(input.bootstrapId, input.deviceId, principal.organizationId).first<{ status: string; watermarks: string }>();
  if (!row) throw new AppError(404, "BOOTSTRAP_NOT_FOUND", "Bootstrap session not found");
  if (row.status === "acknowledged") return { bootstrapId: input.bootstrapId, status: "acknowledged" };
  const watermarks = parse<Record<string, number>>(row.watermarks, {}), statements: D1PreparedStatement[] = [];
  for (const [key, watermark] of Object.entries(watermarks)) {
    const split = key.indexOf(":"), moduleKey = key.slice(0, split), collection = key.slice(split + 1);
    statements.push(db.prepare(`INSERT INTO mobile_sync_pull_state (device_id,module_key,collection_key,last_acked_change_id,updated_at)
      VALUES (?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(device_id,module_key,collection_key) DO UPDATE SET
      last_acked_change_id=CASE WHEN excluded.last_acked_change_id>last_acked_change_id THEN excluded.last_acked_change_id ELSE last_acked_change_id END,updated_at=CURRENT_TIMESTAMP`)
      .bind(input.deviceId, moduleKey, collection, Number(watermark)));
  }
  statements.push(
    db.prepare("UPDATE mobile_sync_bootstraps SET status='acknowledged',acknowledged_at=CURRENT_TIMESTAMP WHERE id=? AND device_id=?").bind(input.bootstrapId, input.deviceId),
    eventStatement(db, { organizationId: principal.organizationId, deviceId: input.deviceId, userId: principal.userId, eventType: "bootstrap.acknowledged", details: { bootstrapId: input.bootstrapId } }),
  );
  await db.batch(statements);
  return { bootstrapId: input.bootstrapId, status: "acknowledged" };
}

function mapChange(row: R) {
  return {
    changeId: Number(row.changeId), recordId: row.recordId, version: Number(row.version), operation: row.operation,
    deleted: row.operation === "delete", payload: parse(row.payload, null as unknown), changedAt: row.changedAt,
  };
}

export async function pull(db: D1Database, principal: AuthPrincipal, input: PullInput) {
  if (input.protocolVersion !== MOBILE_SYNC_PROTOCOL_VERSION) {
    throw new AppError(409, "SYNC_PROTOCOL_MISMATCH", "Mobile sync protocol upgrade required", { requiredProtocolVersion: MOBILE_SYNC_PROTOCOL_VERSION });
  }
  await assertOwnedActiveDevice(db, principal, input.deviceId);
  const collections: R[] = [];
  for (const requested of input.collections) {
    const definition = getMobileSyncCollection(requested.moduleKey, requested.collectionKey);
    if (!definition) { collections.push({ ...requested, error: { code: "COLLECTION_NOT_REGISTERED" } }); continue; }
    if (!hasScope(principal, definition.pullScope)) { collections.push({ ...requested, error: { code: "SYNC_PERMISSION_DENIED" } }); continue; }
    if (!await requireSchemaReady(db, input.deviceId, definition)) {
      collections.push({ moduleKey: definition.moduleKey, collectionKey: definition.collectionKey, schemaRequired: definition.schemaVersion, changes: [] });
      continue;
    }
    const existing = await db.prepare(`SELECT id,from_change_id AS fromChangeId,to_change_id AS toChangeId,status
      FROM mobile_sync_pull_deliveries WHERE device_id=? AND request_id=? AND module_key=? AND collection_key=?`)
      .bind(input.deviceId, input.requestId, definition.moduleKey, definition.collectionKey).first<{ id: string; fromChangeId: number; toChangeId: number; status: string }>();
    let from = 0, to = 0, deliveryId: string | null = null, rows: R[] = [];
    if (existing) {
      from = Number(existing.fromChangeId); to = Number(existing.toChangeId); deliveryId = existing.id;
      const delivered = await db.prepare(`SELECT change_id AS changeId,record_id AS recordId,version,operation,payload_json AS payload,changed_at AS changedAt
        FROM mobile_sync_changes WHERE organization_id=? AND module_key=? AND collection_key=? AND change_id>? AND change_id<=? ORDER BY change_id`)
        .bind(principal.organizationId, definition.moduleKey, definition.collectionKey, from, to).all<R>();
      rows = delivered.results;
    } else {
      const state = await db.prepare(`SELECT last_acked_change_id AS cursor FROM mobile_sync_pull_state
        WHERE device_id=? AND module_key=? AND collection_key=?`).bind(input.deviceId, definition.moduleKey, definition.collectionKey).first<{ cursor: number }>();
      from = Number(state?.cursor || 0);
      const limit = Math.max(1, Math.min(MAX_PULL_LIMIT, Number(requested.limit || 500)));
      const result = await db.prepare(`SELECT change_id AS changeId,record_id AS recordId,version,operation,payload_json AS payload,changed_at AS changedAt
        FROM mobile_sync_changes WHERE organization_id=? AND module_key=? AND collection_key=? AND change_id>? ORDER BY change_id LIMIT ?`)
        .bind(principal.organizationId, definition.moduleKey, definition.collectionKey, from, limit).all<R>();
      rows = result.results; to = rows.length ? Number(rows.at(-1)!.changeId) : from;
      if (rows.length) {
        deliveryId = createId("msdly");
        await db.prepare(`INSERT INTO mobile_sync_pull_deliveries
          (id,organization_id,device_id,request_id,module_key,collection_key,from_change_id,to_change_id,payload_count,status)
          VALUES (?,?,?,?,?,?,?,?,?,'pending')`)
          .bind(deliveryId, principal.organizationId, input.deviceId, input.requestId, definition.moduleKey, definition.collectionKey, from, to, rows.length).run();
      }
    }
    const max = await db.prepare(`SELECT COALESCE(MAX(change_id),0) AS maxId FROM mobile_sync_changes
      WHERE organization_id=? AND module_key=? AND collection_key=?`).bind(principal.organizationId, definition.moduleKey, definition.collectionKey).first<{ maxId: number }>();
    collections.push({
      moduleKey: definition.moduleKey,
      collectionKey: definition.collectionKey,
      schemaVersion: definition.schemaVersion,
      deliveryId,
      fromCursor: from,
      nextCursor: to,
      hasMore: to < Number(max?.maxId || 0),
      changes: rows.map(mapChange),
    });
  }
  return { requestId: input.requestId, collections, serverTime: new Date().toISOString() };
}

export async function acknowledgePull(db: D1Database, principal: AuthPrincipal, input: { deviceId: string; acknowledgements: Array<{ deliveryId: string; cursor: number }> }) {
  await assertOwnedActiveDevice(db, principal, input.deviceId);
  const statements: D1PreparedStatement[] = [];
  for (const ack of input.acknowledgements) {
    const delivery = await db.prepare(`SELECT module_key AS moduleKey,collection_key AS collectionKey,to_change_id AS toChangeId,status
      FROM mobile_sync_pull_deliveries WHERE id=? AND device_id=? AND organization_id=?`).bind(ack.deliveryId, input.deviceId, principal.organizationId)
      .first<{ moduleKey: string; collectionKey: string; toChangeId: number; status: string }>();
    if (!delivery) throw new AppError(404, "PULL_DELIVERY_NOT_FOUND", `Pull delivery ${ack.deliveryId} not found`);
    if (Number(ack.cursor) !== Number(delivery.toChangeId)) throw new AppError(409, "PULL_CURSOR_MISMATCH", "Only the exact delivered cursor can be acknowledged");
    if (delivery.status === "acknowledged") continue;
    statements.push(
      db.prepare(`INSERT INTO mobile_sync_pull_state (device_id,module_key,collection_key,last_acked_change_id,updated_at)
        VALUES (?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(device_id,module_key,collection_key) DO UPDATE SET
        last_acked_change_id=CASE WHEN excluded.last_acked_change_id>last_acked_change_id THEN excluded.last_acked_change_id ELSE last_acked_change_id END,updated_at=CURRENT_TIMESTAMP`)
        .bind(input.deviceId, delivery.moduleKey, delivery.collectionKey, Number(delivery.toChangeId)),
      db.prepare("UPDATE mobile_sync_pull_deliveries SET status='acknowledged',acknowledged_at=CURRENT_TIMESTAMP WHERE id=? AND device_id=?").bind(ack.deliveryId, input.deviceId),
    );
  }
  if (statements.length) await db.batch(statements);
  return { acknowledged: input.acknowledgements.length };
}

export async function recoveryState(db: D1Database, principal: AuthPrincipal, deviceId: string, batchUuid?: string) {
  const device = await assertOwnedActiveDevice(db, principal, deviceId);
  const batches = await db.prepare(`SELECT id,batch_uuid AS batchId,status,first_sequence AS firstSequence,last_sequence AS lastSequence,
    received_count AS receivedCount,applied_count AS appliedCount,conflict_count AS conflictCount,rejected_count AS rejectedCount,blocked_count AS blockedCount,
    retry_count AS retryCount,received_at AS receivedAt,updated_at AS updatedAt
    FROM mobile_sync_batches WHERE device_id=? ${batchUuid ? "AND batch_uuid=?" : "AND status<>'completed'"} ORDER BY received_at DESC LIMIT 20`)
    .bind(deviceId, ...(batchUuid ? [batchUuid] : [])).all<R>();
  const batchDetails: R[] = [];
  for (const batch of batches.results) {
    const ops = await db.prepare(`SELECT operation_uuid AS operationId,sequence_number AS sequence,module_key AS moduleKey,collection_key AS collectionKey,
      record_id AS recordId,status,retryable,server_version AS serverVersion,error_code AS errorCode,error_message AS errorMessage,attempts
      FROM mobile_sync_operations WHERE batch_id=? ORDER BY sequence_number`).bind(batch.id).all<R>();
    batchDetails.push({ ...batch, operations: ops.results });
  }
  const deliveries = await db.prepare(`SELECT id AS deliveryId,request_id AS requestId,module_key AS moduleKey,collection_key AS collectionKey,
    from_change_id AS fromCursor,to_change_id AS toCursor,payload_count AS payloadCount,created_at AS createdAt
    FROM mobile_sync_pull_deliveries WHERE device_id=? AND status='pending' ORDER BY created_at`).bind(deviceId).all<R>();
  const schemas = await db.prepare(`SELECT module_key AS moduleKey,collection_key AS collectionKey,schema_version AS schemaVersion,acknowledged_at AS acknowledgedAt
    FROM mobile_sync_device_schemas WHERE device_id=? ORDER BY module_key,collection_key`).bind(deviceId).all<R>();
  const cursors = await db.prepare(`SELECT module_key AS moduleKey,collection_key AS collectionKey,last_acked_change_id AS cursor,updated_at AS updatedAt
    FROM mobile_sync_pull_state WHERE device_id=? ORDER BY module_key,collection_key`).bind(deviceId).all<R>();
  return {
    deviceId,
    lastPushSequence: Number(device.lastPushSequence || 0),
    nextExpectedSequence: Number(device.lastPushSequence || 0) + 1,
    batches: batchDetails,
    pendingPullDeliveries: deliveries.results,
    schemas: schemas.results,
    pullCursors: cursors.results,
    serverTime: new Date().toISOString(),
  };
}
