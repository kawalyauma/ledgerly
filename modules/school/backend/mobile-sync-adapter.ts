import { z } from "zod";
import { AppError } from "../../../src/lib/errors";
import type { MobileSyncMutation, MobileSyncMutationContext, PreparedMobileSyncMutation } from "../../mobile-sync/backend/contracts";
import { registerMobileSyncCollection } from "../../mobile-sync/backend/registry";
import { parseJson } from "./common";
import { requireStudentsRead, requireStudentsWrite } from "./mobile-sync-permissions";
import { snapshotAcademicContext, snapshotEnrollments, snapshotStudentGuardians, snapshotStudentNotes, snapshotStudents } from "./mobile-sync-snapshots";
type R=Record<string,any>;

const studentChanges=z.object({
  firstName:z.string().min(1).max(100).optional(),middleName:z.string().max(100).nullable().optional(),lastName:z.string().min(1).max(100).optional(),
  preferredName:z.string().max(100).nullable().optional(),gender:z.string().max(40).nullable().optional(),dateOfBirth:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  nationality:z.string().max(80).nullable().optional(),placeOfBirth:z.string().max(160).nullable().optional(),religion:z.string().max(100).nullable().optional(),
  homeLanguage:z.string().max(100).nullable().optional(),phone:z.string().max(40).nullable().optional(),email:z.string().email().nullable().optional(),
  physicalAddress:z.string().max(1000).nullable().optional(),previousSchool:z.string().max(200).nullable().optional(),previousClass:z.string().max(120).nullable().optional(),
  studentCategory:z.string().max(100).nullable().optional(),residencyStatus:z.enum(["day","boarding","hybrid"]).optional(),house:z.string().max(100).nullable().optional(),
  profilePhotoUrl:z.string().max(1000).nullable().optional(),customFields:z.record(z.string(),z.unknown()).optional(),
}).strict();
const notePayload=z.object({studentId:z.string().min(3).max(120),noteType:z.string().min(1).max(80).default("general"),body:z.string().min(1).max(10000),createdAt:z.string().datetime().optional()}).strict();
const map:Record<string,string>={firstName:"first_name",middleName:"middle_name",lastName:"last_name",preferredName:"preferred_name",gender:"gender",dateOfBirth:"date_of_birth",
  nationality:"nationality",placeOfBirth:"place_of_birth",religion:"religion",homeLanguage:"home_language",phone:"phone",email:"email",physicalAddress:"physical_address",
  previousSchool:"previous_school",previousClass:"previous_class",studentCategory:"student_category",residencyStatus:"residency_status",house:"house",profilePhotoUrl:"profile_photo_url",customFields:"custom_fields_json"};

function studentPayload(row:R,changes:R={}){
  const get=(camel:string,snake:string)=>camel in changes?changes[camel]:row[snake];
  return {id:row.id,admissionNumber:row.admission_number,studentNumber:row.student_number,
    firstName:get("firstName","first_name"),middleName:get("middleName","middle_name"),lastName:get("lastName","last_name"),preferredName:get("preferredName","preferred_name"),
    gender:get("gender","gender"),dateOfBirth:get("dateOfBirth","date_of_birth"),nationality:get("nationality","nationality"),placeOfBirth:get("placeOfBirth","place_of_birth"),
    religion:get("religion","religion"),homeLanguage:get("homeLanguage","home_language"),phone:get("phone","phone"),email:get("email","email"),physicalAddress:get("physicalAddress","physical_address"),
    previousSchool:get("previousSchool","previous_school"),previousClass:get("previousClass","previous_class"),studentCategory:get("studentCategory","student_category"),
    residencyStatus:get("residencyStatus","residency_status"),house:get("house","house"),profilePhotoUrl:get("profilePhotoUrl","profile_photo_url"),
    customFields:"customFields" in changes?changes.customFields:parseJson(String(row.custom_fields_json||"{}"),{}),status:row.status,
    admissionDate:row.admission_date,campusId:row.campus_id,currentAcademicYearId:row.current_academic_year_id,currentClassId:row.current_class_id,currentStreamId:row.current_stream_id,campusName:row.campus_name,academicYearName:row.academic_year_name,className:row.class_name,streamName:row.stream_name};
}
function suppress(db:D1Database,key:string){return db.prepare("INSERT OR REPLACE INTO school_mobile_sync_suppression(record_key) VALUES (?)").bind(key);}
function unsuppress(db:D1Database,key:string){return db.prepare("DELETE FROM school_mobile_sync_suppression WHERE record_key=?").bind(key);}

async function prepareStudent(c:MobileSyncMutationContext,m:MobileSyncMutation):Promise<PreparedMobileSyncMutation>{
  await requireStudentsWrite(c);
  if(m.kind==="delete")throw new AppError(409,"SERVER_MANAGED_LIFECYCLE","Students cannot be deleted from an offline device");
  const parsed=studentChanges.safeParse(m.payload);
  if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid offline student changes",parsed.error.flatten());
  const entries=Object.entries(parsed.data);
  if(!entries.length)throw new AppError(422,"VALIDATION_ERROR","No student changes supplied");
  const current=await c.db.prepare(`SELECT s.*,b.name AS campus_name,ay.name AS academic_year_name,cl.name AS class_name,st.name AS stream_name FROM school_students s
    LEFT JOIN school_branches b ON b.id=s.campus_id AND b.organization_id=s.organization_id
    LEFT JOIN school_academic_years ay ON ay.id=s.current_academic_year_id AND ay.organization_id=s.organization_id
    LEFT JOIN school_classes cl ON cl.id=s.current_class_id AND cl.organization_id=s.organization_id
    LEFT JOIN school_streams st ON st.id=s.current_stream_id AND st.organization_id=s.organization_id
    WHERE s.id=? AND s.organization_id=? AND s.deleted_at IS NULL`).bind(m.recordId,c.organizationId).first<R>();
  if(!current)throw new AppError(404,"STUDENT_NOT_FOUND","Student not found");
  if(c.currentVersion===0)throw new AppError(409,"BOOTSTRAP_REQUIRED","Bootstrap the student collection before editing existing students offline");
  const set:string[]=[],values:unknown[]=[];
  for(const [key,value] of entries){set.push(`${map[key]}=?`);values.push(key==="customFields"?JSON.stringify(value):value??null);}
  const guard=`${c.organizationId}:students:${m.recordId}`;
  const statements=[suppress(c.db,guard),c.db.prepare(`UPDATE school_students SET ${set.join(",")},updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND deleted_at IS NULL`).bind(...values,c.userId,m.recordId,c.organizationId),unsuppress(c.db,guard)];
  return{statements,serverPayload:studentPayload(current,parsed.data as R),result:{studentId:m.recordId,updatedFields:entries.map(([k])=>k)}};
}

async function prepareNote(c:MobileSyncMutationContext,m:MobileSyncMutation):Promise<PreparedMobileSyncMutation>{
  await requireStudentsWrite(c);
  if(m.kind==="delete")throw new AppError(409,"APPEND_ONLY_COLLECTION","Student notes cannot be deleted from an offline device");
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,149}$/.test(m.recordId))throw new AppError(422,"INVALID_NOTE_ID","Student note IDs must be stable UUID-style identifiers");
  const parsed=notePayload.safeParse(m.payload);if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid student note",parsed.error.flatten());
  const student=await c.db.prepare("SELECT 1 FROM school_students WHERE id=? AND organization_id=? AND deleted_at IS NULL").bind(parsed.data.studentId,c.organizationId).first();
  if(!student)throw new AppError(404,"STUDENT_NOT_FOUND","Student not found");
  if(await c.db.prepare("SELECT 1 FROM school_student_notes WHERE id=? AND organization_id=?").bind(m.recordId,c.organizationId).first())
    throw new AppError(409,"NOTE_ID_EXISTS","This student note ID already exists");
  const createdAt=parsed.data.createdAt??m.clientTimestamp;
  if(Number.isNaN(new Date(createdAt).getTime()))throw new AppError(422,"INVALID_NOTE_TIME","Student note creation time is invalid");
  const guard=`${c.organizationId}:student-notes:${m.recordId}`;
  const statements=[suppress(c.db,guard),c.db.prepare(`INSERT INTO school_student_notes(id,organization_id,student_id,note_type,body,confidential,created_by,created_at,updated_at)
    VALUES (?,?,?,?,?,0,?,?,?)`).bind(m.recordId,c.organizationId,parsed.data.studentId,parsed.data.noteType,parsed.data.body,c.userId,createdAt,createdAt),unsuppress(c.db,guard)];
  const payload={id:m.recordId,studentId:parsed.data.studentId,noteType:parsed.data.noteType,body:parsed.data.body,confidential:false,createdBy:c.userId,createdAt,updatedAt:createdAt};
  return{statements,serverPayload:payload,result:{noteId:m.recordId,studentId:parsed.data.studentId}};
}

const authRead={pullScope:"school:read",authorizePull:requireStudentsRead} as const;
registerMobileSyncCollection({moduleKey:"school-management",collectionKey:"students",schemaVersion:1,mode:"read-write",sourceOfTruth:"server",conflictPolicy:"reject-stale",
  ...authRead,pushScope:"school:write",authorizePush:requireStudentsWrite,prepareMutation:prepareStudent,snapshot:snapshotStudents});
registerMobileSyncCollection({moduleKey:"school-management",collectionKey:"student-guardians",schemaVersion:1,mode:"read-only",sourceOfTruth:"server",conflictPolicy:"server-wins",...authRead,snapshot:snapshotStudentGuardians});
registerMobileSyncCollection({moduleKey:"school-management",collectionKey:"enrollments",schemaVersion:1,mode:"read-only",sourceOfTruth:"server",conflictPolicy:"server-wins",...authRead,snapshot:snapshotEnrollments});
registerMobileSyncCollection({moduleKey:"school-management",collectionKey:"academic-context",schemaVersion:1,mode:"read-only",sourceOfTruth:"server",conflictPolicy:"server-wins",pullScope:"school:read",snapshot:snapshotAcademicContext});
registerMobileSyncCollection({moduleKey:"school-management",collectionKey:"student-notes",schemaVersion:1,mode:"append-only",sourceOfTruth:"merge",conflictPolicy:"append-only",
  ...authRead,pushScope:"school:write",authorizePush:requireStudentsWrite,prepareMutation:prepareNote,snapshot:snapshotStudentNotes});
