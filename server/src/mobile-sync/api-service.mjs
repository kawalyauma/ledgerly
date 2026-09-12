import { createId, randomToken, sha256 } from "../auth/crypto.mjs";

const PROTOCOL_VERSION = 1;
const OFFLINE_GRANT_DAYS = 400;
const MAX_PUSH = 250;
const MAX_PULL = 1000;

function fail(status, code, message, details = undefined) {
  throw Object.assign(new Error(message), { status, code, details });
}
function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function bool(value) { return value === true || value === 1 || value === "1"; }
function parse(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}
function key(definition) { return `${definition.moduleKey}:${definition.collectionKey}`; }
function schemaVersion(definition) { return Number(definition.schemaVersion ?? 1) || 1; }
function mode(definition) { return definition.mode ?? (typeof definition.apply === "function" ? "read-write" : "read-only"); }
function conflictPolicy(definition) { return definition.conflictPolicy ?? (typeof definition.apply === "function" ? "reject-stale" : "server-wins"); }
function sourceOfTruth(definition) { return definition.sourceOfTruth ?? "server"; }
function definitionManifest(definition) {
  const version = schemaVersion(definition);
  return {
    moduleKey: definition.moduleKey,
    collectionKey: definition.collectionKey,
    schemaVersion: version,
    minClientSchemaVersion: Number(definition.minClientSchemaVersion ?? version) || version,
    mode: mode(definition),
    sourceOfTruth: sourceOfTruth(definition),
    conflictPolicy: conflictPolicy(definition),
    dependsOn: Array.isArray(definition.dependsOn) ? definition.dependsOn : [],
  };
}

export function createMobileSyncApiService({ database, service, collections, audit = null }) {
  if (!database?.query || !database?.transaction) throw new TypeError("mobile sync API requires database");
  if (!service) throw new TypeError("mobile sync API requires service");
  const list = [...(collections ?? [])];
  const byKey = new Map(list.map((item) => [key(item), item]));

  async function device(principal, deviceId, { active = true } = {}) {
    const result = await database.query(
      `SELECT id,organization_id AS "organizationId",user_id AS "userId",installation_id AS "installationId",device_name AS "deviceName",platform,
        device_model AS "deviceModel",os_version AS "osVersion",app_version AS "appVersion",client_schema_version AS "clientSchemaVersion",
        status,last_push_sequence AS "lastPushSequence",last_seen_at AS "lastSeenAt",revoked_at AS "revokedAt",created_at AS "createdAt"
       FROM mobile_sync_devices WHERE id=$1 AND organization_id=$2`,
      [deviceId, principal.organizationId],
    );
    const row = result.rows[0];
    if (!row) fail(404, "DEVICE_NOT_FOUND", "Mobile device not found");
    if (principal.mobileDeviceId && principal.mobileDeviceId !== row.id) fail(403, "MOBILE_DEVICE_TOKEN_MISMATCH", "This access token is bound to a different device");
    if (row.userId !== principal.userId && principal.role !== "owner" && principal.role !== "admin") fail(403, "DEVICE_USER_MISMATCH", "This device belongs to a different user");
    if (active && row.status !== "active") fail(403, "DEVICE_NOT_ACTIVE", "This mobile device is revoked or inactive");
    return row;
  }

  async function schemaReady(deviceId, definition) {
    const result = await database.query(
      `SELECT schema_version AS "schemaVersion" FROM mobile_sync_device_schemas WHERE device_id=$1 AND module_key=$2 AND collection_key=$3`,
      [deviceId, definition.moduleKey, definition.collectionKey],
    );
    return Number(result.rows[0]?.schemaVersion ?? 0) === schemaVersion(definition);
  }

  async function emitAudit({ principal, action, entityType, entityId, after = undefined, reason = undefined, requestId = undefined }) {
    if (!audit) return;
    await audit.write({
      organizationId: principal.organizationId,
      actorType: "human",
      actorId: principal.userId,
      action,
      entityType,
      entityId,
      after,
      reason,
      requestId,
    });
  }

  return Object.freeze({
    provider: "postgresql-mobile-sync-api",

    manifest() {
      return {
        protocolVersion: PROTOCOL_VERSION,
        maximumPushOperations: MAX_PUSH,
        maximumPullLimit: MAX_PULL,
        ordering: "strict-per-device",
        pullCursor: "server-acknowledged-per-collection",
        collections: list.map(definitionManifest),
      };
    },

    async eligible(principal, deviceId) {
      await device(principal, deviceId);
      const eligible = [];
      for (const definition of list) {
        if (typeof definition.canRead === "function") {
          try {
            const allowed = await definition.canRead({ organizationId: principal.organizationId, userId: principal.userId, deviceId, recordId: null, change: null });
            if (allowed === false) continue;
          } catch {
            // Record-specific authorization cannot be evaluated without a record. Keep the collection eligible;
            // per-record filtering is still enforced by the pull service.
          }
        }
        eligible.push(definitionManifest(definition));
      }
      return { deviceId, collections: eligible };
    },

    async registerDevice(principal, input, { requestId = undefined } = {}) {
      const installationId = String(input?.installationId ?? "").trim();
      const deviceName = String(input?.deviceName ?? "").trim();
      const platform = String(input?.platform ?? "").trim().toLowerCase();
      const appVersion = String(input?.appVersion ?? "").trim();
      const clientSchemaVersion = Number(input?.clientSchemaVersion);
      if (installationId.length < 8 || !deviceName || !["android", "ios"].includes(platform) || !appVersion || !Number.isInteger(clientSchemaVersion) || clientSchemaVersion < 1) {
        fail(422, "VALIDATION_ERROR", "Invalid mobile device registration");
      }
      const token = randomToken(48);
      const tokenHash = sha256(token);
      const result = await database.transaction(async (tx) => {
        const existing = await tx.query(
          `SELECT id,status FROM mobile_sync_devices WHERE organization_id=$1 AND user_id=$2 AND installation_id=$3 FOR UPDATE`,
          [principal.organizationId, principal.userId, installationId],
        );
        if (existing.rows[0]?.status === "revoked") fail(403, "DEVICE_REVOKED", "This mobile installation was revoked. Reset the app installation before registering it again.");
        const deviceId = existing.rows[0]?.id ?? createId("msd");
        if (existing.rows[0]) {
          await tx.query(
            `UPDATE mobile_sync_devices SET device_name=$1,platform=$2,app_version=$3,client_schema_version=$4,device_model=$5,os_version=$6,
             status='active',last_seen_at=now(),updated_at=now() WHERE id=$7 AND organization_id=$8 AND user_id=$9`,
            [deviceName, platform, appVersion, clientSchemaVersion, input?.deviceModel ?? null, input?.osVersion ?? null, deviceId, principal.organizationId, principal.userId],
          );
        } else {
          await tx.query(
            `INSERT INTO mobile_sync_devices(id,organization_id,user_id,installation_id,device_name,platform,app_version,client_schema_version,device_model,os_version,status,last_seen_at)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',now())`,
            [deviceId, principal.organizationId, principal.userId, installationId, deviceName, platform, appVersion, clientSchemaVersion, input?.deviceModel ?? null, input?.osVersion ?? null],
          );
        }
        await tx.query("UPDATE mobile_offline_grants SET revoked_at=now(),rotated_at=now() WHERE device_id=$1 AND revoked_at IS NULL", [deviceId]);
        const grantId = createId("mog");
        const grant = await tx.query(
          `INSERT INTO mobile_offline_grants(id,device_id,token_hash,expires_at) VALUES($1,$2,$3,now()+($4 * interval '1 day')) RETURNING expires_at AS "expiresAt"`,
          [grantId, deviceId, tokenHash, OFFLINE_GRANT_DAYS],
        );
        return { deviceId, expiresAt: grant.rows[0]?.expiresAt };
      });
      await emitAudit({ principal, action: "mobile.device_registered", entityType: "mobile_sync_device", entityId: result.deviceId, after: { installationId, platform }, requestId });
      return {
        deviceId: result.deviceId,
        installationId,
        protocolVersion: PROTOCOL_VERSION,
        offlineGrant: token,
        offlineGrantExpiresAt: result.expiresAt,
        offlineGrantDays: OFFLINE_GRANT_DAYS,
      };
    },

    async listDevices(principal) {
      const allUsers = principal.role === "owner" || principal.role === "admin";
      const params = [principal.organizationId];
      const clause = allUsers ? "" : "AND user_id=$2";
      if (!allUsers) params.push(principal.userId);
      const result = await database.query(
        `SELECT id,user_id AS "userId",installation_id AS "installationId",device_name AS "deviceName",platform,device_model AS "deviceModel",
          os_version AS "osVersion",app_version AS "appVersion",client_schema_version AS "clientSchemaVersion",status,last_push_sequence AS "lastPushSequence",
          last_seen_at AS "lastSeenAt",revoked_at AS "revokedAt",created_at AS "createdAt"
         FROM mobile_sync_devices WHERE organization_id=$1 ${clause} ORDER BY last_seen_at DESC NULLS LAST,created_at DESC`,
        params,
      );
      return result.rows;
    },

    async revokeDevice(principal, deviceId, reason, { requestId = undefined } = {}) {
      const row = await device(principal, deviceId, { active: false });
      await database.transaction(async (tx) => {
        await tx.query("UPDATE mobile_sync_devices SET status='revoked',revoked_at=now(),updated_at=now() WHERE id=$1 AND organization_id=$2", [deviceId, principal.organizationId]);
        await tx.query("UPDATE mobile_offline_grants SET revoked_at=now() WHERE device_id=$1 AND revoked_at IS NULL", [deviceId]);
      });
      await emitAudit({ principal, action: "mobile.device_revoked", entityType: "mobile_sync_device", entityId: deviceId, after: { previousStatus: row.status }, reason: reason ?? null, requestId });
      return { deviceId, status: "revoked" };
    },

    async acknowledgeSchemas(principal, input) {
      await device(principal, input.deviceId);
      if (!Array.isArray(input.schemas) || !input.schemas.length) fail(422, "VALIDATION_ERROR", "schemas are required");
      await database.transaction(async (tx) => {
        for (const item of input.schemas) {
          const definition = byKey.get(`${item.moduleKey}:${item.collectionKey}`);
          if (!definition) fail(422, "COLLECTION_NOT_REGISTERED", `Unknown mobile-sync collection ${item.moduleKey}:${item.collectionKey}`);
          const required = schemaVersion(definition);
          if (Number(item.schemaVersion) !== required) fail(409, "SCHEMA_VERSION_MISMATCH", `Collection ${key(definition)} requires schema ${required}`, { requiredSchemaVersion: required });
          await tx.query(
            `INSERT INTO mobile_sync_device_schemas(device_id,module_key,collection_key,schema_version,acknowledged_at)
             VALUES($1,$2,$3,$4,now()) ON CONFLICT(device_id,module_key,collection_key) DO UPDATE SET schema_version=excluded.schema_version,acknowledged_at=now()`,
            [input.deviceId, definition.moduleKey, definition.collectionKey, required],
          );
        }
      });
      return { acknowledged: input.schemas.length };
    },

    async push(principal, input) {
      if (Number(input?.protocolVersion) !== PROTOCOL_VERSION) fail(409, "SYNC_PROTOCOL_MISMATCH", "Mobile sync protocol upgrade required", { requiredProtocolVersion: PROTOCOL_VERSION });
      if (!Array.isArray(input?.operations) || input.operations.length < 1 || input.operations.length > MAX_PUSH) fail(422, "INVALID_SYNC_BATCH", `Push batches must contain 1-${MAX_PUSH} operations`);
      await device(principal, input.deviceId);
      const seen = new Set();
      const operations = [...input.operations].sort((a, b) => Number(a.sequence) - Number(b.sequence));
      for (const operation of operations) {
        const sequence = Number(operation.sequence);
        if (!Number.isInteger(sequence) || sequence < 1) fail(422, "VALIDATION_ERROR", "Every mobile sync operation needs a positive sequence");
        if (seen.has(sequence)) fail(409, "DUPLICATE_SEQUENCE", "A sync batch cannot reuse a sequence number");
        seen.add(sequence);
        const definition = byKey.get(`${operation.moduleKey}:${operation.collectionKey}`);
        if (!definition) continue;
        if (!await schemaReady(input.deviceId, definition)) fail(409, "SCHEMA_MIGRATION_REQUIRED", `Acknowledge schema ${schemaVersion(definition)} before synchronizing ${key(definition)}`);
        for (const dependency of Array.isArray(operation.dependencies) ? operation.dependencies : []) {
          if (dependency.operationId) {
            const dep = await database.query("SELECT status FROM mobile_sync_operations WHERE device_id=$1 AND operation_uuid=$2", [input.deviceId, dependency.operationId]);
            if (!["applied", "duplicate"].includes(String(dep.rows[0]?.status ?? ""))) fail(409, "DEPENDENCY_PENDING", `Operation dependency ${dependency.operationId} has not applied successfully`);
          } else if (dependency.moduleKey && dependency.collectionKey && dependency.recordId) {
            const dep = await database.query(
              `SELECT version,deleted FROM mobile_sync_record_versions WHERE organization_id=$1 AND module_key=$2 AND collection_key=$3 AND record_id=$4`,
              [principal.organizationId, dependency.moduleKey, dependency.collectionKey, dependency.recordId],
            );
            if (!dep.rows[0] || bool(dep.rows[0].deleted) || Number(dep.rows[0].version) < Number(dependency.minVersion ?? 1)) fail(409, "RECORD_DEPENDENCY_PENDING", `Required record ${dependency.moduleKey}/${dependency.collectionKey}/${dependency.recordId} is not available yet`);
          }
        }
      }
      const result = await service.push({
        organizationId: principal.organizationId,
        userId: principal.userId,
        deviceId: input.deviceId,
        batchUuid: String(input.batchId ?? ""),
        operations: operations.map((operation) => ({
          operationUuid: operation.operationId,
          sequenceNumber: Number(operation.sequence),
          moduleKey: operation.moduleKey,
          collectionKey: operation.collectionKey,
          recordId: operation.recordId,
          kind: operation.kind,
          schemaVersion: Number(operation.schemaVersion ?? 1),
          baseVersion: Number(operation.baseVersion ?? 0),
          clientTimestamp: operation.clientTimestamp,
          payload: operation.payload,
        })),
      });
      const mapped = (result.results ?? []).map((row, index) => ({
        operationId: row.operationUuid ?? operations[index]?.operationId,
        sequence: Number(operations[index]?.sequence ?? 0),
        status: row.status,
        retryable: false,
        serverVersion: row.serverVersion == null ? undefined : Number(row.serverVersion),
        result: row.result,
        error: row.errorCode ? { code: row.errorCode, message: row.errorMessage } : undefined,
      }));
      const counts = mapped.reduce((acc, row) => { acc[row.status] = (acc[row.status] ?? 0) + 1; return acc; }, {});
      const state = await database.query("SELECT last_push_sequence AS sequence FROM mobile_sync_devices WHERE id=$1 AND organization_id=$2", [input.deviceId, principal.organizationId]);
      return {
        batchId: input.batchId,
        status: (counts.rejected || counts.conflict) ? "partial" : "completed",
        operations: mapped,
        nextExpectedSequence: Number(state.rows[0]?.sequence ?? 0) + 1,
        counts: { applied: counts.applied ?? 0, conflicts: counts.conflict ?? 0, rejected: counts.rejected ?? 0, blocked: 0 },
        serverTime: new Date().toISOString(),
      };
    },

    async bootstrap(principal, input) {
      if (Number(input?.protocolVersion) !== PROTOCOL_VERSION) fail(409, "SYNC_PROTOCOL_MISMATCH", "Mobile sync protocol upgrade required", { requiredProtocolVersion: PROTOCOL_VERSION });
      await device(principal, input.deviceId);
      if (!Array.isArray(input.collections) || !input.collections.length) fail(422, "VALIDATION_ERROR", "collections are required");
      const bootstrapId = createId("msx");
      const watermarks = {};
      const payload = [];
      for (const requested of input.collections) {
        const definition = byKey.get(`${requested.moduleKey}:${requested.collectionKey}`);
        if (!definition) fail(422, "COLLECTION_NOT_REGISTERED", `Unknown mobile-sync collection ${requested.moduleKey}:${requested.collectionKey}`);
        if (!await schemaReady(input.deviceId, definition)) fail(409, "SCHEMA_MIGRATION_REQUIRED", `Acknowledge schema ${schemaVersion(definition)} before bootstrapping ${key(definition)}`);
        const max = await database.query(`SELECT COALESCE(MAX(change_id),0) AS watermark FROM mobile_sync_changes WHERE organization_id=$1 AND module_key=$2 AND collection_key=$3`, [principal.organizationId, definition.moduleKey, definition.collectionKey]);
        const watermark = Number(max.rows[0]?.watermark ?? 0);
        watermarks[key(definition)] = watermark;
        const snapshot = await database.query(
          `SELECT c.record_id AS id,c.version,c.changed_at AS "updatedAt",c.payload_json AS payload
           FROM mobile_sync_changes c JOIN (
             SELECT record_id,MAX(change_id) AS max_id FROM mobile_sync_changes
             WHERE organization_id=$1 AND module_key=$2 AND collection_key=$3 AND change_id<=$4 GROUP BY record_id
           ) latest ON latest.record_id=c.record_id AND latest.max_id=c.change_id
           WHERE c.organization_id=$1 AND c.module_key=$2 AND c.collection_key=$3 AND c.operation<>'delete' ORDER BY c.change_id`,
          [principal.organizationId, definition.moduleKey, definition.collectionKey, watermark],
        );
        const records = snapshot.rows.map((row) => ({ id: row.id, version: Math.max(1, Number(row.version ?? 1)), updatedAt: row.updatedAt, payload: parse(row.payload, null) }));
        payload.push({ moduleKey: definition.moduleKey, collectionKey: definition.collectionKey, schemaVersion: schemaVersion(definition), watermark, records });
      }
      await database.query(
        `INSERT INTO mobile_sync_bootstraps(id,organization_id,device_id,status,watermarks_json,collection_count) VALUES($1,$2,$3,'pending',$4,$5)`,
        [bootstrapId, principal.organizationId, input.deviceId, JSON.stringify(watermarks), payload.length],
      );
      return { bootstrapId, status: "pending", collections: payload, serverTime: new Date().toISOString() };
    },

    async acknowledgeBootstrap(principal, input) {
      await device(principal, input.deviceId);
      const found = await database.query(`SELECT status,watermarks_json AS watermarks FROM mobile_sync_bootstraps WHERE id=$1 AND device_id=$2 AND organization_id=$3`, [input.bootstrapId, input.deviceId, principal.organizationId]);
      const row = found.rows[0];
      if (!row) fail(404, "BOOTSTRAP_NOT_FOUND", "Bootstrap session not found");
      if (row.status === "acknowledged") return { bootstrapId: input.bootstrapId, status: "acknowledged" };
      const watermarks = parse(row.watermarks, {});
      await database.transaction(async (tx) => {
        for (const [compound, watermark] of Object.entries(watermarks)) {
          const split = compound.indexOf(":");
          const moduleKey = compound.slice(0, split), collectionKey = compound.slice(split + 1);
          await tx.query(
            `INSERT INTO mobile_sync_pull_state(device_id,module_key,collection_key,last_acked_change_id,updated_at) VALUES($1,$2,$3,$4,now())
             ON CONFLICT(device_id,module_key,collection_key) DO UPDATE SET last_acked_change_id=GREATEST(mobile_sync_pull_state.last_acked_change_id,excluded.last_acked_change_id),updated_at=now()`,
            [input.deviceId, moduleKey, collectionKey, Number(watermark)],
          );
        }
        await tx.query("UPDATE mobile_sync_bootstraps SET status='acknowledged',acknowledged_at=now() WHERE id=$1 AND device_id=$2", [input.bootstrapId, input.deviceId]);
      });
      return { bootstrapId: input.bootstrapId, status: "acknowledged" };
    },

    async pull(principal, input) {
      if (Number(input?.protocolVersion) !== PROTOCOL_VERSION) fail(409, "SYNC_PROTOCOL_MISMATCH", "Mobile sync protocol upgrade required", { requiredProtocolVersion: PROTOCOL_VERSION });
      await device(principal, input.deviceId);
      const result = [];
      for (const requested of input.collections ?? []) {
        const definition = byKey.get(`${requested.moduleKey}:${requested.collectionKey}`);
        if (!definition) { result.push({ ...requested, error: { code: "COLLECTION_NOT_REGISTERED" } }); continue; }
        if (!await schemaReady(input.deviceId, definition)) { result.push({ moduleKey: definition.moduleKey, collectionKey: definition.collectionKey, schemaRequired: schemaVersion(definition), changes: [] }); continue; }
        const state = await database.query(`SELECT last_acked_change_id AS cursor FROM mobile_sync_pull_state WHERE device_id=$1 AND module_key=$2 AND collection_key=$3`, [input.deviceId, definition.moduleKey, definition.collectionKey]);
        const cursor = Number(state.rows[0]?.cursor ?? 0);
        const pulled = await service.pull({
          organizationId: principal.organizationId,
          userId: principal.userId,
          deviceId: input.deviceId,
          moduleKey: definition.moduleKey,
          collectionKey: definition.collectionKey,
          cursor,
          limit: Math.min(MAX_PULL, Math.max(1, Number(requested.limit ?? 500))),
          requestId: String(input.requestId ?? createId("msr")),
        });
        result.push({
          moduleKey: definition.moduleKey,
          collectionKey: definition.collectionKey,
          schemaVersion: schemaVersion(definition),
          deliveryId: pulled.deliveryId,
          fromCursor: cursor,
          nextCursor: Number(pulled.cursor),
          hasMore: Boolean(pulled.hasMore),
          changes: (pulled.items ?? []).map((item) => ({ ...item, deleted: item.operation === "delete" })),
        });
      }
      return { requestId: input.requestId, collections: result, serverTime: new Date().toISOString() };
    },

    async acknowledgePull(principal, input) {
      await device(principal, input.deviceId);
      const acknowledgements = Array.isArray(input.acknowledgements) ? input.acknowledgements : [];
      for (const ack of acknowledgements) {
        const delivery = await database.query(`SELECT to_change_id AS cursor FROM mobile_sync_pull_deliveries WHERE id=$1 AND device_id=$2 AND organization_id=$3`, [ack.deliveryId, input.deviceId, principal.organizationId]);
        if (!delivery.rows[0]) fail(404, "PULL_DELIVERY_NOT_FOUND", `Pull delivery ${ack.deliveryId} not found`);
        if (Number(delivery.rows[0].cursor) !== Number(ack.cursor)) fail(409, "PULL_CURSOR_MISMATCH", "Only the exact delivered cursor can be acknowledged");
        await service.acknowledgePull({ organizationId: principal.organizationId, userId: principal.userId, deviceId: input.deviceId, deliveryId: ack.deliveryId });
      }
      return { acknowledged: acknowledgements.length };
    },

    async recovery(principal, deviceId, batchId = null) {
      const dev = await device(principal, deviceId);
      const values = [deviceId];
      let batchClause = "AND status<>'completed'";
      if (batchId) { values.push(batchId); batchClause = `AND batch_uuid=$${values.length}`; }
      const batches = await database.query(
        `SELECT id,batch_uuid AS "batchId",status,first_sequence AS "firstSequence",last_sequence AS "lastSequence",received_count AS "receivedCount",
          applied_count AS "appliedCount",conflict_count AS "conflictCount",rejected_count AS "rejectedCount",blocked_count AS "blockedCount",retry_count AS "retryCount",
          received_at AS "receivedAt",updated_at AS "updatedAt" FROM mobile_sync_batches WHERE device_id=$1 ${batchClause} ORDER BY received_at DESC LIMIT 20`,
        values,
      );
      const detail = [];
      for (const batch of batches.rows) {
        const ops = await database.query(
          `SELECT operation_uuid AS "operationId",sequence_number AS sequence,module_key AS "moduleKey",collection_key AS "collectionKey",record_id AS "recordId",
            status,retryable,server_version AS "serverVersion",error_code AS "errorCode",error_message AS "errorMessage",attempts
           FROM mobile_sync_operations WHERE batch_id=$1 ORDER BY sequence_number`, [batch.id]);
        detail.push({ ...batch, operations: ops.rows });
      }
      const deliveries = await database.query(`SELECT id AS "deliveryId",request_id AS "requestId",module_key AS "moduleKey",collection_key AS "collectionKey",from_change_id AS "fromCursor",to_change_id AS "toCursor",payload_count AS "payloadCount",created_at AS "createdAt" FROM mobile_sync_pull_deliveries WHERE device_id=$1 AND status='pending' ORDER BY created_at`, [deviceId]);
      const schemas = await database.query(`SELECT module_key AS "moduleKey",collection_key AS "collectionKey",schema_version AS "schemaVersion",acknowledged_at AS "acknowledgedAt" FROM mobile_sync_device_schemas WHERE device_id=$1 ORDER BY module_key,collection_key`, [deviceId]);
      const cursors = await database.query(`SELECT module_key AS "moduleKey",collection_key AS "collectionKey",last_acked_change_id AS cursor,updated_at AS "updatedAt" FROM mobile_sync_pull_state WHERE device_id=$1 ORDER BY module_key,collection_key`, [deviceId]);
      return { deviceId, lastPushSequence: Number(dev.lastPushSequence ?? 0), nextExpectedSequence: Number(dev.lastPushSequence ?? 0) + 1, batches: detail, pendingPullDeliveries: deliveries.rows, schemas: schemas.rows, pullCursors: cursors.rows, serverTime: new Date().toISOString() };
    },

    async exchangeOfflineGrant(input) {
      const deviceId = String(input?.deviceId ?? "").trim();
      const grant = String(input?.offlineGrant ?? "").trim();
      if (!deviceId || grant.length < 32) fail(422, "VALIDATION_ERROR", "Invalid offline grant exchange request");
      const tokenHash = sha256(grant);
      const result = await database.query(
        `SELECT g.id AS "grantId",g.expires_at AS "expiresAt",d.id AS "deviceId",d.organization_id AS "organizationId",d.user_id AS "userId",d.status AS "deviceStatus",
          u.status AS "userStatus",o.status AS "organizationStatus",m.role,m.scopes
         FROM mobile_offline_grants g JOIN mobile_sync_devices d ON d.id=g.device_id JOIN users u ON u.id=d.user_id
         JOIN organizations o ON o.id=d.organization_id JOIN memberships m ON m.organization_id=d.organization_id AND m.user_id=d.user_id
         WHERE g.device_id=$1 AND g.token_hash=$2 AND g.revoked_at IS NULL AND g.expires_at>now()`,
        [deviceId, tokenHash],
      );
      const row = result.rows[0];
      if (!row || row.deviceStatus !== "active" || row.userStatus !== "active") fail(401, "INVALID_OFFLINE_GRANT", "Offline device grant is invalid, expired or revoked. Sign in online again.");
      if (row.organizationStatus !== "active") fail(403, "ORGANIZATION_INACTIVE", "This organization is inactive and cannot reconnect mobile devices");
      await database.query(
        `UPDATE mobile_offline_grants SET last_used_at=now(),expires_at=now()+($2 * interval '1 day') WHERE id=$1 AND revoked_at IS NULL`,
        [row.grantId, OFFLINE_GRANT_DAYS],
      );
      await database.query(
        `UPDATE mobile_sync_devices SET last_seen_at=now(),app_version=COALESCE($2,app_version),client_schema_version=COALESCE($3,client_schema_version),updated_at=now() WHERE id=$1`,
        [deviceId, input?.appVersion ?? null, input?.clientSchemaVersion ?? null],
      );
      return {
        identity: { userId: row.userId, organizationId: row.organizationId, role: row.role, scopes: parse(row.scopes, []) ?? [], mobileDeviceId: row.deviceId },
        deviceId: row.deviceId,
        organizationId: row.organizationId,
        offlineGrantExpiresAt: row.expiresAt,
        protocolVersion: PROTOCOL_VERSION,
        serverTime: new Date().toISOString(),
      };
    },

    async readiness() {
      const result = await database.query(`SELECT
        to_regclass('public.mobile_sync_devices') IS NOT NULL AS devices,
        to_regclass('public.mobile_offline_grants') IS NOT NULL AS grants,
        to_regclass('public.mobile_sync_device_schemas') IS NOT NULL AS schemas,
        to_regclass('public.mobile_sync_record_versions') IS NOT NULL AS versions,
        to_regclass('public.mobile_sync_changes') IS NOT NULL AS changes,
        to_regclass('public.mobile_sync_batches') IS NOT NULL AS batches,
        to_regclass('public.mobile_sync_operations') IS NOT NULL AS operations,
        to_regclass('public.mobile_sync_pull_state') IS NOT NULL AS pull_state,
        to_regclass('public.mobile_sync_pull_deliveries') IS NOT NULL AS deliveries,
        to_regclass('public.mobile_sync_bootstraps') IS NOT NULL AS bootstraps`);
      const row = result.rows[0] ?? {};
      const missing = Object.entries(row).filter(([, value]) => value !== true).map(([name]) => name);
      return { ok: missing.length === 0, provider: "postgresql-mobile-sync-api", collections: list.length, missing };
    },

    describe() {
      return { provider: "postgresql-mobile-sync-api", protocolVersion: PROTOCOL_VERSION, collections: list.length, offlineGrantDays: OFFLINE_GRANT_DAYS, cloudflareFallbackPreserved: true };
    },
  });
}
