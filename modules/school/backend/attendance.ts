import { Hono } from "hono";
import { z } from "zod";
import type { AppVariables, Env } from "../../../src/types";
import { requireScope } from "../../../src/lib/auth";
import { AppError } from "../../../src/lib/errors";
import { createId } from "../../../src/lib/ids";
import { audit, camelizeRow, camelizeRows, date, parseJson, schoolPermission } from "./common";

export const schoolAttendanceRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();
schoolAttendanceRoutes.use("*", requireScope("school:read"));

type Row = Record<string, unknown>;
type StudentStatus = "present" | "absent" | "late" | "excused" | "sick" | "permission";
type StaffStatus = "present" | "absent" | "late" | "on_leave" | "sick" | "official_duty" | "remote" | "half_day";

const studentStatuses = ["present", "absent", "late", "excused", "sick", "permission"] as const;
const staffStatuses = ["present", "absent", "late", "on_leave", "sick", "official_duty", "remote", "half_day"] as const;
const sessionTypes = ["daily", "period", "assembly", "event", "other"] as const;
const sourceTypes = ["manual", "import", "api", "device"] as const;
const staffSourceTypes = ["manual", "clock", "import", "api", "device"] as const;

function asText(v: unknown) { return v == null ? null : String(v); }
function asNumber(v: unknown) { return v == null ? 0 : Number(v) || 0; }
function nowIso() { return new Date().toISOString(); }
function dateOnly(value: string) { return value.slice(0, 10); }
function minutesBetween(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return 0;
  const x = new Date(a).getTime(), y = new Date(b).getTime();
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
  return Math.max(0, Math.round((y - x) / 60000));
}
function hhmmMinutes(value: string | null | undefined) {
  if (!value) return null; const m = /^(\d{1,2}):(\d{2})/.exec(value); if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]); return h >= 0 && h < 24 && min >= 0 && min < 60 ? h * 60 + min : null;
}
function zonedMinutes(value: string | null | undefined, timeZone: string) {
  if (!value) return null; if (/^\d{1,2}:\d{2}/.test(value)) return hhmmMinutes(value);
  const d = new Date(value); if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const h = Number(parts.find(x => x.type === "hour")?.value), m = Number(parts.find(x => x.type === "minute")?.value);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}


async function ensureOrgRef(db: D1Database, org: string, table: string, id: string | null | undefined, label: string) {
  if (!id) return;
  const allowed = new Set(["school_academic_years", "school_terms", "school_branches", "school_classes", "school_streams", "school_subjects", "school_lesson_periods", "school_students", "school_staff_profiles"]);
  if (!allowed.has(table)) throw new Error("Unsafe attendance reference");
  const row = await db.prepare(`SELECT 1 FROM ${table} WHERE id=? AND organization_id=?`).bind(id, org).first();
  if (!row) throw new AppError(422, "INVALID_REFERENCE", `${label} does not belong to this school`);
}

async function academicContext(db: D1Database, org: string, attendanceDate: string) {
  const term = await db.prepare(`SELECT t.id AS term_id,t.academic_year_id FROM school_terms t
    WHERE t.organization_id=? AND t.starts_on<=? AND t.ends_on>=?
    ORDER BY t.is_current DESC,t.starts_on DESC LIMIT 1`).bind(org, attendanceDate, attendanceDate).first<{ term_id: string; academic_year_id: string }>();
  if (term) return { termId: term.term_id, academicYearId: term.academic_year_id };
  const year = await db.prepare(`SELECT id FROM school_academic_years WHERE organization_id=? AND starts_on<=? AND ends_on>=? ORDER BY is_current DESC,starts_on DESC LIMIT 1`).bind(org, attendanceDate, attendanceDate).first<{ id: string }>();
  if (!year) throw new AppError(409, "ACADEMIC_PERIOD_NOT_FOUND", `No academic year covers ${attendanceDate}. Configure the academic calendar first.`);
  return { termId: null, academicYearId: year.id };
}

async function studentRoster(db: D1Database, org: string, yearId: string, classId: string, streamId: string | null, attendanceDate: string) {
  const streamClause = streamId ? "AND e.stream_id=?" : "";
  const binds: unknown[] = [org, yearId, classId, attendanceDate, attendanceDate];
  if (streamId) binds.push(streamId);
  const result = await db.prepare(`SELECT s.id,s.admission_number,s.student_number,s.first_name,s.middle_name,s.last_name,
      e.stream_id,st.name AS stream_name
    FROM school_enrollments e
    JOIN school_students s ON s.id=e.student_id AND s.organization_id=e.organization_id
    LEFT JOIN school_streams st ON st.id=e.stream_id
    WHERE e.organization_id=? AND e.academic_year_id=? AND e.class_id=?
      AND e.enrolled_on<=? AND (e.left_on IS NULL OR e.left_on>=?)
      AND e.status IN ('active','completed','repeated')
      AND s.deleted_at IS NULL AND s.status IN ('active','suspended') ${streamClause}
    ORDER BY st.name,s.last_name,s.first_name`).bind(...binds).all<Row>();
  return result.results;
}

async function sessionById(db: D1Database, org: string, id: string) {
  const row = await db.prepare(`SELECT a.*,c.name AS class_name,st.name AS stream_name,su.name AS subject_name,lp.name AS lesson_period_name,
      ay.name AS academic_year_name,t.name AS term_name
    FROM school_student_attendance_sessions a
    JOIN school_classes c ON c.id=a.class_id
    LEFT JOIN school_streams st ON st.id=a.stream_id
    LEFT JOIN school_subjects su ON su.id=a.subject_id
    LEFT JOIN school_lesson_periods lp ON lp.id=a.lesson_period_id
    LEFT JOIN school_academic_years ay ON ay.id=a.academic_year_id
    LEFT JOIN school_terms t ON t.id=a.term_id
    WHERE a.id=? AND a.organization_id=?`).bind(id, org).first<Row>();
  if (!row) throw new AppError(404, "ATTENDANCE_SESSION_NOT_FOUND", "Attendance session not found");
  return row;
}

const sessionSchema = z.object({
  attendanceDate: date,
  sessionType: z.enum(sessionTypes).default("daily"),
  academicYearId: z.string().optional().nullable(), termId: z.string().optional().nullable(), campusId: z.string().optional().nullable(),
  classId: z.string().min(1), streamId: z.string().optional().nullable(), subjectId: z.string().optional().nullable(), lessonPeriodId: z.string().optional().nullable(),
  title: z.string().max(200).optional().nullable(), startsAt: z.string().max(40).optional().nullable(), endsAt: z.string().max(40).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(), source: z.enum(sourceTypes).default("manual")
});

schoolAttendanceRoutes.get("/overview", schoolPermission("school.attendance:read"), async c => {
  const p = c.get("principal"), day = c.req.query("date") || new Date().toISOString().slice(0, 10);
  if (!date.safeParse(day).success) throw new AppError(422, "VALIDATION_ERROR", "Invalid attendance date");
  const [student, staff] = await Promise.all([
    c.env.FINANCE_DB.prepare(`WITH ss AS (SELECT id,expected_count,marked_count FROM school_student_attendance_sessions WHERE organization_id=? AND attendance_date=? AND status<>'cancelled')
      SELECT (SELECT COUNT(*) FROM ss) AS sessions,(SELECT COALESCE(SUM(expected_count),0) FROM ss) AS expected,(SELECT COALESCE(SUM(marked_count),0) FROM ss) AS marked,
      COALESCE(SUM(CASE WHEN r.status='present' THEN 1 ELSE 0 END),0) AS present,COALESCE(SUM(CASE WHEN r.status='absent' THEN 1 ELSE 0 END),0) AS absent,
      COALESCE(SUM(CASE WHEN r.status='late' THEN 1 ELSE 0 END),0) AS late,COALESCE(SUM(CASE WHEN r.status IN ('excused','sick','permission') THEN 1 ELSE 0 END),0) AS excused
      FROM ss LEFT JOIN school_student_attendance_records r ON r.session_id=ss.id`).bind(p.organizationId, day).first<Row>(),
    c.env.FINANCE_DB.prepare(`SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN status='present' THEN 1 ELSE 0 END),0) AS present,
      COALESCE(SUM(CASE WHEN status='absent' THEN 1 ELSE 0 END),0) AS absent,
      COALESCE(SUM(CASE WHEN status='late' THEN 1 ELSE 0 END),0) AS late,
      COALESCE(SUM(CASE WHEN status IN ('on_leave','sick','official_duty','remote','half_day') THEN 1 ELSE 0 END),0) AS other,
      COALESCE(SUM(worked_minutes),0) AS worked_minutes
      FROM school_staff_attendance_records WHERE organization_id=? AND attendance_date=?`).bind(p.organizationId, day).first<Row>()
  ]);
  return c.json({ data: { date: day, students: camelizeRow(student || {}), staff: camelizeRow(staff || {}) } });
});

schoolAttendanceRoutes.get("/student/sessions", schoolPermission("school.attendance:read"), async c => {
  const p = c.get("principal"), clauses = ["a.organization_id=?"], binds: unknown[] = [p.organizationId];
  for (const [q, col] of [["date", "attendance_date"], ["classId", "class_id"], ["streamId", "stream_id"], ["status", "status"], ["sessionType", "session_type"]] as const) {
    const v = c.req.query(q); if (v) { clauses.push(`a.${col}=?`); binds.push(v); }
  }
  const rows = await c.env.FINANCE_DB.prepare(`SELECT a.*,c.name AS class_name,st.name AS stream_name,su.name AS subject_name,lp.name AS lesson_period_name
    FROM school_student_attendance_sessions a JOIN school_classes c ON c.id=a.class_id
    LEFT JOIN school_streams st ON st.id=a.stream_id LEFT JOIN school_subjects su ON su.id=a.subject_id LEFT JOIN school_lesson_periods lp ON lp.id=a.lesson_period_id
    WHERE ${clauses.join(" AND ")} ORDER BY a.attendance_date DESC,c.name,st.name,a.created_at DESC LIMIT 500`).bind(...binds).all<Row>();
  return c.json({ data: camelizeRows(rows.results) });
});

schoolAttendanceRoutes.post("/student/sessions", requireScope("school:write"), schoolPermission("school.attendance.student:write"), async c => {
  const p = c.get("principal"), parsed = sessionSchema.safeParse(await c.req.json());
  if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid student attendance session", parsed.error.flatten());
  const v = parsed.data, ctx = v.academicYearId ? { academicYearId: v.academicYearId, termId: v.termId ?? null } : await academicContext(c.env.FINANCE_DB, p.organizationId, v.attendanceDate);
  await ensureOrgRef(c.env.FINANCE_DB, p.organizationId, "school_academic_years", ctx.academicYearId, "Academic year");
  await ensureOrgRef(c.env.FINANCE_DB, p.organizationId, "school_terms", ctx.termId, "Term");
  await ensureOrgRef(c.env.FINANCE_DB, p.organizationId, "school_classes", v.classId, "Class");
  await ensureOrgRef(c.env.FINANCE_DB, p.organizationId, "school_streams", v.streamId, "Stream");
  await ensureOrgRef(c.env.FINANCE_DB, p.organizationId, "school_subjects", v.subjectId, "Subject");
  await ensureOrgRef(c.env.FINANCE_DB, p.organizationId, "school_lesson_periods", v.lessonPeriodId, "Lesson period");
  const existing = await c.env.FINANCE_DB.prepare(`SELECT id FROM school_student_attendance_sessions WHERE organization_id=? AND attendance_date=? AND session_type=? AND class_id=? AND IFNULL(stream_id,'')=IFNULL(?,'') AND IFNULL(subject_id,'')=IFNULL(?,'') AND IFNULL(lesson_period_id,'')=IFNULL(?,'')`).bind(p.organizationId, v.attendanceDate, v.sessionType, v.classId, v.streamId ?? null, v.subjectId ?? null, v.lessonPeriodId ?? null).first<{ id: string }>();
  if (existing) return c.json({ data: camelizeRow(await sessionById(c.env.FINANCE_DB, p.organizationId, existing.id)) });
  if (v.sessionType === "daily") {
    const overlap = v.streamId ? await c.env.FINANCE_DB.prepare("SELECT id FROM school_student_attendance_sessions WHERE organization_id=? AND attendance_date=? AND session_type='daily' AND class_id=? AND stream_id IS NULL AND status<>'cancelled' LIMIT 1").bind(p.organizationId,v.attendanceDate,v.classId).first<{id:string}>() : await c.env.FINANCE_DB.prepare("SELECT id FROM school_student_attendance_sessions WHERE organization_id=? AND attendance_date=? AND session_type='daily' AND class_id=? AND stream_id IS NOT NULL AND status<>'cancelled' LIMIT 1").bind(p.organizationId,v.attendanceDate,v.classId).first<{id:string}>();
    if (overlap) throw new AppError(409,"OVERLAPPING_ATTENDANCE_SESSION","A whole-class and stream-specific daily register cannot overlap on the same date. Use the existing register structure for this class.");
  }
  const roster = await studentRoster(c.env.FINANCE_DB, p.organizationId, ctx.academicYearId, v.classId, v.streamId ?? null, v.attendanceDate), id = createId("ats");
  await c.env.FINANCE_DB.prepare(`INSERT INTO school_student_attendance_sessions
    (id,organization_id,academic_year_id,term_id,campus_id,attendance_date,session_type,class_id,stream_id,subject_id,lesson_period_id,title,starts_at,ends_at,status,expected_count,source,notes,marked_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'open',?,?,?,?)`).bind(id,p.organizationId,ctx.academicYearId,ctx.termId,v.campusId??null,v.attendanceDate,v.sessionType,v.classId,v.streamId??null,v.subjectId??null,v.lessonPeriodId??null,v.title??null,v.startsAt??null,v.endsAt??null,roster.length,v.source,v.notes??null,p.userId).run();
  await audit(c.env.FINANCE_DB,c,"school.attendance.student_session.created","school_student_attendance_session",id,{...v,expectedCount:roster.length});
  return c.json({ data: camelizeRow(await sessionById(c.env.FINANCE_DB, p.organizationId, id)) }, 201);
});

schoolAttendanceRoutes.get("/student/sessions/:id", schoolPermission("school.attendance:read"), async c => {
  const p = c.get("principal"), raw = await sessionById(c.env.FINANCE_DB, p.organizationId, c.req.param("id"));
  const yearId = String(raw.academic_year_id), classId = String(raw.class_id), streamId = asText(raw.stream_id), day = String(raw.attendance_date);
  const roster = await studentRoster(c.env.FINANCE_DB, p.organizationId, yearId, classId, streamId, day);
  const records = await c.env.FINANCE_DB.prepare(`SELECT r.* FROM school_student_attendance_records r WHERE r.organization_id=? AND r.session_id=?`).bind(p.organizationId, c.req.param("id")).all<Row>();
  const recordMap = new Map(records.results.map(r => [String(r.student_id), camelizeRow(r)]));
  const students = roster.map(s => ({ ...camelizeRow(s), attendance: recordMap.get(String(s.id)) || null }));
  const counts = records.results.reduce((acc: Record<string, number>, r) => { const k = String(r.status); acc[k] = (acc[k] || 0) + 1; return acc; }, {});
  return c.json({ data: { ...camelizeRow(raw), students, counts } });
});

const studentRecordSchema = z.object({ studentId: z.string().min(1), status: z.enum(studentStatuses), arrivalTime: z.string().max(30).optional().nullable(), departureTime: z.string().max(30).optional().nullable(), minutesLate: z.number().int().min(0).max(1440).default(0), reasonCode: z.string().max(80).optional().nullable(), reason: z.string().max(500).optional().nullable(), remarks: z.string().max(1000).optional().nullable(), source: z.enum(sourceTypes).default("manual"), correctionReason: z.string().max(1000).optional().nullable() });
const bulkStudentSchema = z.object({ records: z.array(studentRecordSchema).min(1).max(1500) });

schoolAttendanceRoutes.put("/student/sessions/:id/records", requireScope("school:write"), schoolPermission("school.attendance.student:write"), async c => {
  const p = c.get("principal"), id = c.req.param("id"), session = await sessionById(c.env.FINANCE_DB, p.organizationId, id), parsed = bulkStudentSchema.safeParse(await c.req.json());
  if (!parsed.success) throw new AppError(422,"VALIDATION_ERROR","Invalid attendance register",parsed.error.flatten());
  if (session.status === "locked") throw new AppError(409,"ATTENDANCE_LOCKED","This attendance register is locked. Reopen it before making changes.");
  if (session.status === "cancelled") throw new AppError(409,"ATTENDANCE_CANCELLED","This attendance register was cancelled.");
  const roster = await studentRoster(c.env.FINANCE_DB,p.organizationId,String(session.academic_year_id),String(session.class_id),asText(session.stream_id),String(session.attendance_date));
  const allowed = new Set(roster.map(r => String(r.id))), existingRows = await c.env.FINANCE_DB.prepare("SELECT * FROM school_student_attendance_records WHERE organization_id=? AND session_id=?").bind(p.organizationId,id).all<Row>();
  const existing = new Map(existingRows.results.map(r => [String(r.student_id), r]));
  const statements: D1PreparedStatement[] = [], changes: D1PreparedStatement[] = [];
  for (const rec of parsed.data.records) {
    if (!allowed.has(rec.studentId)) throw new AppError(422,"STUDENT_NOT_IN_REGISTER","One or more learners do not belong to this attendance register");
    const old = existing.get(rec.studentId), recordId = old ? String(old.id) : createId("atr");
    if (old) {
      const changed = String(old.status)!==rec.status || asText(old.arrival_time)!==(rec.arrivalTime??null) || asText(old.departure_time)!==(rec.departureTime??null) || asNumber(old.minutes_late)!==rec.minutesLate || asText(old.reason)!==(rec.reason??null) || asText(old.remarks)!==(rec.remarks??null);
      if (changed && session.status === "submitted" && !rec.correctionReason?.trim()) throw new AppError(422,"CORRECTION_REASON_REQUIRED",`A correction reason is required after submission (${rec.studentId}).`);
      if (changed) changes.push(c.env.FINANCE_DB.prepare(`INSERT INTO school_student_attendance_changes (id,organization_id,record_id,session_id,student_id,previous_status,new_status,before_json,after_json,reason,changed_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(createId("atc"),p.organizationId,recordId,id,rec.studentId,String(old.status),rec.status,JSON.stringify(camelizeRow(old)),JSON.stringify(rec),rec.correctionReason?.trim()||"Register updated before submission",p.userId));
      statements.push(c.env.FINANCE_DB.prepare(`UPDATE school_student_attendance_records SET status=?,arrival_time=?,departure_time=?,minutes_late=?,reason_code=?,reason=?,remarks=?,source=?,marked_by=?,marked_at=CURRENT_TIMESTAMP,corrected_by=?,correction_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`).bind(rec.status,rec.arrivalTime??null,rec.departureTime??null,rec.minutesLate,rec.reasonCode??null,rec.reason??null,rec.remarks??null,rec.source,p.userId,changed?p.userId:null,changed?(rec.correctionReason?.trim()||"Register updated before submission"):null,recordId,p.organizationId));
    } else statements.push(c.env.FINANCE_DB.prepare(`INSERT INTO school_student_attendance_records (id,organization_id,session_id,student_id,status,arrival_time,departure_time,minutes_late,reason_code,reason,remarks,source,marked_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(recordId,p.organizationId,id,rec.studentId,rec.status,rec.arrivalTime??null,rec.departureTime??null,rec.minutesLate,rec.reasonCode??null,rec.reason??null,rec.remarks??null,rec.source,p.userId));
  }
  if (changes.length) statements.push(...changes);
  if (statements.length) await c.env.FINANCE_DB.batch(statements);
  const count = await c.env.FINANCE_DB.prepare("SELECT COUNT(*) AS n FROM school_student_attendance_records WHERE organization_id=? AND session_id=?").bind(p.organizationId,id).first<{n:number}>();
  await c.env.FINANCE_DB.prepare("UPDATE school_student_attendance_sessions SET marked_count=?,marked_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(Number(count?.n||0),p.userId,id,p.organizationId).run();
  await audit(c.env.FINANCE_DB,c,"school.attendance.student_register.saved","school_student_attendance_session",id,{records:parsed.data.records.length});
  return c.json({ data: { sessionId:id, saved:parsed.data.records.length, markedCount:Number(count?.n||0) } });
});

schoolAttendanceRoutes.post("/student/sessions/:id/submit", requireScope("school:write"), schoolPermission("school.attendance.student:write"), async c => {
  const p=c.get("principal"), id=c.req.param("id"), row=await sessionById(c.env.FINANCE_DB,p.organizationId,id);
  if(row.status==="locked")throw new AppError(409,"ATTENDANCE_LOCKED","This register is already locked");
  if(Number(row.marked_count)<Number(row.expected_count))throw new AppError(409,"ATTENDANCE_INCOMPLETE",`${Number(row.expected_count)-Number(row.marked_count)} learners are still unmarked.`);
  await c.env.FINANCE_DB.prepare("UPDATE school_student_attendance_sessions SET status='submitted',submitted_by=?,submitted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(p.userId,id,p.organizationId).run();
  await audit(c.env.FINANCE_DB,c,"school.attendance.student_register.submitted","school_student_attendance_session",id);return c.json({data:{id,status:"submitted"}})
});

schoolAttendanceRoutes.post("/student/sessions/:id/lock", requireScope("school:write"), schoolPermission("school.attendance:manage"), async c => {
  const p=c.get("principal"),id=c.req.param("id"),row=await sessionById(c.env.FINANCE_DB,p.organizationId,id);
  if(row.status!=="submitted"&&row.status!=="locked")throw new AppError(409,"ATTENDANCE_NOT_SUBMITTED","Submit the register before locking it.");
  await c.env.FINANCE_DB.prepare("UPDATE school_student_attendance_sessions SET status='locked',locked_by=?,locked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(p.userId,id,p.organizationId).run();
  await audit(c.env.FINANCE_DB,c,"school.attendance.student_register.locked","school_student_attendance_session",id);return c.json({data:{id,status:"locked"}})
});

const reopenSchema=z.object({reason:z.string().min(3).max(1000)});
schoolAttendanceRoutes.post("/student/sessions/:id/reopen", requireScope("school:write"), schoolPermission("school.attendance:manage"), async c=>{
  const p=c.get("principal"),id=c.req.param("id"),s=reopenSchema.safeParse(await c.req.json());if(!s.success)throw new AppError(422,"VALIDATION_ERROR","A reason is required to reopen attendance",s.error.flatten());
  await sessionById(c.env.FINANCE_DB,p.organizationId,id);await c.env.FINANCE_DB.prepare("UPDATE school_student_attendance_sessions SET status='open',locked_by=NULL,locked_at=NULL,submitted_by=NULL,submitted_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(id,p.organizationId).run();
  await audit(c.env.FINANCE_DB,c,"school.attendance.student_register.reopened","school_student_attendance_session",id,{reason:s.data.reason});return c.json({data:{id,status:"open"}})
});

schoolAttendanceRoutes.get("/student/:studentId/history", schoolPermission("school.attendance:read"), async c=>{
  const p=c.get("principal"),studentId=c.req.param("studentId");await ensureOrgRef(c.env.FINANCE_DB,p.organizationId,"school_students",studentId,"Student");
  const from=c.req.query("from")||"0000-01-01",to=c.req.query("to")||"9999-12-31";
  const rows=await c.env.FINANCE_DB.prepare(`SELECT r.*,a.attendance_date,a.session_type,a.status AS session_status,c.name AS class_name,st.name AS stream_name,su.name AS subject_name,lp.name AS lesson_period_name
    FROM school_student_attendance_records r JOIN school_student_attendance_sessions a ON a.id=r.session_id
    LEFT JOIN school_classes c ON c.id=a.class_id LEFT JOIN school_streams st ON st.id=a.stream_id LEFT JOIN school_subjects su ON su.id=a.subject_id LEFT JOIN school_lesson_periods lp ON lp.id=a.lesson_period_id
    WHERE r.organization_id=? AND r.student_id=? AND a.attendance_date BETWEEN ? AND ? AND a.status<>'cancelled' ORDER BY a.attendance_date DESC,a.created_at DESC`).bind(p.organizationId,studentId,from,to).all<Row>();
  return c.json({data:camelizeRows(rows.results)});
});

schoolAttendanceRoutes.get("/student/report", schoolPermission("school.attendance:read"), async c=>{
  const p=c.get("principal"),from=c.req.query("from")||"0000-01-01",to=c.req.query("to")||"9999-12-31",classId=c.req.query("classId"),streamId=c.req.query("streamId"),sessionType=c.req.query("sessionType")||"daily";
  const clauses=["r.organization_id=?","a.attendance_date BETWEEN ? AND ?","a.status IN ('submitted','locked','open')"],binds:unknown[]=[p.organizationId,from,to];
  if(classId){clauses.push("a.class_id=?");binds.push(classId)}if(streamId){clauses.push("a.stream_id=?");binds.push(streamId)}if(sessionType){clauses.push("a.session_type=?");binds.push(sessionType)}
  const rows=await c.env.FINANCE_DB.prepare(`SELECT s.id AS student_id,s.admission_number,s.student_number,s.first_name,s.middle_name,s.last_name,
    COUNT(*) AS marked_sessions,
    SUM(CASE WHEN r.status='present' THEN 1 ELSE 0 END) AS present,
    SUM(CASE WHEN r.status='late' THEN 1 ELSE 0 END) AS late,
    SUM(CASE WHEN r.status='absent' THEN 1 ELSE 0 END) AS absent,
    SUM(CASE WHEN r.status='sick' THEN 1 ELSE 0 END) AS sick,
    SUM(CASE WHEN r.status='excused' THEN 1 ELSE 0 END) AS excused,
    SUM(CASE WHEN r.status='permission' THEN 1 ELSE 0 END) AS permission,
    ROUND(100.0*SUM(CASE WHEN r.status IN ('present','late') THEN 1 ELSE 0 END)/NULLIF(SUM(CASE WHEN r.status IN ('present','late','absent','sick') THEN 1 ELSE 0 END),0),2) AS attendance_percent
    FROM school_student_attendance_records r JOIN school_student_attendance_sessions a ON a.id=r.session_id JOIN school_students s ON s.id=r.student_id
    WHERE ${clauses.join(" AND ")} GROUP BY s.id ORDER BY s.last_name,s.first_name`).bind(...binds).all<Row>();
  return c.json({data:camelizeRows(rows.results)});
});

async function staffSchedule(db:D1Database,org:string){
  const [row,profile]=await Promise.all([db.prepare("SELECT value_json AS value FROM school_settings WHERE organization_id=? AND setting_group='attendance' AND setting_key='staff_schedule'").bind(org).first<{value:string}>(),db.prepare("SELECT timezone FROM school_profiles WHERE organization_id=?").bind(org).first<{timezone:string}>()]);
  const v=row?parseJson<Record<string,unknown>>(row.value,{}):{};return{startTime:String(v.startTime||"08:00"),endTime:String(v.endTime||"17:00"),graceMinutes:Math.max(0,Number(v.graceMinutes||10)),timezone:String(profile?.timezone||"Africa/Kampala")};
}
async function ensureStaff(db:D1Database,org:string,staffId:string){const row=await db.prepare("SELECT * FROM school_staff_profiles WHERE id=? AND organization_id=? AND deleted_at IS NULL").bind(staffId,org).first<Row>();if(!row)throw new AppError(404,"STAFF_NOT_FOUND","Staff member not found");return row}
async function staffRecord(db:D1Database,org:string,staffId:string,day:string){return db.prepare("SELECT * FROM school_staff_attendance_records WHERE organization_id=? AND staff_id=? AND attendance_date=?").bind(org,staffId,day).first<Row>()}
async function ensureStaffDay(db:D1Database,org:string,userId:string,staff:Row,day:string){
  const dayLock=await db.prepare("SELECT 1 FROM school_staff_attendance_day_locks WHERE organization_id=? AND attendance_date=?").bind(org,day).first();if(dayLock)throw new AppError(409,"ATTENDANCE_LOCKED","Staff attendance is locked for this day");
  let row=await staffRecord(db,org,String(staff.id),day);if(row)return row;const schedule=await staffSchedule(db,org),id=createId("sar");
  await db.prepare(`INSERT INTO school_staff_attendance_records (id,organization_id,staff_id,attendance_date,campus_id,department_id,status,scheduled_start,scheduled_end,source,created_by) VALUES (?,?,?,?,?,?,'present',?,?,'clock',?)`).bind(id,org,staff.id,day,staff.campus_id??null,staff.department_id??null,schedule.startTime,schedule.endTime,userId).run();
  row=await staffRecord(db,org,String(staff.id),day);return row!;
}
async function recomputeStaffDay(db:D1Database,org:string,record:Row){
  const events=await db.prepare("SELECT * FROM school_staff_attendance_events WHERE organization_id=? AND daily_record_id=? ORDER BY event_at,created_at").bind(org,record.id).all<Row>();
  let firstIn:string|null=null,lastOut:string|null=null,activeStart:string|null=null,breakStart:string|null=null,worked=0,breaks=0;
  for(const e of events.results){const at=String(e.event_at),type=String(e.event_type);if(type==="clock_in"){if(!firstIn)firstIn=at;if(!activeStart)activeStart=at}else if(type==="break_out"){if(activeStart){worked+=minutesBetween(activeStart,at);activeStart=null}if(!breakStart)breakStart=at}else if(type==="break_in"){if(breakStart){breaks+=minutesBetween(breakStart,at);breakStart=null}activeStart=at}else if(type==="clock_out"){if(activeStart){worked+=minutesBetween(activeStart,at);activeStart=null}if(breakStart){breaks+=minutesBetween(breakStart,at);breakStart=null}lastOut=at}}
  const schedule=await staffSchedule(db,org),scheduledStart=hhmmMinutes(asText(record.scheduled_start)),scheduledEnd=hhmmMinutes(asText(record.scheduled_end)),firstLocal=zonedMinutes(firstIn,schedule.timezone);
  const late=firstLocal!=null&&scheduledStart!=null?Math.max(0,firstLocal-scheduledStart-schedule.graceMinutes):0;
  const scheduled=scheduledStart!=null&&scheduledEnd!=null?Math.max(0,scheduledEnd-scheduledStart):0,overtime=Math.max(0,worked-scheduled);
  const protectedStatus=["on_leave","sick","official_duty","remote","half_day","absent"].includes(String(record.status));const status:StaffStatus=protectedStatus?String(record.status) as StaffStatus:(late>0?"late":"present");
  await db.prepare("UPDATE school_staff_attendance_records SET first_clock_in=?,last_clock_out=?,worked_minutes=?,break_minutes=?,overtime_minutes=?,minutes_late=?,status=?,source='clock',updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(firstIn,lastOut,worked,breaks,overtime,late,status,record.id,org).run();
  return staffRecord(db,org,String(record.staff_id),String(record.attendance_date));
}

schoolAttendanceRoutes.get("/staff/day", schoolPermission("school.attendance:read"), async c=>{
  const p=c.get("principal"),day=c.req.query("date")||new Date().toISOString().slice(0,10);if(!date.safeParse(day).success)throw new AppError(422,"VALIDATION_ERROR","Invalid attendance date");
  const departmentId=c.req.query("departmentId"),campusId=c.req.query("campusId"),clauses=["sp.organization_id=?","sp.deleted_at IS NULL","sp.employment_status IN ('active','on_leave','suspended')"],binds:unknown[]=[p.organizationId];
  if(departmentId){clauses.push("sp.department_id=?");binds.push(departmentId)}if(campusId){clauses.push("sp.campus_id=?");binds.push(campusId)};
  const dayLock=await c.env.FINANCE_DB.prepare("SELECT locked_by,locked_at,reason FROM school_staff_attendance_day_locks WHERE organization_id=? AND attendance_date=?").bind(p.organizationId,day).first<Row>();
  const rows=await c.env.FINANCE_DB.prepare(`SELECT sp.id AS staff_id,sp.staff_number,sp.first_name,sp.middle_name,sp.last_name,sp.is_teacher,sp.employment_status,sp.department_id,sp.campus_id,
    d.name AS department_name,pos.name AS position_name,b.name AS campus_name,
    ar.id AS attendance_id,ar.status,ar.scheduled_start,ar.scheduled_end,ar.first_clock_in,ar.last_clock_out,ar.worked_minutes,ar.break_minutes,ar.overtime_minutes,ar.minutes_late,ar.leave_type,ar.reason,ar.notes,ar.source,ar.locked
    FROM school_staff_profiles sp LEFT JOIN school_departments d ON d.id=sp.department_id LEFT JOIN school_staff_positions pos ON pos.id=sp.position_id LEFT JOIN school_branches b ON b.id=sp.campus_id
    LEFT JOIN school_staff_attendance_records ar ON ar.organization_id=sp.organization_id AND ar.staff_id=sp.id AND ar.attendance_date=?
    WHERE ${clauses.join(" AND ")} ORDER BY sp.last_name,sp.first_name`).bind(day,...binds).all<Row>();
  return c.json({data:{date:day,locked:Boolean(dayLock),lock:dayLock?camelizeRow(dayLock):null,rows:camelizeRows(rows.results)}});
});

const staffBulkItem=z.object({staffId:z.string(),status:z.enum(staffStatuses),scheduledStart:z.string().max(20).optional().nullable(),scheduledEnd:z.string().max(20).optional().nullable(),firstClockIn:z.string().max(40).optional().nullable(),lastClockOut:z.string().max(40).optional().nullable(),leaveType:z.string().max(100).optional().nullable(),reason:z.string().max(500).optional().nullable(),notes:z.string().max(1000).optional().nullable(),source:z.enum(staffSourceTypes).default("manual"),correctionReason:z.string().max(1000).optional().nullable()});
const staffBulkSchema=z.object({attendanceDate:date,records:z.array(staffBulkItem).min(1).max(1000)});
schoolAttendanceRoutes.put("/staff/day", requireScope("school:write"), schoolPermission("school.attendance.staff:write"), async c=>{
  const p=c.get("principal"),s=staffBulkSchema.safeParse(await c.req.json());if(!s.success)throw new AppError(422,"VALIDATION_ERROR","Invalid staff attendance",s.error.flatten());const dayLock=await c.env.FINANCE_DB.prepare("SELECT 1 FROM school_staff_attendance_day_locks WHERE organization_id=? AND attendance_date=?").bind(p.organizationId,s.data.attendanceDate).first();if(dayLock)throw new AppError(409,"ATTENDANCE_LOCKED","Staff attendance is locked for this day");const schedule=await staffSchedule(c.env.FINANCE_DB,p.organizationId),stmts:D1PreparedStatement[]=[];
  for(const x of s.data.records){const staff=await ensureStaff(c.env.FINANCE_DB,p.organizationId,x.staffId),old=await staffRecord(c.env.FINANCE_DB,p.organizationId,x.staffId,s.data.attendanceDate);if(old&&Number(old.locked))throw new AppError(409,"ATTENDANCE_LOCKED",`Attendance is locked for staff ${x.staffId}`);
    const schedStart=x.scheduledStart??asText(old?.scheduled_start)??schedule.startTime,schedEnd=x.scheduledEnd??asText(old?.scheduled_end)??schedule.endTime,first=x.firstClockIn??asText(old?.first_clock_in),last=x.lastClockOut??asText(old?.last_clock_out);
    const worked=first&&last?minutesBetween(first,last):asNumber(old?.worked_minutes),scheduledStart=hhmmMinutes(schedStart),firstLocal=zonedMinutes(first,schedule.timezone),minutesLate=x.status==="late"&&firstLocal!=null&&scheduledStart!=null?Math.max(0,firstLocal-scheduledStart-schedule.graceMinutes):x.status==="late"?asNumber(old?.minutes_late):0;
    if(old){const changed=String(old.status)!==x.status||asText(old.first_clock_in)!==first||asText(old.last_clock_out)!==last||asText(old.reason)!==(x.reason??null);if(changed)stmts.push(c.env.FINANCE_DB.prepare(`INSERT INTO school_staff_attendance_changes (id,organization_id,record_id,staff_id,attendance_date,previous_status,new_status,before_json,after_json,reason,changed_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(createId("sac"),p.organizationId,old.id,x.staffId,s.data.attendanceDate,String(old.status),x.status,JSON.stringify(camelizeRow(old)),JSON.stringify(x),x.correctionReason?.trim()||"Manual attendance update",p.userId));
      stmts.push(c.env.FINANCE_DB.prepare(`UPDATE school_staff_attendance_records SET status=?,scheduled_start=?,scheduled_end=?,first_clock_in=?,last_clock_out=?,worked_minutes=?,minutes_late=?,leave_type=?,reason=?,notes=?,source=?,corrected_by=?,correction_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`).bind(x.status,schedStart,schedEnd,first,last,worked,minutesLate,x.leaveType??null,x.reason??null,x.notes??null,x.source,changed?p.userId:null,changed?(x.correctionReason?.trim()||"Manual attendance update"):null,old.id,p.organizationId))
    }else stmts.push(c.env.FINANCE_DB.prepare(`INSERT INTO school_staff_attendance_records (id,organization_id,staff_id,attendance_date,campus_id,department_id,status,scheduled_start,scheduled_end,first_clock_in,last_clock_out,worked_minutes,minutes_late,leave_type,reason,notes,source,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(createId("sar"),p.organizationId,x.staffId,s.data.attendanceDate,staff.campus_id??null,staff.department_id??null,x.status,schedStart,schedEnd,first,last,worked,minutesLate,x.leaveType??null,x.reason??null,x.notes??null,x.source,p.userId))}
  if(stmts.length)await c.env.FINANCE_DB.batch(stmts);await audit(c.env.FINANCE_DB,c,"school.attendance.staff_day.saved","school_staff_attendance",s.data.attendanceDate,{records:s.data.records.length});return c.json({data:{attendanceDate:s.data.attendanceDate,saved:s.data.records.length}})
});

const staffEventSchema=z.object({eventType:z.enum(["clock_in","clock_out","break_out","break_in"]),eventAt:z.string().optional().nullable(),attendanceDate:date.optional().nullable(),source:z.enum(["manual","clock","api","device","import"]).default("clock"),deviceId:z.string().max(120).optional().nullable(),locationText:z.string().max(300).optional().nullable(),notes:z.string().max(500).optional().nullable()});
schoolAttendanceRoutes.post("/staff/:staffId/events", requireScope("school:write"), schoolPermission("school.attendance.staff:write"), async c=>{
  const p=c.get("principal"),staff=await ensureStaff(c.env.FINANCE_DB,p.organizationId,c.req.param("staffId")),s=staffEventSchema.safeParse(await c.req.json());if(!s.success)throw new AppError(422,"VALIDATION_ERROR","Invalid clock event",s.error.flatten());
  const eventAt=s.data.eventAt||nowIso(),day=s.data.attendanceDate||dateOnly(eventAt),record=await ensureStaffDay(c.env.FINANCE_DB,p.organizationId,p.userId,staff,day);if(Number(record.locked))throw new AppError(409,"ATTENDANCE_LOCKED","Staff attendance is locked for this day");
  const id=createId("sae");await c.env.FINANCE_DB.prepare(`INSERT INTO school_staff_attendance_events (id,organization_id,staff_id,daily_record_id,attendance_date,event_type,event_at,source,device_id,location_text,notes,recorded_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,p.organizationId,staff.id,record.id,day,s.data.eventType,eventAt,s.data.source,s.data.deviceId??null,s.data.locationText??null,s.data.notes??null,p.userId).run();
  const updated=await recomputeStaffDay(c.env.FINANCE_DB,p.organizationId,record);await audit(c.env.FINANCE_DB,c,`school.attendance.staff.${s.data.eventType}`,"school_staff_attendance_record",String(record.id),{eventId:id,eventAt,staffId:staff.id});return c.json({data:{event:{id,...s.data,eventAt,attendanceDate:day},record:camelizeRow(updated||{})}},201)
});

schoolAttendanceRoutes.get("/staff/:staffId/history", schoolPermission("school.attendance:read"), async c=>{
  const p=c.get("principal"),staffId=c.req.param("staffId");await ensureStaff(c.env.FINANCE_DB,p.organizationId,staffId);const from=c.req.query("from")||"0000-01-01",to=c.req.query("to")||"9999-12-31";
  const rows=await c.env.FINANCE_DB.prepare("SELECT * FROM school_staff_attendance_records WHERE organization_id=? AND staff_id=? AND attendance_date BETWEEN ? AND ? ORDER BY attendance_date DESC").bind(p.organizationId,staffId,from,to).all<Row>();return c.json({data:camelizeRows(rows.results)})
});

schoolAttendanceRoutes.post("/staff/day/:date/lock", requireScope("school:write"), schoolPermission("school.attendance:manage"), async c=>{
  const p=c.get("principal"),day=c.req.param("date");if(!date.safeParse(day).success)throw new AppError(422,"VALIDATION_ERROR","Invalid attendance date");await c.env.FINANCE_DB.batch([c.env.FINANCE_DB.prepare("INSERT INTO school_staff_attendance_day_locks (id,organization_id,attendance_date,locked_by) VALUES (?,?,?,?) ON CONFLICT(organization_id,attendance_date) DO UPDATE SET locked_by=excluded.locked_by,locked_at=CURRENT_TIMESTAMP").bind(createId("sdl"),p.organizationId,day,p.userId),c.env.FINANCE_DB.prepare("UPDATE school_staff_attendance_records SET locked=1,locked_by=?,locked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND attendance_date=?").bind(p.userId,p.organizationId,day)]);await audit(c.env.FINANCE_DB,c,"school.attendance.staff_day.locked","school_staff_attendance",day);return c.json({data:{date:day,locked:true}})
});

schoolAttendanceRoutes.get("/staff/report", schoolPermission("school.attendance:read"), async c=>{
  const p=c.get("principal"),from=c.req.query("from")||"0000-01-01",to=c.req.query("to")||"9999-12-31",departmentId=c.req.query("departmentId"),campusId=c.req.query("campusId"),clauses=["a.organization_id=?","a.attendance_date BETWEEN ? AND ?"],binds:unknown[]=[p.organizationId,from,to];if(departmentId){clauses.push("a.department_id=?");binds.push(departmentId)}if(campusId){clauses.push("a.campus_id=?");binds.push(campusId)}
  const rows=await c.env.FINANCE_DB.prepare(`SELECT sp.id AS staff_id,sp.staff_number,sp.first_name,sp.middle_name,sp.last_name,d.name AS department_name,pos.name AS position_name,
    COUNT(*) AS marked_days,SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END) AS present,SUM(CASE WHEN a.status='late' THEN 1 ELSE 0 END) AS late,SUM(CASE WHEN a.status='absent' THEN 1 ELSE 0 END) AS absent,
    SUM(CASE WHEN a.status='on_leave' THEN 1 ELSE 0 END) AS on_leave,SUM(CASE WHEN a.status='sick' THEN 1 ELSE 0 END) AS sick,SUM(CASE WHEN a.status='official_duty' THEN 1 ELSE 0 END) AS official_duty,
    SUM(a.worked_minutes) AS worked_minutes,SUM(a.overtime_minutes) AS overtime_minutes,
    ROUND(100.0*SUM(CASE WHEN a.status IN ('present','late','remote','official_duty','half_day') THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0),2) AS attendance_percent
    FROM school_staff_attendance_records a JOIN school_staff_profiles sp ON sp.id=a.staff_id LEFT JOIN school_departments d ON d.id=sp.department_id LEFT JOIN school_staff_positions pos ON pos.id=sp.position_id
    WHERE ${clauses.join(" AND ")} GROUP BY sp.id ORDER BY sp.last_name,sp.first_name`).bind(...binds).all<Row>();return c.json({data:camelizeRows(rows.results)})
});

schoolAttendanceRoutes.get("/student/records/:id/changes", schoolPermission("school.attendance:read"), async c=>{
  const p=c.get("principal"),id=c.req.param("id"),rows=await c.env.FINANCE_DB.prepare(`SELECT ch.*,u.display_name AS changed_by_name FROM school_student_attendance_changes ch LEFT JOIN users u ON u.id=ch.changed_by WHERE ch.organization_id=? AND ch.record_id=? ORDER BY ch.changed_at DESC`).bind(p.organizationId,id).all<Row>();return c.json({data:camelizeRows(rows.results)})
});

schoolAttendanceRoutes.get("/staff/:staffId/events", schoolPermission("school.attendance:read"), async c=>{
  const p=c.get("principal"),staffId=c.req.param("staffId");await ensureStaff(c.env.FINANCE_DB,p.organizationId,staffId);const day=c.req.query("date"),from=c.req.query("from")||"0000-01-01",to=c.req.query("to")||"9999-12-31";
  const rows=day?await c.env.FINANCE_DB.prepare("SELECT * FROM school_staff_attendance_events WHERE organization_id=? AND staff_id=? AND attendance_date=? ORDER BY event_at").bind(p.organizationId,staffId,day).all<Row>():await c.env.FINANCE_DB.prepare("SELECT * FROM school_staff_attendance_events WHERE organization_id=? AND staff_id=? AND attendance_date BETWEEN ? AND ? ORDER BY attendance_date DESC,event_at DESC").bind(p.organizationId,staffId,from,to).all<Row>();return c.json({data:camelizeRows(rows.results)})
});

schoolAttendanceRoutes.get("/staff/records/:id/changes", schoolPermission("school.attendance:read"), async c=>{
  const p=c.get("principal"),id=c.req.param("id"),rows=await c.env.FINANCE_DB.prepare(`SELECT ch.*,u.display_name AS changed_by_name FROM school_staff_attendance_changes ch LEFT JOIN users u ON u.id=ch.changed_by WHERE ch.organization_id=? AND ch.record_id=? ORDER BY ch.changed_at DESC`).bind(p.organizationId,id).all<Row>();return c.json({data:camelizeRows(rows.results)})
});

schoolAttendanceRoutes.post("/staff/day/:date/reopen", requireScope("school:write"), schoolPermission("school.attendance:manage"), async c=>{
  const p=c.get("principal"),day=c.req.param("date"),s=reopenSchema.safeParse(await c.req.json());if(!date.safeParse(day).success||!s.success)throw new AppError(422,"VALIDATION_ERROR","A valid date and reason are required to reopen attendance",s.success?undefined:s.error.flatten());await c.env.FINANCE_DB.batch([c.env.FINANCE_DB.prepare("DELETE FROM school_staff_attendance_day_locks WHERE organization_id=? AND attendance_date=?").bind(p.organizationId,day),c.env.FINANCE_DB.prepare("UPDATE school_staff_attendance_records SET locked=0,locked_by=NULL,locked_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND attendance_date=?").bind(p.organizationId,day)]);await audit(c.env.FINANCE_DB,c,"school.attendance.staff_day.reopened","school_staff_attendance",day,{reason:s.data.reason});return c.json({data:{date:day,locked:false}})
});
