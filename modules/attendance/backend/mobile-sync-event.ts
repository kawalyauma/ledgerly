import { AppError } from "../../../src/lib/errors";
import type {
  MobileSyncMutation,
  MobileSyncMutationContext,
  PreparedMobileSyncMutation,
} from "../../mobile-sync/backend/contracts";
import * as S from "./service";
import {
  type R,
  eventPayload,
  asIso,
  localParts,
  hhmm,
  stableId,
  requireAttendanceWrite,
  auditStmt,
  issueStmt,
  rawEventStmt,
} from "./mobile-sync-event-base";

async function prepareEvent(c:MobileSyncMutationContext,m:MobileSyncMutation):Promise<PreparedMobileSyncMutation>{
  await requireAttendanceWrite(c);
  if(m.kind!=="upsert")throw new AppError(409,"APPEND_ONLY_COLLECTION","Attendance events cannot be deleted");
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,149}$/.test(m.recordId))
    throw new AppError(422,"INVALID_EVENT_ID","Attendance event IDs must be stable UUID-style identifiers");
  const parsed=eventPayload.safeParse(m.payload);
  if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid attendance event",parsed.error.flatten());
  const v=parsed.data,capturedAt=asIso(v.capturedAt);
  const personTable=v.personType==="student"?"school_students":"school_staff_profiles";
  const person=await c.db.prepare(`SELECT * FROM ${personTable} WHERE id=? AND organization_id=?`).bind(v.personId,c.organizationId).first<R>();
  if(!person)throw new AppError(404,"PERSON_NOT_FOUND",`${v.personType==="student"?"Student":"Staff member"} not found`);

  const policy=await S.policy(c.db,c.organizationId,v.personType==="student"?"students":"staff");
  const {day,minutes}=localParts(capturedAt,String(policy.timezone||"Africa/Kampala"));
  const late=Math.max(0,minutes-hhmm(String(policy.late_after||"08:10")));
  const meta:R={...(v.metadata??{}),mobileSync:true,clientTimestamp:m.clientTimestamp};

  const old=await c.db.prepare(`SELECT id,record_id AS recordId FROM att_events
    WHERE organization_id=? AND mobile_sync_device_id=? AND client_event_id=? LIMIT 1`)
    .bind(c.organizationId,c.deviceId,m.recordId).first<R>();
  if(old)return{statements:[],serverPayload:{...v,capturedAt,eventId:old.id,idempotent:true},result:{duplicate:true,eventId:old.id,recordId:old.recordId??null}};

  let verification:"verified"|"rejected"="verified",official=1,rejection:string|null=null;
  if(v.verificationMode==="TEST"){verification="rejected";official=0;rejection="TEST_MODE_NOT_ACCEPTED_FROM_GENERIC_MOBILE_SYNC";}
  else if(v.method==="FACE"&&v.verificationMode==="STANDARD"){
    const settings=await c.db.prepare(`SELECT algorithm_version AS algorithmVersion,match_threshold AS matchThreshold,
      ambiguity_margin AS ambiguityMargin,liveness_threshold AS livenessThreshold FROM att_biometric_settings WHERE organization_id=?`)
      .bind(c.organizationId).first<R>();
    const got={confidence:Number(v.confidence??0),liveness:Number(v.livenessScore??0),margin:Number(v.matchMargin??meta.matchMargin??0)};
    const required={confidence:Number(settings?.matchThreshold??.78),liveness:Number(settings?.livenessThreshold??.70),margin:Number(settings?.ambiguityMargin??.05)};
    meta.faceValidation={algorithmVersion:settings?.algorithmVersion??"facenet-128-v1",required,received:got};
    if(got.confidence<required.confidence||got.liveness<required.liveness||got.margin<required.margin){
      verification="rejected";official=0;rejection="FACE_THRESHOLD_FAILED";
    }
  }
  if(verification==="rejected"){
    meta.rejectionReason=rejection;
    return{
      statements:[
        rawEventStmt(c.db,{eventId:m.recordId,organizationId:c.organizationId,mobileDeviceId:c.deviceId,personType:v.personType,personId:v.personId,
          direction:v.direction,method:v.method,verificationMode:v.verificationMode,verificationStatus:"rejected",confidence:v.confidence,
          livenessScore:v.livenessScore,capturedAt,official,metadata:meta,userId:c.userId}),
        auditStmt(c.db,c.organizationId,c.deviceId,m.recordId,"mobile.event.rejected",meta),
      ],
      serverPayload:{...v,capturedAt,verificationStatus:"rejected",official:false,rejectionReason:rejection},
      result:{eventId:m.recordId,canonicalStatus:"rejected",rejectionReason:rejection},
    };
  }

  const cooldown=Math.max(1,Number(policy.duplicate_cooldown_seconds||60));
  const recent=await c.db.prepare(`SELECT id,record_id AS recordId,captured_at AS capturedAt FROM att_events
    WHERE organization_id=? AND person_type=? AND person_id=? AND direction=? AND verification_status='verified' AND official=1
      AND ABS((julianday(captured_at)-julianday(?))*86400.0)<=?
    ORDER BY ABS((julianday(captured_at)-julianday(?))*86400.0) LIMIT 1`)
    .bind(c.organizationId,v.personType,v.personId,v.direction,capturedAt,cooldown,capturedAt).first<R>();
  if(recent){
    const dm={...meta,duplicateOf:recent.id,duplicateCapturedAt:recent.capturedAt,cooldownSeconds:cooldown};
    return{
      statements:[
        rawEventStmt(c.db,{eventId:m.recordId,organizationId:c.organizationId,mobileDeviceId:c.deviceId,personType:v.personType,personId:v.personId,
          direction:v.direction,method:v.method,verificationMode:v.verificationMode,verificationStatus:"duplicate",confidence:v.confidence,
          livenessScore:v.livenessScore,capturedAt,official:0,metadata:dm,userId:c.userId}),
        auditStmt(c.db,c.organizationId,c.deviceId,m.recordId,"mobile.event.duplicate",dm),
      ],
      serverPayload:{...v,capturedAt,verificationStatus:"duplicate",official:false,duplicateOf:recent.id},
      result:{duplicate:true,eventId:m.recordId,duplicateOf:recent.id,recordId:recent.recordId??null},
    };
  }

  const statements:D1PreparedStatement[]=[];
  let canonicalStatus="applied",recordId:string|null=null,sessionId:string|null=null;

  if(v.personType==="student"){
    const enrollment=await c.db.prepare(`SELECT e.academic_year_id AS academicYearId,e.class_id AS classId,e.stream_id AS streamId,
      s.campus_id AS campusId,
      (SELECT t.id FROM school_terms t WHERE t.organization_id=e.organization_id AND t.academic_year_id=e.academic_year_id
       AND t.starts_on<=? AND t.ends_on>=? ORDER BY t.starts_on DESC LIMIT 1) AS termId
      FROM school_enrollments e JOIN school_students s ON s.id=e.student_id
      WHERE e.organization_id=? AND e.student_id=? AND e.enrolled_on<=? AND (e.left_on IS NULL OR e.left_on>=?)
        AND e.status IN ('active','completed','repeated') ORDER BY e.enrolled_on DESC LIMIT 1`)
      .bind(day,day,c.organizationId,v.personId,day,day).first<R>();
    if(!enrollment){
      canonicalStatus="review_required";meta.reconciliationReason="NO_ENROLLMENT_FOR_CAPTURE_DATE";
      statements.push(
        rawEventStmt(c.db,{eventId:m.recordId,organizationId:c.organizationId,mobileDeviceId:c.deviceId,personType:v.personType,personId:v.personId,
          direction:v.direction,method:v.method,verificationMode:v.verificationMode,verificationStatus:"verified",confidence:v.confidence,
          livenessScore:v.livenessScore,capturedAt,official:1,metadata:meta,userId:c.userId}),
        issueStmt(c.db,{organizationId:c.organizationId,eventId:m.recordId,personType:v.personType,personId:v.personId,attendanceDate:day,
          reasonCode:"NO_ENROLLMENT_FOR_CAPTURE_DATE",details:meta}),
        auditStmt(c.db,c.organizationId,c.deviceId,m.recordId,"mobile.event.review_required",meta),
      );
      return{statements,serverPayload:{...v,capturedAt,verificationStatus:"verified",official:true,canonicalStatus},
        result:{eventId:m.recordId,canonicalStatus,reason:"NO_ENROLLMENT_FOR_CAPTURE_DATE"}};
    }

    sessionId=await stableId("atsm",c.organizationId,day,"daily","students",String(enrollment.classId),String(enrollment.streamId??""));
    const existingSession=await c.db.prepare(`SELECT id,status FROM att_sessions WHERE organization_id=? AND attendance_date=?
      AND session_type='daily' AND population='students' AND class_id=? AND IFNULL(stream_id,'')=IFNULL(?,'') LIMIT 1`)
      .bind(c.organizationId,day,enrollment.classId,enrollment.streamId??null).first<R>();
    if(existingSession?.id)sessionId=String(existingSession.id);
    const existingRecord=existingSession?await c.db.prepare(`SELECT id,finalized FROM att_records WHERE organization_id=? AND session_id=?
      AND person_type='student' AND person_id=? LIMIT 1`).bind(c.organizationId,existingSession.id,v.personId).first<R>():null;
    if(["finalized","locked","cancelled"].includes(String(existingSession?.status??""))||Number(existingRecord?.finalized??0)===1){
      canonicalStatus="review_required";meta.reconciliationReason="SESSION_CLOSED";
      statements.push(
        rawEventStmt(c.db,{eventId:m.recordId,organizationId:c.organizationId,mobileDeviceId:c.deviceId,personType:v.personType,personId:v.personId,
          direction:v.direction,method:v.method,verificationMode:v.verificationMode,verificationStatus:"verified",confidence:v.confidence,
          livenessScore:v.livenessScore,capturedAt,official:1,recordLookup:{attendanceDate:day,sessionId},metadata:meta,userId:c.userId}),
        issueStmt(c.db,{organizationId:c.organizationId,eventId:m.recordId,personType:v.personType,personId:v.personId,attendanceDate:day,
          reasonCode:"SESSION_CLOSED",details:{...meta,sessionId,sessionStatus:existingSession?.status??null}}),
        auditStmt(c.db,c.organizationId,c.deviceId,m.recordId,"mobile.event.review_required",meta),
      );
      return{statements,serverPayload:{...v,capturedAt,verificationStatus:"verified",official:true,canonicalStatus,sessionId},
        result:{eventId:m.recordId,canonicalStatus,reason:"SESSION_CLOSED",sessionId}};
    }

    const expected=await c.db.prepare(`SELECT COUNT(*) AS n FROM school_enrollments WHERE organization_id=? AND academic_year_id=? AND class_id=?
      AND IFNULL(stream_id,'')=IFNULL(?,'') AND enrolled_on<=? AND (left_on IS NULL OR left_on>=?)
      AND status IN ('active','completed','repeated')`)
      .bind(c.organizationId,enrollment.academicYearId,enrollment.classId,enrollment.streamId??null,day,day).first<{n:number}>();
    statements.push(c.db.prepare(`INSERT OR IGNORE INTO att_sessions
      (id,organization_id,academic_year_id,term_id,campus_id,attendance_date,session_type,population,class_id,stream_id,status,expected_count,source,created_by)
      VALUES (?,?,?,?,?,?,'daily','students',?,?,'open',?,'MOBILE_SYNC',?)`)
      .bind(sessionId,c.organizationId,enrollment.academicYearId,enrollment.termId??null,enrollment.campusId??null,day,
        enrollment.classId,enrollment.streamId??null,Number(expected?.n||0),c.userId));

    recordId=existingRecord?.id?String(existingRecord.id):await stableId("atrm",c.organizationId,sessionId,"student",v.personId);
    const incoming=v.direction==="IN"?(late>0?"late":"present"):"present";
    if(v.direction==="IN"){
      statements.push(c.db.prepare(`INSERT INTO att_records
        (id,organization_id,session_id,attendance_date,person_type,person_id,status,first_in_at,last_out_at,minutes_late,source_method,official,created_by)
        VALUES (?,?,?,?, 'student',?,?,?,NULL,?,?,1,?)
        ON CONFLICT DO UPDATE SET
          first_in_at=CASE WHEN att_records.first_in_at IS NULL OR julianday(excluded.first_in_at)<julianday(att_records.first_in_at)
            THEN excluded.first_in_at ELSE att_records.first_in_at END,
          status=CASE WHEN att_records.first_in_at IS NULL OR julianday(excluded.first_in_at)<julianday(att_records.first_in_at)
            THEN excluded.status ELSE att_records.status END,
          minutes_late=CASE WHEN att_records.first_in_at IS NULL OR julianday(excluded.first_in_at)<julianday(att_records.first_in_at)
            THEN excluded.minutes_late ELSE att_records.minutes_late END,
          source_method=excluded.source_method,official=1,updated_at=CURRENT_TIMESTAMP`)
        .bind(recordId,c.organizationId,sessionId,day,v.personId,incoming,capturedAt,late,v.method,c.userId));
    }else{
      statements.push(c.db.prepare(`INSERT INTO att_records
        (id,organization_id,session_id,attendance_date,person_type,person_id,status,first_in_at,last_out_at,minutes_late,source_method,official,created_by)
        VALUES (?,?,?,?, 'student',?,'present',NULL,?,0,?,1,?)
        ON CONFLICT DO UPDATE SET
          last_out_at=CASE WHEN att_records.last_out_at IS NULL OR julianday(excluded.last_out_at)>julianday(att_records.last_out_at)
            THEN excluded.last_out_at ELSE att_records.last_out_at END,
          source_method=excluded.source_method,official=1,updated_at=CURRENT_TIMESTAMP`)
        .bind(recordId,c.organizationId,sessionId,day,v.personId,capturedAt,v.method,c.userId));
    }
    statements.push(c.db.prepare(`UPDATE att_sessions SET marked_count=(SELECT COUNT(*) FROM att_records
      WHERE organization_id=? AND session_id=? AND official=1),updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`)
      .bind(c.organizationId,sessionId,sessionId,c.organizationId));
  }else{
    const existing=await c.db.prepare(`SELECT id,finalized FROM att_records WHERE organization_id=? AND attendance_date=?
      AND person_type='staff' AND person_id=? AND session_id IS NULL LIMIT 1`).bind(c.organizationId,day,v.personId).first<R>();
    if(Number(existing?.finalized??0)===1){
      canonicalStatus="review_required";meta.reconciliationReason="RECORD_FINALIZED";
      statements.push(
        rawEventStmt(c.db,{eventId:m.recordId,organizationId:c.organizationId,mobileDeviceId:c.deviceId,personType:v.personType,personId:v.personId,
          direction:v.direction,method:v.method,verificationMode:v.verificationMode,verificationStatus:"verified",confidence:v.confidence,
          livenessScore:v.livenessScore,capturedAt,official:1,recordLookup:{attendanceDate:day},metadata:meta,userId:c.userId}),
        issueStmt(c.db,{organizationId:c.organizationId,eventId:m.recordId,personType:v.personType,personId:v.personId,attendanceDate:day,
          reasonCode:"RECORD_FINALIZED",details:meta}),
        auditStmt(c.db,c.organizationId,c.deviceId,m.recordId,"mobile.event.review_required",meta),
      );
      return{statements,serverPayload:{...v,capturedAt,verificationStatus:"verified",official:true,canonicalStatus},
        result:{eventId:m.recordId,canonicalStatus,reason:"RECORD_FINALIZED"}};
    }
    recordId=existing?.id?String(existing.id):await stableId("atrm",c.organizationId,day,"staff",v.personId);
    const incoming=v.direction==="IN"?(late>0?"late":"present"):"present";
    if(v.direction==="IN"){
      statements.push(c.db.prepare(`INSERT INTO att_records
        (id,organization_id,session_id,attendance_date,person_type,person_id,status,first_in_at,last_out_at,minutes_late,source_method,official,created_by)
        VALUES (?,?,NULL,?,'staff',?,?,?,NULL,?,?,1,?)
        ON CONFLICT DO UPDATE SET
          first_in_at=CASE WHEN att_records.first_in_at IS NULL OR julianday(excluded.first_in_at)<julianday(att_records.first_in_at)
            THEN excluded.first_in_at ELSE att_records.first_in_at END,
          status=CASE WHEN att_records.first_in_at IS NULL OR julianday(excluded.first_in_at)<julianday(att_records.first_in_at)
            THEN excluded.status ELSE att_records.status END,
          minutes_late=CASE WHEN att_records.first_in_at IS NULL OR julianday(excluded.first_in_at)<julianday(att_records.first_in_at)
            THEN excluded.minutes_late ELSE att_records.minutes_late END,
          source_method=excluded.source_method,official=1,updated_at=CURRENT_TIMESTAMP`)
        .bind(recordId,c.organizationId,day,v.personId,incoming,capturedAt,late,v.method,c.userId));
    }else{
      statements.push(c.db.prepare(`INSERT INTO att_records
        (id,organization_id,session_id,attendance_date,person_type,person_id,status,first_in_at,last_out_at,minutes_late,source_method,official,created_by)
        VALUES (?,?,NULL,?,'staff',?,'present',NULL,?,0,?,1,?)
        ON CONFLICT DO UPDATE SET
          last_out_at=CASE WHEN att_records.last_out_at IS NULL OR julianday(excluded.last_out_at)>julianday(att_records.last_out_at)
            THEN excluded.last_out_at ELSE att_records.last_out_at END,
          source_method=excluded.source_method,official=1,updated_at=CURRENT_TIMESTAMP`)
        .bind(recordId,c.organizationId,day,v.personId,capturedAt,v.method,c.userId));
    }
  }

  meta.canonicalRecordId=recordId;meta.sessionId=sessionId;
  statements.push(
    rawEventStmt(c.db,{eventId:m.recordId,organizationId:c.organizationId,mobileDeviceId:c.deviceId,personType:v.personType,personId:v.personId,
      direction:v.direction,method:v.method,verificationMode:v.verificationMode,verificationStatus:"verified",confidence:v.confidence,
      livenessScore:v.livenessScore,capturedAt,official:1,recordLookup:{attendanceDate:day,sessionId},metadata:meta,userId:c.userId}),
    auditStmt(c.db,c.organizationId,c.deviceId,m.recordId,"mobile.event.applied",meta),
  );
  return{statements,serverPayload:{...v,capturedAt,verificationStatus:"verified",official:true,canonicalStatus,canonicalRecordId:recordId,sessionId},
    result:{eventId:m.recordId,canonicalStatus,recordId,sessionId}};
}

export { prepareEvent as prepareAttendanceMobileEvent };
