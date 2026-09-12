import { loadConfig } from "../config.mjs";
import { createPostgresDatabase } from "../adapters/postgres-database.mjs";

const required = [
  "organizations","users","memberships",
  "mobile_sync_devices","mobile_offline_grants","mobile_sync_device_schemas","mobile_sync_record_versions","mobile_sync_tombstones","mobile_sync_changes",
  "mobile_sync_batches","mobile_sync_operations","mobile_sync_conflicts","mobile_sync_pull_state","mobile_sync_pull_deliveries","mobile_sync_bootstraps","mobile_sync_events",
];

const config = loadConfig(process.env);
const database = await createPostgresDatabase(config.database);
try {
  const expressions = required.map((name,index)=>`to_regclass('public.${name}') AS t${index}`).join(',');
  const row = (await database.query(`SELECT ${expressions}`)).rows[0] ?? {};
  const missing = required.filter((_,index)=>!row[`t${index}`]);
  const relationshipChecks = [];
  if (!missing.length) {
    const checks = (await database.query(`SELECT
      (SELECT count(*) FROM mobile_sync_devices d LEFT JOIN organizations o ON o.id=d.organization_id LEFT JOIN users u ON u.id=d.user_id WHERE o.id IS NULL OR u.id IS NULL) AS orphan_devices,
      (SELECT count(*) FROM mobile_offline_grants g LEFT JOIN mobile_sync_devices d ON d.id=g.device_id WHERE d.id IS NULL) AS orphan_grants,
      (SELECT count(*) FROM mobile_sync_operations op LEFT JOIN mobile_sync_devices d ON d.id=op.device_id LEFT JOIN mobile_sync_batches b ON b.id=op.batch_id WHERE d.id IS NULL OR b.id IS NULL) AS orphan_operations,
      (SELECT count(*) FROM mobile_sync_pull_deliveries p LEFT JOIN mobile_sync_devices d ON d.id=p.device_id WHERE d.id IS NULL) AS orphan_pull_deliveries,
      (SELECT count(*) FROM mobile_sync_devices d JOIN memberships m ON m.organization_id=d.organization_id AND m.user_id=d.user_id WHERE m.user_id IS NULL) AS impossible_membership_check`)).rows[0] ?? {};
    // The final expression is deliberately expected to be zero on healthy data; retain it with the others for stable output.
    for (const [name,value] of Object.entries(checks)) if (Number(value) !== 0) relationshipChecks.push({name,count:Number(value)});
    const membership = await database.query(`SELECT count(*) AS count FROM mobile_sync_devices d LEFT JOIN memberships m ON m.organization_id=d.organization_id AND m.user_id=d.user_id WHERE m.user_id IS NULL`);
    const missingMemberships = Number(membership.rows[0]?.count ?? 0);
    if (missingMemberships) relationshipChecks.push({name:'devices_without_membership',count:missingMemberships});
  }
  const ok = missing.length===0 && relationshipChecks.length===0;
  console.log(JSON.stringify({ok,provider:database.provider,requiredTables:required.length,missing,relationshipChecks},null,2));
  if (!ok) process.exitCode=1;
} finally {
  await database.close();
}
