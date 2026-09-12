import { loadConfig } from '../config.mjs';
import { createPostgresDatabase } from '../adapters/postgres-database.mjs';

const required=['communication_message_types','communication_campaigns','communication_recipients','communication_deliveries','communication_preferences','mobile_sync_record_versions','mobile_sync_changes'];
const config=loadConfig(process.env);
const database=await createPostgresDatabase(config.database);
try{
  const expr=required.map((name,index)=>`to_regclass('public.${name}') AS t${index}`).join(',');
  const row=(await database.query(`SELECT ${expr}`)).rows[0]??{};
  const missing=required.filter((_,index)=>!row[`t${index}`]);
  const relationshipChecks=[];
  if(!missing.length){
    const checks=(await database.query(`SELECT
      (SELECT count(*) FROM communication_campaigns c LEFT JOIN organizations o ON o.id=c.organization_id WHERE o.id IS NULL) AS orphan_campaigns,
      (SELECT count(*) FROM communication_recipients r LEFT JOIN communication_campaigns c ON c.id=r.campaign_id AND c.organization_id=r.organization_id WHERE c.id IS NULL) AS orphan_recipients,
      (SELECT count(*) FROM communication_deliveries d LEFT JOIN communication_campaigns c ON c.id=d.campaign_id AND c.organization_id=d.organization_id WHERE c.id IS NULL) AS orphan_deliveries,
      (SELECT count(*) FROM communication_deliveries d LEFT JOIN communication_recipients r ON r.id=d.recipient_snapshot_id AND r.organization_id=d.organization_id WHERE r.id IS NULL) AS orphan_delivery_recipients`)).rows[0]??{};
    for(const [name,value] of Object.entries(checks))if(Number(value)!==0)relationshipChecks.push({name,count:Number(value)});
  }
  const ok=missing.length===0&&relationshipChecks.length===0;
  console.log(JSON.stringify({ok,provider:database.provider,requiredTables:required.length,missing,relationshipChecks},null,2));
  if(!ok)process.exitCode=1;
}finally{await database.close();}
