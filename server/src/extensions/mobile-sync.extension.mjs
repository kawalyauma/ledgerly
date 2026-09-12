import { PostgresMobileSyncRepository } from "../mobile-sync/repository.mjs";
import { MobileSyncService } from "../mobile-sync/service.mjs";
import { loadMobileSyncCollections } from "../mobile-sync/collections.mjs";
import { createMobileSyncApiService } from "../mobile-sync/api-service.mjs";

function bounded(value, fallback, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}
function cutover(value) {
  const mode = String(value ?? "cloudflare").trim().toLowerCase();
  if (!["cloudflare", "shadow", "node"].includes(mode)) throw new Error("LEDGERLY_MOBILE_SYNC_CUTOVER must be cloudflare, shadow, or node");
  return mode;
}

export default {
  name: "mobile-sync",
  required: false,
  configure(env) {
    return {
      enabled: String(env.LEDGERLY_MOBILE_SYNC_SELFHOST_ENABLED ?? env.SELFHOST_MOBILE_SYNC_ENABLED ?? "").toLowerCase() === "true",
      cutover: cutover(env.LEDGERLY_MOBILE_SYNC_CUTOVER),
      maxPush: bounded(env.SELFHOST_MOBILE_SYNC_MAX_PUSH, 250, 1000),
      maxPull: bounded(env.SELFHOST_MOBILE_SYNC_MAX_PULL, 500, 1000),
    };
  },
  enabled(extensionConfig) {
    return extensionConfig.enabled === true;
  },
  async create({ services, extensionConfig }) {
    const repository = new PostgresMobileSyncRepository({ database: services.database });
    const collections = await loadMobileSyncCollections({ services });
    const service = new MobileSyncService({ repository, collections, maxPush: extensionConfig.maxPush, maxPull: extensionConfig.maxPull });
    const api = createMobileSyncApiService({ database: services.database, service, collections, audit: services.audit });

    async function registerDevice({ organizationId, userId, deviceId, installationId = deviceId, platform = "android", appVersion = "unknown", deviceName = "Ledgerly device" }) {
      if (!organizationId || !userId || !deviceId) throw new TypeError("organizationId, userId and deviceId are required");
      const result = await services.database.query(
        `INSERT INTO mobile_sync_devices (id,organization_id,user_id,installation_id,platform,app_version,device_name,status,last_seen_at,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'active',now(),now(),now())
         ON CONFLICT (id) DO UPDATE SET platform=EXCLUDED.platform,app_version=EXCLUDED.app_version,device_name=EXCLUDED.device_name,status='active',last_seen_at=now(),updated_at=now()
         WHERE mobile_sync_devices.organization_id=EXCLUDED.organization_id AND mobile_sync_devices.user_id=EXCLUDED.user_id
         RETURNING *`,
        [deviceId, organizationId, userId, installationId, platform, appVersion, deviceName],
      );
      const row = result.rows[0];
      if (!row) throw Object.assign(new Error("device id belongs to another organization or user"), { code: "SYNC_DEVICE_CONFLICT", status: 409 });
      return row;
    }

    return {
      value: Object.freeze({ service, api, repository, registerDevice, collections }),
      readiness: () => api.readiness(),
      describe() {
        return { ...api.describe(), cutover: extensionConfig.cutover, maxPush: extensionConfig.maxPush, maxPull: extensionConfig.maxPull };
      },
    };
  },
};
