import { AppError } from "../../../src/lib/errors";
import { createId } from "../../../src/lib/ids";

export type Row = Record<string, any>;
export const methods = ["FACE","QR","NFC","MANUAL","TEACHER_REGISTER","ADMIN_OVERRIDE","IMPORT","API"] as const;
export const studentStatuses = ["present","absent","late","excused","sick","permission"] as const;
export const staffStatuses = ["present","absent","late","on_leave","sick","official_duty","remote","half_day"] as const;

export function camel(row: Row) {
  const out: Row = {};
  for (const [key,value] of Object.entries(row)) {
    const next=key.replace(/_([a-z])/g,(_,c:string)=>c.toUpperCase());
    if(key.endsWith("_json")&&typeof value==="string"){try{out[next.replace(/Json$/,"")]=JSON.parse(value)}catch{out[next.replace(/Json$/,"")]={}}}
    else out[next]=value;
  }
  return out;
}
export const camels=(rows:Row[])=>rows.map(camel);
export const dayOf=(value:string)=>value.slice(0,10);

export async function assertPerson(db:D1Database,org:string,type:"student"|"staff",id:string){
  const table=type==="student"?"school_students":"school_staff_profiles";
  const row=await db.prepare(`SELECT * FROM ${table} WHERE id=? AND organization_id=? AND deleted_at IS NULL`).bind(id,org).first<Row>();
  if(!row)throw new AppError(404,"PERSON_NOT_FOUND",`${type==="student"?"Student":"Staff member"} not found`);
  return row;
}

export async function policy(db:D1Database,org:string,population:"students"|"staff"){
  const row=await db.prepare("SELECT * FROM att_policies WHERE organization_id=? AND active=1 AND population IN (?, 'all') ORDER BY CASE population WHEN ? THEN 0 ELSE 1 END,updated_at DESC LIMIT 1").bind(org,population,population).first<Row>();
  return row||{school_starts_at:"08:00",late_after:"08:10",absence_after:"09:00",expected_departure_at:"16:30",duplicate_cooldown_seconds:60,early_departure_minutes:15,timezone:"Africa/Kampala"};
}

async function studentSession(db:D1Database,org:string,studentId:string,date:string,userId:string|null){
  const enrollment=await db.prepare(`SELECT e.academic_year_id,e.class_id,e.stream_id,s.campus_id,t.id term_id
    FROM school_enrollments e JOIN school_students s ON s.id=e.student_id
    LEFT JOIN school_terms t ON t.organization_id=e.organization_id AND t.academic_year_id=e.academic_year_id AND t.starts_on<=? AND t.ends_on>=?
    WHERE e.organization_id=? AND e.student_id=? AND e.enrolled_on<=? AND (e.left_on IS NULL OR e.left_on>=?)
      AND e.status IN ('active','completed','repeated') ORDER BY e.enrolled_on DESC LIMIT 1`).bind(date,date,org,studentId,date,date).first<Row>();
  if(!enrollment)throw new AppError(409,"ACTIVE_ENROLLMENT_REQUIRED","The student has no active enrollment for this date");
  let session=await db.prepare(`SELECT * FROM att_sessions WHERE organization_id=? AND attendance_date=? AND session_type='daily' AND population='students' AND class_id=? AND IFNULL(stream_id,'')=IFNULL(?,'') LIMIT 1`).bind(org,date,enrollment.class_id,enrollment.stream_id??null).first<Row>();
  if(session)return session;
  const count=await db.prepare(`SELECT COUNT(*) n FROM school_enrollments WHERE organization_id=? AND academic_year_id=? AND class_id=? AND IFNULL(stream_id,'')=IFNULL(?,'') AND enrolled_on<=? AND (left_on IS NULL OR left_on>=?) AND status IN ('active','completed','repeated')`).bind(org,enrollment.academic_year_id,enrollment.class_id,enrollment.stream_id??null,date,date).first<{n:number}>();
  const id=createId("ats");
  await db.prepare(`INSERT INTO att_sessions(id,organization_id,academic_year_id,term_id,campus_id,attendance_date,session_type,population,class_id,stream_id,status,expected_count,source,created_by) VALUES (?,?,?,?,?,?,'daily','students',?,?,'open',?,'DEVICE',?)`).bind(id,org,enrollment.academic_year_id,enrollment.term_id??null,enrollment.campus_id??null,date,enrollment.class_id,enrollment.stream_id??null,Number(count?.n||0),userId).run();
  return (await db.prepare("SELECT * FROM att_sessions WHERE id=?").bind(id).first<Row>())!;
}

function localMinutes(value:string,timeZone:string){
  const d=new Date(value);if(Number.isNaN(d.getTime()))return null;
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone,hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(d);
  return Number(parts.find(x=>x.type==="hour")?.value)*60+Number(parts.find(x=>x.type==="minute")?.value);
}
function localDay(value:string,timeZone:string){const d=new Date(value);if(Number.isNaN(d.getTime()))return dayOf(value);return new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).format(d)}
function hhmm(value:string){const m=/^(\d{1,2}):(\d{2})/.exec(value);return m?Number(m[1])*60+Number(m[2]):0}

export async function recordEvent(db:D1Database,org:string,userId:string|null,input:Row){
  const capturedAt=String(input.capturedAt||new Date().toISOString()),personType=input.personType as "student"|"staff";
  const person=await assertPerson(db,org,personType,String(input.personId));
  const p=await policy(db,org,personType==="student"?"students":"staff");
  const date=localDay(capturedAt,String(p.timezone||"Africa/Kampala"));
  const cooldown=Math.max(1,Number(p.duplicate_cooldown_seconds||60));
  const official=input.official===false?0:1;
  const recent=await db.prepare(`SELECT id,captured_at,record_id FROM att_events WHERE organization_id=? AND person_type=? AND person_id=? AND direction=? AND verification_status='verified' AND official=? AND julianday(captured_at)>=julianday(?)-(?/86400.0) ORDER BY captured_at DESC LIMIT 1`).bind(org,personType,input.personId,input.direction,official,capturedAt,cooldown).first<Row>();
  if(recent)return{duplicate:true,eventId:recent.id,recordId:recent.record_id,capturedAt:recent.captured_at};
  if(!official){const eventId=createId("ate");await db.prepare(`INSERT INTO att_events(id,organization_id,device_id,sync_batch_id,client_event_id,person_type,person_id,direction,method,verification_mode,verification_status,confidence,liveness_score,captured_at,synced_at,official,metadata_json,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(eventId,org,input.deviceId??null,input.syncBatchId??null,input.clientEventId??null,personType,input.personId,input.direction,input.method,input.verificationMode||"TEST","verified",input.confidence??null,input.livenessScore??null,capturedAt,input.syncedAt??null,0,JSON.stringify(input.metadata||{}),userId).run();return{duplicate:false,eventId,recordId:null,status:"test",capturedAt,person:camel(person)}}
  if(input.method==="FACE"&&input.verificationMode==="STANDARD"){
    const minConfidence=Number(input.faceMatchThreshold??.78),minLiveness=Number(input.faceLivenessThreshold??.70),minMargin=Number(input.faceAmbiguityMargin??.05);
    const confidence=Number(input.confidence??0),liveness=Number(input.livenessScore??0),margin=Number(input.matchMargin??input.metadata?.matchMargin??0);
    if(confidence<minConfidence||liveness<minLiveness||margin<minMargin){
      const eventId=createId("ate");await db.prepare(`INSERT INTO att_events(id,organization_id,device_id,sync_batch_id,client_event_id,person_type,person_id,direction,method,verification_mode,verification_status,confidence,liveness_score,captured_at,synced_at,official,metadata_json,created_by) VALUES (?,?,?,?,?,?,?,?,?,'STANDARD','rejected',?,?,?,?,0,?,?)`).bind(eventId,org,input.deviceId??null,input.syncBatchId??null,input.clientEventId??null,personType,input.personId,input.direction,"FACE",input.confidence??null,input.livenessScore??null,capturedAt,input.syncedAt??null,JSON.stringify({...input.metadata,matchMargin:margin,rejectionReason:"FACE_THRESHOLD_FAILED",required:{confidence:minConfidence,liveness:minLiveness,margin:minMargin}}),userId).run();return{duplicate:false,rejected:true,eventId,recordId:null,status:"rejected",capturedAt,person:camel(person)}
    }
  }
  let session:Row|null=null;
  if(personType==="student")session=await studentSession(db,org,String(input.personId),date,userId);
  let record=personType==="student"
    ?await db.prepare("SELECT * FROM att_records WHERE organization_id=? AND session_id=? AND person_type='student' AND person_id=?").bind(org,session!.id,input.personId).first<Row>()
    :await db.prepare("SELECT * FROM att_records WHERE organization_id=? AND attendance_date=? AND person_type='staff' AND person_id=? AND session_id IS NULL").bind(org,date,input.personId).first<Row>();
  const minute=localMinutes(capturedAt,String(p.timezone||"Africa/Kampala"));
  const late=Math.max(0,(minute??0)-hhmm(String(p.late_after||"08:10")));
  const status=input.direction==="IN"?(late>0?"late":"present"):(record?.status||"present");
  const recordId=record?.id||createId("atr");
  if(record){
    await db.prepare(`UPDATE att_records SET status=?,first_in_at=CASE WHEN ?='IN' AND first_in_at IS NULL THEN ? ELSE first_in_at END,last_out_at=CASE WHEN ?='OUT' THEN ? ELSE last_out_at END,minutes_late=CASE WHEN ?='IN' THEN ? ELSE minutes_late END,source_method=?,official=1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`).bind(status,input.direction,capturedAt,input.direction,capturedAt,input.direction,late,input.method,recordId,org).run();
  }else{
    await db.prepare(`INSERT INTO att_records(id,organization_id,session_id,attendance_date,person_type,person_id,status,first_in_at,last_out_at,minutes_late,source_method,official,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(recordId,org,session?.id??null,date,personType,input.personId,status,input.direction==="IN"?capturedAt:null,input.direction==="OUT"?capturedAt:null,late,input.method,1,userId).run();
    if(session)await db.prepare("UPDATE att_sessions SET marked_count=marked_count+1,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(session.id).run();
  }
  const eventId=createId("ate");
  await db.prepare(`INSERT INTO att_events(id,organization_id,device_id,sync_batch_id,client_event_id,person_type,person_id,direction,method,verification_mode,verification_status,confidence,liveness_score,captured_at,synced_at,official,record_id,metadata_json,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(eventId,org,input.deviceId??null,input.syncBatchId??null,input.clientEventId??null,personType,input.personId,input.direction,input.method,input.verificationMode||"STANDARD","verified",input.confidence??null,input.livenessScore??null,capturedAt,input.syncedAt??null,input.official===false?0:1,recordId,JSON.stringify(input.metadata||{}),userId).run();
  return{duplicate:false,eventId,recordId,status,capturedAt,person:camel(person)};
}

export async function overview(db:D1Database,org:string,date:string){
  const [students,staff,recent,pending,unknown]=await Promise.all([
    db.prepare(`SELECT COUNT(*) marked,SUM(CASE WHEN status='present' THEN 1 ELSE 0 END) present,SUM(CASE WHEN status='late' THEN 1 ELSE 0 END) late,SUM(CASE WHEN status='absent' THEN 1 ELSE 0 END) absent,SUM(CASE WHEN status IN ('excused','sick','permission') THEN 1 ELSE 0 END) excused FROM att_records WHERE organization_id=? AND attendance_date=? AND person_type='student' AND official=1`).bind(org,date).first<Row>(),
    db.prepare(`SELECT COUNT(*) marked,SUM(CASE WHEN status='present' THEN 1 ELSE 0 END) present,SUM(CASE WHEN status='late' THEN 1 ELSE 0 END) late,SUM(CASE WHEN status='absent' THEN 1 ELSE 0 END) absent,SUM(CASE WHEN status='on_leave' THEN 1 ELSE 0 END) on_leave FROM att_records WHERE organization_id=? AND attendance_date=? AND person_type='staff' AND official=1`).bind(org,date).first<Row>(),
    db.prepare(`SELECT e.id,e.captured_at,e.direction,e.method,e.person_type,e.verification_mode,e.official,COALESCE(TRIM(s.first_name||' '||s.last_name),TRIM(sp.first_name||' '||sp.last_name),'Unknown') person_name,COALESCE(c.name,d.name,'—') group_name FROM att_events e LEFT JOIN school_students s ON e.person_type='student' AND s.id=e.person_id LEFT JOIN school_classes c ON c.id=s.current_class_id LEFT JOIN school_staff_profiles sp ON e.person_type='staff' AND sp.id=e.person_id LEFT JOIN school_departments d ON d.id=sp.department_id WHERE e.organization_id=? AND substr(e.captured_at,1,10)=? ORDER BY e.captured_at DESC LIMIT 30`).bind(org,date).all<Row>(),
    db.prepare("SELECT COALESCE(SUM(CASE WHEN status='received' THEN event_count ELSE 0 END),0) n FROM att_device_sync_batches WHERE organization_id=?").bind(org).first<{n:number}>(),
    db.prepare("SELECT COUNT(*) n FROM att_events WHERE organization_id=? AND substr(captured_at,1,10)=? AND verification_status IN ('unknown','rejected')").bind(org,date).first<{n:number}>()
  ]);
  const expectedStudents=await db.prepare("SELECT COUNT(*) n FROM school_students WHERE organization_id=? AND deleted_at IS NULL AND status='active'").bind(org).first<{n:number}>();
  const expectedStaff=await db.prepare("SELECT COUNT(*) n FROM school_staff_profiles WHERE organization_id=? AND deleted_at IS NULL AND employment_status='active'").bind(org).first<{n:number}>();
  return{date,students:{...camel(students||{}),expected:Number(expectedStudents?.n||0)},staff:{...camel(staff||{}),expected:Number(expectedStaff?.n||0)},recent:camels(recent.results),pendingSync:Number(pending?.n||0),recognitionFailures:Number(unknown?.n||0)};
}
