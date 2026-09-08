import type { MobileSyncRecord, MobileSyncSnapshotContext } from "../../mobile-sync/backend/contracts";
import { camelizeRow, parseJson } from "./common";
type R = Record<string, any>;

function version(row:R){return Math.max(1,Number(row.syncVersion??1));}
function updated(row:R){return String(row.updatedAt??row.updated_at??row.createdAt??row.created_at??new Date().toISOString());}
function record(row:R,id:string,payload:unknown):MobileSyncRecord{return{id,version:version(row),updatedAt:updated(row),payload};}
function safeStudent(row:R){
  return {
    id:row.id,admissionNumber:row.admissionNumber,studentNumber:row.studentNumber,firstName:row.firstName,middleName:row.middleName,lastName:row.lastName,
    preferredName:row.preferredName,gender:row.gender,dateOfBirth:row.dateOfBirth,nationality:row.nationality,placeOfBirth:row.placeOfBirth,
    religion:row.religion,homeLanguage:row.homeLanguage,phone:row.phone,email:row.email,physicalAddress:row.physicalAddress,previousSchool:row.previousSchool,
    previousClass:row.previousClass,admissionDate:row.admissionDate,studentCategory:row.studentCategory,residencyStatus:row.residencyStatus,house:row.house,
    status:row.status,profilePhotoUrl:row.profilePhotoUrl,customFields:typeof row.customFieldsJson==="string"?parseJson(row.customFieldsJson,{}):row.customFields??{},
    campusId:row.campusId,campusName:row.campusName,currentAcademicYearId:row.currentAcademicYearId,academicYearName:row.academicYearName,
    currentClassId:row.currentClassId,className:row.className,currentStreamId:row.currentStreamId,streamName:row.streamName,
    updatedAt:row.updatedAt,
  };
}

export async function snapshotStudents(c:MobileSyncSnapshotContext){
  const q=await c.db.prepare(`SELECT s.*,b.name AS campus_name,ay.name AS academic_year_name,cl.name AS class_name,st.name AS stream_name,
    v.version AS syncVersion FROM school_students s
    LEFT JOIN school_branches b ON b.id=s.campus_id AND b.organization_id=s.organization_id
    LEFT JOIN school_academic_years ay ON ay.id=s.current_academic_year_id AND ay.organization_id=s.organization_id
    LEFT JOIN school_classes cl ON cl.id=s.current_class_id AND cl.organization_id=s.organization_id
    LEFT JOIN school_streams st ON st.id=s.current_stream_id AND st.organization_id=s.organization_id
    LEFT JOIN mobile_sync_record_versions v ON v.organization_id=s.organization_id AND v.module_key='school-management'
      AND v.collection_key='students' AND v.record_id=s.id
    WHERE s.organization_id=? AND s.deleted_at IS NULL ORDER BY s.last_name,s.first_name`).bind(c.organizationId).all<R>();
  return q.results.map(raw=>{const row=camelizeRow(raw) as R;return record({...row,syncVersion:raw.syncVersion},String(row.id),safeStudent(row));});
}

export async function snapshotStudentGuardians(c:MobileSyncSnapshotContext){
  const q=await c.db.prepare(`SELECT sg.student_id AS studentId,sg.guardian_id AS guardianId,sg.relationship,sg.is_primary AS isPrimary,
    sg.is_emergency_contact AS isEmergencyContact,sg.is_authorized_pickup AS isAuthorizedPickup,sg.is_financially_responsible AS isFinanciallyResponsible,
    sg.receives_academic_updates AS receivesAcademicUpdates,sg.receives_financial_updates AS receivesFinancialUpdates,
    sg.updated_at AS updatedAt,g.first_name AS firstName,g.middle_name AS middleName,g.last_name AS lastName,g.phone_primary AS phonePrimary,
    g.phone_secondary AS phoneSecondary,g.email,g.relationship_default AS relationshipDefault,g.occupation,g.physical_address AS physicalAddress,g.active,
    v.version AS syncVersion FROM school_student_guardians sg JOIN school_guardians g ON g.id=sg.guardian_id AND g.organization_id=sg.organization_id
    LEFT JOIN mobile_sync_record_versions v ON v.organization_id=sg.organization_id AND v.module_key='school-management'
      AND v.collection_key='student-guardians' AND v.record_id=sg.student_id||':'||sg.guardian_id
    WHERE sg.organization_id=? ORDER BY sg.student_id,sg.is_primary DESC,g.last_name,g.first_name`).bind(c.organizationId).all<R>();
  return q.results.map(r=>record(r,`${r.studentId}:${r.guardianId}`,{studentId:r.studentId,guardianId:r.guardianId,firstName:r.firstName,middleName:r.middleName,
    lastName:r.lastName,phonePrimary:r.phonePrimary,phoneSecondary:r.phoneSecondary,email:r.email,relationship:r.relationship,
    relationshipDefault:r.relationshipDefault,occupation:r.occupation,physicalAddress:r.physicalAddress,active:Boolean(r.active),isPrimary:Boolean(r.isPrimary),
    isEmergencyContact:Boolean(r.isEmergencyContact),isAuthorizedPickup:Boolean(r.isAuthorizedPickup),isFinanciallyResponsible:Boolean(r.isFinanciallyResponsible),
    receivesAcademicUpdates:Boolean(r.receivesAcademicUpdates),receivesFinancialUpdates:Boolean(r.receivesFinancialUpdates)}));
}

export async function snapshotEnrollments(c:MobileSyncSnapshotContext){
  const q=await c.db.prepare(`SELECT e.*,ay.name AS academicYearName,cl.name AS className,st.name AS streamName,b.name AS campusName,v.version AS syncVersion
    FROM school_enrollments e LEFT JOIN school_academic_years ay ON ay.id=e.academic_year_id LEFT JOIN school_classes cl ON cl.id=e.class_id
    LEFT JOIN school_streams st ON st.id=e.stream_id LEFT JOIN school_branches b ON b.id=e.campus_id
    LEFT JOIN mobile_sync_record_versions v ON v.organization_id=e.organization_id AND v.module_key='school-management'
      AND v.collection_key='enrollments' AND v.record_id=e.id WHERE e.organization_id=? ORDER BY e.enrolled_on,e.id`).bind(c.organizationId).all<R>();
  return q.results.map(raw=>{const x=camelizeRow(raw) as R;delete x.syncVersion;return record({...x,syncVersion:raw.syncVersion},String(x.id),x);});
}

export async function snapshotStudentNotes(c:MobileSyncSnapshotContext){
  const q=await c.db.prepare(`SELECT n.id,n.student_id AS studentId,n.note_type AS noteType,n.body,n.created_by AS createdBy,n.created_at AS createdAt,n.updated_at AS updatedAt,
    v.version AS syncVersion FROM school_student_notes n LEFT JOIN mobile_sync_record_versions v ON v.organization_id=n.organization_id
      AND v.module_key='school-management' AND v.collection_key='student-notes' AND v.record_id=n.id
    WHERE n.organization_id=? AND n.confidential=0 AND n.created_at>=datetime('now','-400 days') ORDER BY n.created_at,n.id`).bind(c.organizationId).all<R>();
  return q.results.map(r=>record(r,String(r.id),{id:r.id,studentId:r.studentId,noteType:r.noteType,body:r.body,createdBy:r.createdBy,createdAt:r.createdAt,updatedAt:r.updatedAt}));
}

type ContextSpec={type:string;prefix:string;query:string};
const specs:ContextSpec[]=[
  {type:"branch",prefix:"branch",query:"SELECT * FROM school_branches WHERE organization_id=? ORDER BY name"},
  {type:"academic-year",prefix:"academic-year",query:"SELECT * FROM school_academic_years WHERE organization_id=? ORDER BY starts_on"},
  {type:"term",prefix:"term",query:"SELECT * FROM school_terms WHERE organization_id=? ORDER BY starts_on"},
  {type:"department",prefix:"department",query:"SELECT * FROM school_departments WHERE organization_id=? ORDER BY name"},
  {type:"class-level",prefix:"class-level",query:"SELECT * FROM school_class_levels WHERE organization_id=? ORDER BY sequence_no"},
  {type:"class",prefix:"class",query:"SELECT * FROM school_classes WHERE organization_id=? ORDER BY name"},
  {type:"stream",prefix:"stream",query:"SELECT * FROM school_streams WHERE organization_id=? ORDER BY name"},
  {type:"subject",prefix:"subject",query:"SELECT * FROM school_subjects WHERE organization_id=? ORDER BY name"},
  {type:"class-subject",prefix:"class-subject",query:"SELECT * FROM school_class_subjects WHERE organization_id=? ORDER BY class_level_id,subject_id"},
  {type:"lesson-period",prefix:"lesson-period",query:"SELECT * FROM school_lesson_periods WHERE organization_id=? ORDER BY sequence_no"},
];
export async function snapshotAcademicContext(c:MobileSyncSnapshotContext){
  const versions=await c.db.prepare(`SELECT record_id AS recordId,version FROM mobile_sync_record_versions
    WHERE organization_id=? AND module_key='school-management' AND collection_key='academic-context'`).bind(c.organizationId).all<{recordId:string;version:number}>();
  const byId=new Map(versions.results.map(v=>[v.recordId,Number(v.version)]));
  const all:MobileSyncRecord[]=[];
  for(const spec of specs){
    const q=await c.db.prepare(spec.query).bind(c.organizationId).all<R>();
    for(const raw of q.results){
      const id=`${spec.prefix}:${raw.id}`,payload=camelizeRow(raw) as R;
      all.push({id,version:Math.max(1,byId.get(id)??1),updatedAt:updated(raw),payload:{entityType:spec.type,...payload}});
    }
  }
  return all;
}
