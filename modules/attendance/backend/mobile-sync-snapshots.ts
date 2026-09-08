import type { MobileSyncRecord, MobileSyncSnapshotContext } from "../../mobile-sync/backend/contracts";
import * as S from "./service";
type R = Record<string, any>;

function ver(row:R){return Math.max(1,Number(row.syncVersion??1));}
function clean(row:R){const out=S.camel(row);delete out.syncVersion;return out;}
async function rows(c:MobileSyncSnapshotContext,query:string,binds:unknown[],map:(r:R)=>{id:string;payload:unknown;updatedAt?:string;deleted?:boolean}):Promise<MobileSyncRecord[]>{
  const out=await c.db.prepare(query).bind(...binds).all<R>();
  return out.results.map(r=>{const m=map(r);return{id:m.id,version:ver(r),updatedAt:m.updatedAt??r.updatedAt??r.updated_at??new Date().toISOString(),deleted:m.deleted,payload:m.payload};});
}
async function snapshotRoster(c:MobileSyncSnapshotContext){
  const students=await rows(c,`SELECT s.id,s.admission_number AS admissionNumber,s.student_number AS studentNumber,s.first_name AS firstName,
    s.last_name AS lastName,s.current_class_id AS classId,s.current_stream_id AS streamId,c.name AS className,st.name AS streamName,
    s.status,s.deleted_at AS deletedAt,s.updated_at AS updatedAt,v.version AS syncVersion
    FROM school_students s LEFT JOIN school_classes c ON c.id=s.current_class_id LEFT JOIN school_streams st ON st.id=s.current_stream_id
    LEFT JOIN mobile_sync_record_versions v
    ON v.organization_id=s.organization_id AND v.module_key='attendance' AND v.collection_key='roster' AND v.record_id='student:'||s.id
    WHERE s.organization_id=? ORDER BY s.last_name,s.first_name`,[c.organizationId],r=>({
      id:`student:${r.id}`,updatedAt:r.updatedAt,
      payload:{personType:"student",personId:r.id,admissionNumber:r.admissionNumber,studentNumber:r.studentNumber,firstName:r.firstName,lastName:r.lastName,
        classId:r.classId,streamId:r.streamId,className:r.className,streamName:r.streamName,status:r.status,active:!r.deletedAt&&r.status==="active"},
    }));
  const staff=await rows(c,`SELECT s.id,s.staff_number AS staffNumber,s.first_name AS firstName,s.last_name AS lastName,s.department_id AS departmentId,d.name AS departmentName,
    s.employment_status AS employmentStatus,s.deleted_at AS deletedAt,s.updated_at AS updatedAt,v.version AS syncVersion
    FROM school_staff_profiles s LEFT JOIN school_departments d ON d.id=s.department_id LEFT JOIN mobile_sync_record_versions v ON v.organization_id=s.organization_id AND v.module_key='attendance'
    AND v.collection_key='roster' AND v.record_id='staff:'||s.id WHERE s.organization_id=? ORDER BY s.last_name,s.first_name`,[c.organizationId],r=>({
      id:`staff:${r.id}`,updatedAt:r.updatedAt,
      payload:{personType:"staff",personId:r.id,staffNumber:r.staffNumber,firstName:r.firstName,lastName:r.lastName,departmentId:r.departmentId,
        departmentName:r.departmentName,employmentStatus:r.employmentStatus,active:!r.deletedAt&&r.employmentStatus==="active"},
    }));
  return[...students,...staff];
}
const snapshotPolicies=(c:MobileSyncSnapshotContext)=>rows(c,`SELECT p.*,v.version AS syncVersion FROM att_policies p LEFT JOIN mobile_sync_record_versions v
  ON v.organization_id=p.organization_id AND v.module_key='attendance' AND v.collection_key='policies' AND v.record_id=p.id
  WHERE p.organization_id=? ORDER BY p.population,p.updated_at DESC`,[c.organizationId],r=>({id:r.id,updatedAt:r.updated_at,payload:clean(r)}));
const snapshotIdentifiers=(c:MobileSyncSnapshotContext)=>rows(c,`SELECT i.*,v.version AS syncVersion FROM att_person_identifiers i LEFT JOIN mobile_sync_record_versions v
  ON v.organization_id=i.organization_id AND v.module_key='attendance' AND v.collection_key='identifiers' AND v.record_id=i.id
  WHERE i.organization_id=? ORDER BY i.person_type,i.person_id,i.method`,[c.organizationId],r=>({id:r.id,updatedAt:r.created_at,payload:clean(r)}));
const snapshotBiometricSettings=(c:MobileSyncSnapshotContext)=>rows(c,`SELECT b.*,v.version AS syncVersion FROM att_biometric_settings b LEFT JOIN mobile_sync_record_versions v
  ON v.organization_id=b.organization_id AND v.module_key='attendance' AND v.collection_key='biometric-settings' AND v.record_id='settings'
  WHERE b.organization_id=?`,[c.organizationId],r=>({id:"settings",updatedAt:r.updated_at,payload:clean(r)}));
const snapshotSessions=(c:MobileSyncSnapshotContext)=>rows(c,`SELECT a.*,v.version AS syncVersion FROM att_sessions a LEFT JOIN mobile_sync_record_versions v
  ON v.organization_id=a.organization_id AND v.module_key='attendance' AND v.collection_key='sessions' AND v.record_id=a.id
  WHERE a.organization_id=? AND a.attendance_date>=date('now','-400 days') ORDER BY a.attendance_date,a.id`,[c.organizationId],r=>({id:r.id,updatedAt:r.updated_at,payload:clean(r)}));
const snapshotRecords=(c:MobileSyncSnapshotContext)=>rows(c,`SELECT r.*,v.version AS syncVersion FROM att_records r LEFT JOIN mobile_sync_record_versions v
  ON v.organization_id=r.organization_id AND v.module_key='attendance' AND v.collection_key='records' AND v.record_id=r.id
  WHERE r.organization_id=? AND r.attendance_date>=date('now','-400 days') ORDER BY r.attendance_date,r.id`,[c.organizationId],r=>({id:r.id,updatedAt:r.updated_at,payload:clean(r)}));

export { snapshotRoster, snapshotPolicies, snapshotIdentifiers, snapshotBiometricSettings, snapshotSessions, snapshotRecords };
