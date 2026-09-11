import { ensureMobileSyncCoreSchema } from "./mobile-sync-core-schema.mjs";

export async function ensureMobileSyncCoreCompatibility(database) {
  await ensureMobileSyncCoreSchema(database);
  await database.query(`
    CREATE TABLE IF NOT EXISTS mobile_sync_cas_checks (
      check_id text PRIMARY KEY,
      ok boolean NOT NULL,
      CONSTRAINT mobile_sync_cas_version_match CHECK (ok = true)
    )
  `);
}

export async function finalizeMobileSyncCoreSchema(database) {
  await database.query(`
    SELECT setval(
      pg_get_serial_sequence('mobile_sync_changes','change_id'),
      COALESCE((SELECT max(change_id) FROM mobile_sync_changes),0) + 1,
      false
    )
  `);
}
