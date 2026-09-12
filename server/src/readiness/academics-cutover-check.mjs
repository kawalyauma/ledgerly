import { loadConfig } from '../config.mjs';
import { createPostgresDatabase } from '../adapters/postgres-database.mjs';
import { ACADEMICS_TABLES } from '../migration/academics-manifest.mjs';
import { ACADEMICS_RELATIONSHIP_CHECKS } from '../migration/academics-validators.mjs';
import { ACADEMICS_MOBILE_SYNC_SPECS } from '../migration/academics-mobile-sync-schema.mjs';

const config=loadConfig(process.env);
const database=await createPostgresDatabase(config.database);
try{
  const critical=['acad_rooms','acad_teacher_availability','acad_timetables','acad_timetable_entries','acad_timetable_changes','acad_substitute_lessons','acad_schemes','acad_scheme_items','acad_scheme_versions','acad_lesson_plan_templates','acad_lesson_plans','acad_lesson_deliveries','acad_delivery_attachments','acad_observations','acad_observation_attachments','acad_inspections','acad_inspection_samples','acad_inspection_attachments','att_sessions','school_staff_teaching_assignments','mobile_sync_record_versions','mobile_sync_changes','mobile_sync_tombstones','academics_mobile_sync_suppression'];
  const expr=critical.map((name,index)=>`to_regclass('public.${name}') AS t${index}`).join(',');
  const tableRow=(await database.query(`SELECT ${expr}`)).rows[0]??{};
  const missing=critical.filter((_,index)=>!tableRow[`t${index}`]);
  const relationshipChecks=[];
  if(!missing.length){
    for(const [name,sql] of ACADEMICS_RELATIONSHIP_CHECKS){
      const row=(await database.query(sql)).rows[0]??{};
      const count=Number(row.count??Object.values(row)[0]??0);
      if(count!==0)relationshipChecks.push({name,count});
    }
  }
  const moduleRows=await database.query(`SELECT organization_id,module_key,enabled FROM organization_modules WHERE module_key IN ('school-management','attendance','academics') ORDER BY organization_id,module_key`);
  const canonicalAttendanceColumn=(await database.query(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='acad_lesson_deliveries' AND column_name='canonical_attendance_session_id'`)).rows.length===1;
  const examsLeak=(await database.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'acad_exam%'`)).rows[0]?.n??0;
  const bridge=(await database.query(`SELECT to_regprocedure('academics_mobile_sync_emit_row()') IS NOT NULL AS function_ready,(SELECT count(*)::int FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'academics_ms_%') AS trigger_count`)).rows[0]??{};
  const mobileBridgeReady=bridge.function_ready===true&&Number(bridge.trigger_count)>=ACADEMICS_MOBILE_SYNC_SPECS.length;
  const ok=missing.length===0&&relationshipChecks.length===0&&canonicalAttendanceColumn&&Number(examsLeak)===0&&mobileBridgeReady;
  console.log(JSON.stringify({ok,provider:database.provider,registeredAcademicsTables:ACADEMICS_TABLES.length,criticalTables:critical.length,missing,relationshipChecks,canonicalAttendanceColumn,moduleRows:moduleRows.rows.length,examsSeparated:Number(examsLeak)===0,mobileBridgeReady,mobileSyncTriggers:Number(bridge.trigger_count??0),expectedMobileSyncTriggers:ACADEMICS_MOBILE_SYNC_SPECS.length},null,2));
  if(!ok)process.exitCode=1;
}finally{await database.close();}
