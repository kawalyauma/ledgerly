import { loadConfig } from '../config.mjs';
import { createPostgresDatabase } from '../adapters/postgres-database.mjs';
import { ATTENDANCE_TABLES } from '../migration/attendance-manifest.mjs';
import { ATTENDANCE_RELATIONSHIP_CHECKS } from '../migration/attendance-validators.mjs';

const config=loadConfig(process.env);
const database=await createPostgresDatabase(config.database);
try{
  const critical=['att_sessions','att_records','att_events','att_devices','att_device_credentials','att_device_sync_batches','att_person_identifiers','att_biometric_profiles','att_biometric_templates','att_biometric_enrollment_jobs','att_device_enrollment_tokens','att_audit'];
  const expr=critical.map((name,index)=>`to_regclass('public.${name}') AS t${index}`).join(',');
  const tableRow=(await database.query(`SELECT ${expr}`)).rows[0]??{};
  const missing=critical.filter((_,index)=>!tableRow[`t${index}`]);
  const relationshipChecks=[];
  if(!missing.length){
    for(const [name,sql] of ATTENDANCE_RELATIONSHIP_CHECKS){
      const row=(await database.query(sql)).rows[0]??{};
      const count=Number(row.count??Object.values(row)[0]??0);
      if(count!==0)relationshipChecks.push({name,count});
    }
  }
  const moduleRows=await database.query(`SELECT module_key,enabled FROM organization_modules WHERE module_key IN ('school-management','attendance') ORDER BY organization_id,module_key`);
  const ok=missing.length===0&&relationshipChecks.length===0;
  console.log(JSON.stringify({ok,provider:database.provider,registeredAttendanceTables:ATTENDANCE_TABLES.length,criticalTables:critical.length,missing,relationshipChecks,moduleRows:moduleRows.rows.length},null,2));
  if(!ok)process.exitCode=1;
}finally{await database.close();}
