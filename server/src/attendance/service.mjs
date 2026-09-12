import { createHash, randomBytes, randomUUID, webcrypto } from "node:crypto";

const METHODS = new Set(["FACE","QR","NFC","MANUAL","TEACHER_REGISTER","ADMIN_OVERRIDE","IMPORT","API"]);
const STUDENT_STATUSES = new Set(["present","absent","late","excused","sick","permission"]);
const STAFF_STATUSES = new Set(["present","absent","late","on_leave","sick","official_duty","remote","half_day"]);
const PERSON_TYPES = new Set(["student","staff"]);
const DIRECTIONS = new Set(["IN","OUT"]);
const POPULATIONS = new Set(["students","staff","mixed"]);
const DEVICE_DIRECTIONS = new Set(["IN","OUT","BOTH"]);
const subtle = globalThis.crypto?.subtle ?? webcrypto.subtle;

function fail(status, code, message, details) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details !== undefined) error.details = details;
  throw error;
}

function id(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function token(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function asDate(value, name = "date") {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) fail(422, "VALIDATION_ERROR", `${name} must use YYYY-MM-DD`);
  return text;
}

function asIso(value, name = "timestamp") {
  const date = new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) fail(422, "VALIDATION_ERROR", `${name} must be a valid timestamp`);
  return date.toISOString();
}

function clampInt(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseJson(value, fallback = {}) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function camel(row) {
  if (!row || typeof row !== "object") return row;
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    const next = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (key.endsWith("_json")) out[next.replace(/Json$/, "")] = parseJson(value, {});
    else out[next] = value;
  }
  return out;
}

function camels(rows) {
  return (rows ?? []).map(camel);
}

function localDay(value, timeZone = "Africa/Kampala") {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function localMinutes(value, timeZone = "Africa/Kampala") {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function hhmm(value) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value ?? ""));
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

function normalizeEvent(input = {}) {
  const personType = String(input.personType ?? "");
  const direction = String(input.direction ?? "").toUpperCase();
  const method = String(input.method ?? "").toUpperCase();
  const verificationMode = String(input.verificationMode ?? "STANDARD").toUpperCase();
  if (!PERSON_TYPES.has(personType)) fail(422, "VALIDATION_ERROR", "personType must be student or staff");
  if (!String(input.personId ?? "").trim()) fail(422, "VALIDATION_ERROR", "personId is required");
  if (!DIRECTIONS.has(direction)) fail(422, "VALIDATION_ERROR", "direction must be IN or OUT");
  if (!METHODS.has(method)) fail(422, "VALIDATION_ERROR", "Unsupported attendance method");
  if (!["STANDARD","TEST","SUPERVISED","UNVERIFIED"].includes(verificationMode)) fail(422, "VALIDATION_ERROR", "Unsupported verification mode");
  return {
    ...input,
    personType,
    personId: String(input.personId),
    direction,
    method,
    verificationMode,
    capturedAt: input.capturedAt ? asIso(input.capturedAt, "capturedAt") : new Date().toISOString(),
    clientEventId: input.clientEventId ? String(input.clientEventId).slice(0, 150) : null,
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {},
  };
}

function keyBytes(raw) {
  if (!raw) fail(503, "BIOMETRIC_KEY_REQUIRED", "BIOMETRIC_ENCRYPTION_KEY is not configured");
  let bytes;
  try { bytes = Buffer.from(String(raw).trim(), "base64"); } catch { fail(503, "BIOMETRIC_KEY_INVALID", "BIOMETRIC_ENCRYPTION_KEY must be valid base64"); }
  if (bytes.length !== 32) fail(503, "BIOMETRIC_KEY_INVALID", "BIOMETRIC_ENCRYPTION_KEY must decode to exactly 32 bytes");
  return bytes;
}

function biometricReady(raw) {
  try { return keyBytes(raw).length === 32; } catch { return false; }
}

async function cryptoKey(raw) {
  return subtle.importKey("raw", keyBytes(raw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function aad(context) {
  return Buffer.from(`ledgerly-attendance-face-v1:${context}`, "utf8");
}

async function encryptEmbedding(rawKey, plainBase64, context, expectedBytes) {
  let plain;
  try { plain = Buffer.from(String(plainBase64), "base64"); } catch { fail(422, "INVALID_FACE_TEMPLATE", "Face embedding must be valid base64"); }
  if (!plain.length || plain.length > 8192) fail(422, "INVALID_FACE_TEMPLATE", "Face embedding is empty or too large");
  if (expectedBytes != null && plain.length !== expectedBytes) fail(422, "INVALID_FACE_TEMPLATE", `Face embedding must contain exactly ${expectedBytes} bytes`);
  const iv = randomBytes(12);
  const encrypted = await subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(context) }, await cryptoKey(rawKey), plain);
  return { ciphertext: Buffer.from(encrypted).toString("base64"), iv: iv.toString("base64"), bytes: plain.length };
}

async function decryptEmbedding(rawKey, ciphertext, iv, context) {
  try {
    const plain = await subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(String(iv), "base64"), additionalData: aad(context) }, await cryptoKey(rawKey), Buffer.from(String(ciphertext), "base64"));
    return Buffer.from(plain).toString("base64");
  } catch (error) {
    if (error?.code === "BIOMETRIC_KEY_REQUIRED" || error?.code === "BIOMETRIC_KEY_INVALID") throw error;
    fail(500, "BIOMETRIC_DECRYPT_FAILED", "Unable to decrypt biometric template");
  }
}

export class AttendanceService {
  constructor({ database, audit = null, biometricKey = "" }) {
    if (!database?.query) throw new TypeError("AttendanceService requires database.query()");
    this.database = database;
    this.audit = audit;
    this.biometricKey = biometricKey;
    this.provider = "postgresql-attendance";
  }

  async requireEnabled(organizationId) {
    const rows = await this.database.query(
      `SELECT module_key,enabled FROM organization_modules WHERE organization_id=$1 AND module_key IN ('school-management','attendance')`,
      [organizationId],
    );
    const state = new Map(rows.rows.map((row) => [row.module_key, row.enabled === true || Number(row.enabled) === 1]));
    if (state.get("school-management") !== true) fail(409, "SCHOOL_MANAGEMENT_REQUIRED", "School Management must be enabled before Attendance");
    if (state.get("attendance") !== true) fail(409, "ATTENDANCE_NOT_ENABLED", "Attendance is not enabled for this organization");
    return true;
  }

  async auditEvent({ organizationId, actorType = "user", actorId = null, action, entityType, entityId, details = {}, requestId = null }) {
    await this.database.query(
      `INSERT INTO att_audit(id,organization_id,actor_type,actor_id,action,entity_type,entity_id,details_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id("ata"), organizationId, actorType, actorId, action, entityType, entityId, JSON.stringify(details ?? {})],
    );
    if (this.audit?.write) {
      await this.audit.write({ organizationId, actorType: actorType === "user" ? "human" : actorType, actorId: actorId ?? "attendance", action, entityType, entityId, requestId, metadata: details ?? {} }).catch(() => undefined);
    }
  }

  async manifest() {
    return {
      key: "attendance",
      name: "Attendance",
      version: "1.3.0-selfhost",
      requiresModules: ["school-management"],
      canonicalTables: ["att_events","att_records","att_sessions"],
      recognitionInterface: ["enroll","identify","verify","deleteProfile","healthCheck"],
      offline: true,
      mobile: { platform: "android", framework: "react-native", cameraSource: "device", externalCameras: false },
      provider: this.provider,
    };
  }

  async context(organizationId) {
    const queries = [
      [`SELECT id,name,is_current AS "isCurrent" FROM school_academic_years WHERE organization_id=$1 ORDER BY starts_on DESC`, "years"],
      [`SELECT id,name,academic_year_id AS "academicYearId",is_current AS "isCurrent" FROM school_terms WHERE organization_id=$1 ORDER BY starts_on DESC`, "terms"],
      [`SELECT id,name,academic_year_id AS "academicYearId" FROM school_classes WHERE organization_id=$1 AND active=true ORDER BY name`, "classes"],
      [`SELECT id,name,class_id AS "classId" FROM school_streams WHERE organization_id=$1 AND active=true ORDER BY name`, "streams"],
      [`SELECT id,name FROM school_subjects WHERE organization_id=$1 AND active=true ORDER BY name`, "subjects"],
      [`SELECT id,name FROM school_lesson_periods WHERE organization_id=$1 AND active=true ORDER BY sequence_no`, "periods"],
      [`SELECT id,name FROM school_departments WHERE organization_id=$1 AND active=true ORDER BY name`, "departments"],
      [`SELECT id,admission_number AS "admissionNumber",trim(concat_ws(' ',first_name,last_name)) AS name,current_class_id AS "classId",current_stream_id AS "streamId" FROM school_students WHERE organization_id=$1 AND deleted_at IS NULL AND status='active' ORDER BY last_name,first_name LIMIT 1500`, "students"],
      [`SELECT id,staff_number AS "staffNumber",trim(concat_ws(' ',first_name,last_name)) AS name,department_id AS "departmentId" FROM school_staff_profiles WHERE organization_id=$1 AND deleted_at IS NULL AND employment_status='active' ORDER BY last_name,first_name LIMIT 1000`, "staff"],
    ];
    const results = await Promise.all(queries.map(([sql]) => this.database.query(sql, [organizationId])));
    return Object.fromEntries(queries.map(([, key], index) => [key, results[index].rows]));
  }

  async assertPerson(db, organizationId, personType, personId) {
    if (!PERSON_TYPES.has(personType)) fail(422, "VALIDATION_ERROR", "Invalid person type");
    const table = personType === "student" ? "school_students" : "school_staff_profiles";
    const result = await db.query(`SELECT * FROM ${table} WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL LIMIT 1`, [personId, organizationId]);
    if (!result.rows[0]) fail(404, "PERSON_NOT_FOUND", personType === "student" ? "Student not found" : "Staff member not found");
    return result.rows[0];
  }

  async policy(db, organizationId, population) {
    const result = await db.query(
      `SELECT * FROM att_policies WHERE organization_id=$1 AND active=true AND population IN ($2,'all') ORDER BY CASE population WHEN $2 THEN 0 ELSE 1 END,updated_at DESC LIMIT 1`,
      [organizationId, population],
    );
    return result.rows[0] ?? { school_starts_at: "08:00", late_after: "08:10", absence_after: "09:00", expected_departure_at: "16:30", duplicate_cooldown_seconds: 60, early_departure_minutes: 15, timezone: "Africa/Kampala" };
  }

  async overview(organizationId, date) {
    const day = asDate(date);
    const [students, staff, recent, pending, unknown, expectedStudents, expectedStaff] = await Promise.all([
      this.database.query(`SELECT count(*)::int AS marked,count(*) FILTER(WHERE status='present')::int AS present,count(*) FILTER(WHERE status='late')::int AS late,count(*) FILTER(WHERE status='absent')::int AS absent,count(*) FILTER(WHERE status IN ('excused','sick','permission'))::int AS excused FROM att_records WHERE organization_id=$1 AND attendance_date=$2 AND person_type='student' AND official=true`, [organizationId, day]),
      this.database.query(`SELECT count(*)::int AS marked,count(*) FILTER(WHERE status='present')::int AS present,count(*) FILTER(WHERE status='late')::int AS late,count(*) FILTER(WHERE status='absent')::int AS absent,count(*) FILTER(WHERE status='on_leave')::int AS on_leave FROM att_records WHERE organization_id=$1 AND attendance_date=$2 AND person_type='staff' AND official=true`, [organizationId, day]),
      this.database.query(`SELECT e.id,e.captured_at,e.direction,e.method,e.person_type,e.verification_mode,e.official,COALESCE(trim(concat_ws(' ',s.first_name,s.last_name)),trim(concat_ws(' ',sp.first_name,sp.last_name)),'Unknown') AS person_name,COALESCE(c.name,d.name,'—') AS group_name FROM att_events e LEFT JOIN school_students s ON e.person_type='student' AND s.id=e.person_id LEFT JOIN school_classes c ON c.id=s.current_class_id LEFT JOIN school_staff_profiles sp ON e.person_type='staff' AND sp.id=e.person_id LEFT JOIN school_departments d ON d.id=sp.department_id WHERE e.organization_id=$1 AND (e.captured_at AT TIME ZONE 'Africa/Kampala')::date=$2::date ORDER BY e.captured_at DESC LIMIT 30`, [organizationId, day]),
      this.database.query(`SELECT COALESCE(sum(CASE WHEN status='received' THEN event_count ELSE 0 END),0)::int AS n FROM att_device_sync_batches WHERE organization_id=$1`, [organizationId]),
      this.database.query(`SELECT count(*)::int AS n FROM att_events WHERE organization_id=$1 AND (captured_at AT TIME ZONE 'Africa/Kampala')::date=$2::date AND verification_status IN ('unknown','rejected')`, [organizationId, day]),
      this.database.query(`SELECT count(*)::int AS n FROM school_students WHERE organization_id=$1 AND deleted_at IS NULL AND status='active'`, [organizationId]),
      this.database.query(`SELECT count(*)::int AS n FROM school_staff_profiles WHERE organization_id=$1 AND deleted_at IS NULL AND employment_status='active'`, [organizationId]),
    ]);
    const student = camel(students.rows[0] ?? {}), staffRow = camel(staff.rows[0] ?? {});
    return {
      date: day,
      students: { ...student, expected: Number(expectedStudents.rows[0]?.n ?? 0) },
      staff: { ...staffRow, onLeave: Number(staff.rows[0]?.on_leave ?? 0), expected: Number(expectedStaff.rows[0]?.n ?? 0) },
      recent: camels(recent.rows),
      pendingSync: Number(pending.rows[0]?.n ?? 0),
      recognitionFailures: Number(unknown.rows[0]?.n ?? 0),
    };
  }

  async events({ organizationId, date = null, method = null, status = null, limit = 100 }) {
    const values = [organizationId];
    const where = ["e.organization_id=$1"];
    if (date) { values.push(asDate(date)); where.push(`(e.captured_at AT TIME ZONE 'Africa/Kampala')::date=$${values.length}::date`); }
    if (method) { values.push(String(method).toUpperCase()); where.push(`e.method=$${values.length}`); }
    if (status) { values.push(String(status)); where.push(`e.verification_status=$${values.length}`); }
    values.push(clampInt(limit, 100, 1, 500));
    const result = await this.database.query(
      `SELECT e.*,COALESCE(trim(concat_ws(' ',s.first_name,s.last_name)),trim(concat_ws(' ',sp.first_name,sp.last_name)),'Unknown') AS person_name,d.name AS device_name,COALESCE(c.name,dep.name,'—') AS group_name FROM att_events e LEFT JOIN school_students s ON e.person_type='student' AND s.id=e.person_id LEFT JOIN school_classes c ON c.id=s.current_class_id LEFT JOIN school_staff_profiles sp ON e.person_type='staff' AND sp.id=e.person_id LEFT JOIN school_departments dep ON dep.id=sp.department_id LEFT JOIN att_devices d ON d.id=e.device_id WHERE ${where.join(" AND ")} ORDER BY e.captured_at DESC LIMIT $${values.length}`,
      values,
    );
    return camels(result.rows);
  }

  async records({ organizationId, from = "0001-01-01", to = "9999-12-31", personType = null, personId = null, status = null, limit = 1000 }) {
    const values = [organizationId, from, to];
    const where = ["r.organization_id=$1", "r.attendance_date BETWEEN $2::date AND $3::date"];
    if (personType) { if (!PERSON_TYPES.has(personType)) fail(422, "VALIDATION_ERROR", "Invalid person type"); values.push(personType); where.push(`r.person_type=$${values.length}`); }
    if (personId) { values.push(personId); where.push(`r.person_id=$${values.length}`); }
    if (status) { values.push(status); where.push(`r.status=$${values.length}`); }
    values.push(clampInt(limit, 1000, 1, 5000));
    const result = await this.database.query(
      `SELECT r.*,COALESCE(trim(concat_ws(' ',s.first_name,s.last_name)),trim(concat_ws(' ',sp.first_name,sp.last_name))) AS person_name,COALESCE(s.admission_number,sp.staff_number) AS person_number,c.name AS class_name,d.name AS department_name FROM att_records r LEFT JOIN school_students s ON r.person_type='student' AND s.id=r.person_id LEFT JOIN school_classes c ON c.id=s.current_class_id LEFT JOIN school_staff_profiles sp ON r.person_type='staff' AND sp.id=r.person_id LEFT JOIN school_departments d ON d.id=sp.department_id WHERE ${where.join(" AND ")} ORDER BY r.attendance_date DESC,person_name LIMIT $${values.length}`,
      values,
    );
    return camels(result.rows);
  }

  async sessions({ organizationId, date = null }) {
    const result = await this.database.query(
      `SELECT a.*,c.name AS class_name,st.name AS stream_name,s.name AS subject_name FROM att_sessions a LEFT JOIN school_classes c ON c.id=a.class_id LEFT JOIN school_streams st ON st.id=a.stream_id LEFT JOIN school_subjects s ON s.id=a.subject_id WHERE a.organization_id=$1 AND ($2::date IS NULL OR a.attendance_date=$2::date) ORDER BY a.attendance_date DESC,a.starts_at LIMIT 500`,
      [organizationId, date ? asDate(date) : null],
    );
    return camels(result.rows);
  }

  async createSession({ organizationId, userId, input, requestId = null }) {
    const attendanceDate = asDate(input.attendanceDate, "attendanceDate");
    if (!String(input.sessionType ?? "").trim()) fail(422, "VALIDATION_ERROR", "Date and session type are required");
    const sessionId = id("ats");
    try {
      await this.database.query(
        `INSERT INTO att_sessions(id,organization_id,academic_year_id,term_id,campus_id,attendance_date,session_type,population,class_id,stream_id,subject_id,lesson_period_id,title,starts_at,ends_at,status,expected_count,source,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'open',$16,'MANUAL',$17,$18)`,
        [sessionId,organizationId,input.academicYearId??null,input.termId??null,input.campusId??null,attendanceDate,String(input.sessionType),input.population??"students",input.classId??null,input.streamId??null,input.subjectId??null,input.lessonPeriodId??null,input.title??null,input.startsAt??null,input.endsAt??null,clampInt(input.expectedCount,0,0,100000),input.notes??null,userId],
      );
    } catch (error) {
      if (error?.code === "23505") fail(409, "ATTENDANCE_SESSION_EXISTS", "An attendance session already exists for this scope");
      throw error;
    }
    await this.auditEvent({ organizationId, actorId: userId, action: "session.created", entityType: "attendance_session", entityId: sessionId, details: input, requestId });
    return { id: sessionId, ...input, attendanceDate, status: "open" };
  }

  async saveSessionRecords({ organizationId, userId, sessionId, records, requestId = null }) {
    if (!Array.isArray(records) || records.length < 1 || records.length > 1500) fail(422, "VALIDATION_ERROR", "records must contain 1 to 1500 attendance records");
    return this.database.transaction(async (tx) => {
      const sessionResult = await tx.query(`SELECT * FROM att_sessions WHERE id=$1 AND organization_id=$2 FOR UPDATE`, [sessionId, organizationId]);
      const session = sessionResult.rows[0];
      if (!session) fail(404, "ATTENDANCE_SESSION_NOT_FOUND", "Attendance session not found");
      if (["finalized","locked","cancelled"].includes(session.status)) fail(409, "ATTENDANCE_SESSION_CLOSED", "Reopen the session before changing its register");
      for (const item of records) {
        const personType = String(item.personType ?? "");
        const personId = String(item.personId ?? "");
        if (!PERSON_TYPES.has(personType) || !personId) fail(422, "VALIDATION_ERROR", "Each record requires a valid personType and personId");
        const allowed = personType === "student" ? STUDENT_STATUSES : STAFF_STATUSES;
        if (!allowed.has(String(item.status))) fail(422, "VALIDATION_ERROR", `Invalid ${personType} attendance status`);
        await this.assertPerson(tx, organizationId, personType, personId);
        const current = await tx.query(`SELECT id FROM att_records WHERE organization_id=$1 AND session_id=$2 AND person_type=$3 AND person_id=$4`, [organizationId, sessionId, personType, personId]);
        if (current.rows[0]) {
          await tx.query(`UPDATE att_records SET status=$1,first_in_at=$2,last_out_at=$3,minutes_late=$4,reason=$5,notes=$6,source_method='TEACHER_REGISTER',updated_at=now() WHERE id=$7`, [item.status,item.firstInAt||null,item.lastOutAt||null,clampInt(item.minutesLate,0,0,1440),item.reason||null,item.notes||null,current.rows[0].id]);
        } else {
          await tx.query(`INSERT INTO att_records(id,organization_id,session_id,attendance_date,person_type,person_id,status,first_in_at,last_out_at,minutes_late,reason,notes,source_method,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'TEACHER_REGISTER',$13)`, [id("atr"),organizationId,sessionId,session.attendance_date,personType,personId,item.status,item.firstInAt||null,item.lastOutAt||null,clampInt(item.minutesLate,0,0,1440),item.reason||null,item.notes||null,userId]);
        }
      }
      const count = await tx.query(`SELECT count(*)::int AS n FROM att_records WHERE organization_id=$1 AND session_id=$2`, [organizationId, sessionId]);
      await tx.query(`UPDATE att_sessions SET marked_count=$1,updated_at=now() WHERE id=$2`, [Number(count.rows[0]?.n ?? 0), sessionId]);
      await this.auditEvent({ organizationId, actorId: userId, action: "register.saved", entityType: "attendance_session", entityId: sessionId, details: { records: records.length }, requestId });
      return { sessionId, saved: records.length, markedCount: Number(count.rows[0]?.n ?? 0) };
    });
  }

  async finalizeSession({ organizationId, userId, sessionId, requestId = null }) {
    const result = await this.database.transaction(async (tx) => {
      const updated = await tx.query(`UPDATE att_sessions SET status='finalized',finalized_by=$1,finalized_at=now(),updated_at=now() WHERE id=$2 AND organization_id=$3 AND status NOT IN ('locked','cancelled') RETURNING id`, [userId, sessionId, organizationId]);
      if (!updated.rowCount) fail(409, "SESSION_NOT_FINALIZABLE", "Session is locked, cancelled or missing");
      await tx.query(`UPDATE att_records SET finalized=true,updated_at=now() WHERE organization_id=$1 AND session_id=$2`, [organizationId, sessionId]);
      return { id: sessionId, status: "finalized" };
    });
    await this.auditEvent({ organizationId, actorId: userId, action: "session.finalized", entityType: "attendance_session", entityId: sessionId, requestId });
    return result;
  }

  async staffDay({ organizationId, userId, attendanceDate, records }) {
    const day = asDate(attendanceDate, "attendanceDate");
    if (!Array.isArray(records) || records.length < 1 || records.length > 1000) fail(422, "VALIDATION_ERROR", "Staff records are required");
    await this.database.transaction(async (tx) => {
      for (const item of records) {
        const staffId = String(item.staffId ?? "");
        if (!staffId) fail(422, "VALIDATION_ERROR", "staffId is required");
        if (!STAFF_STATUSES.has(String(item.status))) fail(422, "VALIDATION_ERROR", "Invalid staff attendance status");
        await this.assertPerson(tx, organizationId, "staff", staffId);
        const current = await tx.query(`SELECT * FROM att_records WHERE organization_id=$1 AND attendance_date=$2 AND person_type='staff' AND person_id=$3 AND session_id IS NULL FOR UPDATE`, [organizationId, day, staffId]);
        const old = current.rows[0];
        const after = { status:item.status,firstInAt:item.firstInAt||null,lastOutAt:item.lastOutAt||null,reason:item.reason||null,notes:item.notes||null };
        if (old) {
          const correctionReason = String(item.correctionReason ?? "").trim();
          if (!correctionReason) fail(422, "CORRECTION_REASON_REQUIRED", "A reason is required when changing an attendance record");
          await tx.query(`INSERT INTO att_corrections(id,organization_id,record_id,before_json,after_json,reason,status,requested_by,approved_by,decided_at) VALUES($1,$2,$3,$4,$5,$6,'approved',$7,$7,now())`, [id("atc"),organizationId,old.id,JSON.stringify(camel(old)),JSON.stringify(after),correctionReason,userId]);
          await tx.query(`UPDATE att_records SET status=$1,first_in_at=$2,last_out_at=$3,reason=$4,notes=$5,source_method='MANUAL',updated_at=now() WHERE id=$6`, [item.status,item.firstInAt||null,item.lastOutAt||null,item.reason||null,item.notes||null,old.id]);
        } else {
          await tx.query(`INSERT INTO att_records(id,organization_id,attendance_date,person_type,person_id,status,first_in_at,last_out_at,reason,notes,source_method,created_by) VALUES($1,$2,$3,'staff',$4,$5,$6,$7,$8,$9,'MANUAL',$10)`, [id("atr"),organizationId,day,staffId,item.status,item.firstInAt||null,item.lastOutAt||null,item.reason||null,item.notes||null,userId]);
        }
      }
    });
    return { attendanceDate: day, saved: records.length };
  }

  async devices(organizationId) {
    const result = await this.database.query(`SELECT d.*,g.allow_screen_image AS test_allow_screen_image,g.allow_printed_image AS test_allow_printed_image,g.expires_at AS test_mode_expires_at FROM att_devices d LEFT JOIN LATERAL (SELECT g2.* FROM att_test_mode_grants g2 WHERE g2.organization_id=d.organization_id AND g2.device_id=d.id AND g2.revoked_at IS NULL AND g2.expires_at>now() ORDER BY g2.enabled_at DESC LIMIT 1) g ON true WHERE d.organization_id=$1 ORDER BY d.name`, [organizationId]);
    return camels(result.rows);
  }

  async createDirectDevice({ organizationId, userId, input, requestId = null }) {
    const name = String(input.name ?? "").trim();
    if (!name) fail(422, "VALIDATION_ERROR", "Device name is required");
    const population = POPULATIONS.has(input.population) ? input.population : "mixed";
    const direction = DEVICE_DIRECTIONS.has(input.direction) ? input.direction : "BOTH";
    const deviceId = id("atd");
    const count = await this.database.query(`SELECT count(*)::int AS n FROM att_devices WHERE organization_id=$1`, [organizationId]);
    const deviceCode = `ATT-${String(Number(count.rows[0]?.n ?? 0) + 1).padStart(6, "0")}`;
    const credential = token(32);
    await this.database.transaction(async (tx) => {
      await tx.query(`INSERT INTO att_devices(id,organization_id,device_code,name,location_name,campus_id,population,direction,status,registered_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'active',$9)`, [deviceId,organizationId,deviceCode,name,input.locationName||null,input.campusId||null,population,direction,userId]);
      await tx.query(`INSERT INTO att_device_credentials(id,organization_id,device_id,credential_hash) VALUES($1,$2,$3,$4)`, [id("adc"),organizationId,deviceId,sha256(credential)]);
    });
    await this.auditEvent({ organizationId, actorId: userId, action: "device.registered", entityType: "attendance_device", entityId: deviceId, details: { deviceCode }, requestId });
    return { id: deviceId, deviceCode, credential, status: "active", note: "This credential is shown once. Store it in Android secure storage." };
  }

  async updateDevice({ organizationId, userId, deviceId, input, requestId = null }) {
    const current = await this.database.query(`SELECT * FROM att_devices WHERE id=$1 AND organization_id=$2`, [deviceId, organizationId]);
    if (!current.rows[0]) fail(404, "ATTENDANCE_DEVICE_NOT_FOUND", "Attendance device not found");
    const next = current.rows[0];
    const name = input.name == null ? next.name : String(input.name).trim();
    const population = input.population == null ? next.population : input.population;
    const direction = input.direction == null ? next.direction : input.direction;
    if (!name) fail(422, "VALIDATION_ERROR", "Device name cannot be empty");
    if (!POPULATIONS.has(population)) fail(422, "VALIDATION_ERROR", "Invalid device population");
    if (!DEVICE_DIRECTIONS.has(direction)) fail(422, "VALIDATION_ERROR", "Invalid device direction");
    const result = await this.database.query(`UPDATE att_devices SET name=$1,location_name=$2,population=$3,direction=$4,status=$5,updated_at=now() WHERE id=$6 AND organization_id=$7 RETURNING *`, [name,input.locationName===undefined?next.location_name:input.locationName,population,direction,input.status??next.status,deviceId,organizationId]);
    await this.auditEvent({ organizationId, actorId:userId, action:"device.updated", entityType:"attendance_device", entityId:deviceId, details:input, requestId });
    return camel(result.rows[0]);
  }

  async identifiers(organizationId) {
    const result = await this.database.query(`SELECT i.*,COALESCE(trim(concat_ws(' ',s.first_name,s.last_name)),trim(concat_ws(' ',sp.first_name,sp.last_name))) AS person_name FROM att_person_identifiers i LEFT JOIN school_students s ON i.person_type='student' AND s.id=i.person_id LEFT JOIN school_staff_profiles sp ON i.person_type='staff' AND sp.id=i.person_id WHERE i.organization_id=$1 AND i.active=true ORDER BY i.created_at DESC`, [organizationId]);
    return camels(result.rows);
  }

  async createIdentifier({ organizationId, userId, input, requestId = null }) {
    const method = String(input.method ?? "").toUpperCase(), identifier = String(input.identifier ?? "").trim(), personType = String(input.personType ?? ""), personId = String(input.personId ?? "");
    if (!["QR","NFC"].includes(method) || !identifier) fail(422, "VALIDATION_ERROR", "A QR or NFC identifier is required");
    await this.assertPerson(this.database, organizationId, personType, personId);
    const identifierId = id("ati");
    try { await this.database.query(`INSERT INTO att_person_identifiers(id,organization_id,person_type,person_id,method,identifier,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)`, [identifierId,organizationId,personType,personId,method,identifier,userId]); }
    catch (error) { if (error?.code === "23505") fail(409, "IDENTIFIER_IN_USE", "That QR/NFC identifier is already assigned"); throw error; }
    await this.auditEvent({ organizationId, actorId:userId, action:"identifier.assigned", entityType:"attendance_identifier", entityId:identifierId, details:{personType,personId,method}, requestId });
    return { id:identifierId, personType, personId, method, identifier, active:true };
  }

  async revokeIdentifier({ organizationId, userId, identifierId, requestId = null }) {
    await this.database.query(`UPDATE att_person_identifiers SET active=false WHERE id=$1 AND organization_id=$2`, [identifierId,organizationId]);
    await this.auditEvent({ organizationId, actorId:userId, action:"identifier.revoked", entityType:"attendance_identifier", entityId:identifierId, requestId });
  }

  async enableTestMode({ organizationId, userId, deviceId, input, requestId = null }) {
    const minutes = clampInt(input.minutes,30,1,120), reason=String(input.reason??"").trim();
    if (!reason) fail(422,"REASON_REQUIRED","A reason is required for test spoof mode");
    if (!input.allowScreenImage && !input.allowPrintedImage) fail(422,"TEST_OVERRIDE_REQUIRED","Choose phone/screen image, printed image, or both");
    const device = await this.database.query(`SELECT id FROM att_devices WHERE id=$1 AND organization_id=$2 AND status<>'revoked'`, [deviceId,organizationId]);
    if (!device.rows[0]) fail(404,"ATTENDANCE_DEVICE_NOT_FOUND","Attendance device not found");
    const grantId=id("atg"), expiresAt=new Date(Date.now()+minutes*60000).toISOString();
    await this.database.transaction(async(tx)=>{
      await tx.query(`UPDATE att_test_mode_grants SET revoked_at=now() WHERE organization_id=$1 AND device_id=$2 AND revoked_at IS NULL`,[organizationId,deviceId]);
      await tx.query(`INSERT INTO att_test_mode_grants(id,organization_id,device_id,allow_screen_image,allow_printed_image,reason,enabled_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[grantId,organizationId,deviceId,Boolean(input.allowScreenImage),Boolean(input.allowPrintedImage),reason,userId,expiresAt]);
    });
    await this.auditEvent({organizationId,actorId:userId,action:"test_mode.enabled",entityType:"test_mode_grant",entityId:grantId,details:{deviceId,expiresAt},requestId});
    return {id:grantId,deviceId,allowScreenImage:Boolean(input.allowScreenImage),allowPrintedImage:Boolean(input.allowPrintedImage),expiresAt,warning:"FACE TEST MODE ACTIVE — liveness is bypassed and resulting events are untrusted."};
  }

  async disableTestMode({organizationId,userId,deviceId,requestId=null}){
    const result=await this.database.query(`UPDATE att_test_mode_grants SET revoked_at=now() WHERE organization_id=$1 AND device_id=$2 AND revoked_at IS NULL`,[organizationId,deviceId]);
    await this.auditEvent({organizationId,actorId:userId,action:"test_mode.revoked",entityType:"attendance_device",entityId:deviceId,details:{grantsRevoked:result.rowCount},requestId});
    return {deviceId,active:false,revoked:result.rowCount};
  }

  async biometricSettings(organizationId){
    const result=await this.database.query(`SELECT * FROM att_biometric_settings WHERE organization_id=$1`,[organizationId]);
    return {...camel(result.rows[0]??{organization_id:organizationId,algorithm_version:"facenet-128-v1",match_threshold:.78,ambiguity_margin:.05,liveness_threshold:.70,quality_threshold:.55}),templateEncryptionReady:biometricReady(this.biometricKey)};
  }

  async updateBiometricSettings({organizationId,userId,input,requestId=null}){
    const algorithm=String(input.algorithmVersion||"facenet-128-v1"),match=clampNumber(input.matchThreshold,.78,.5,.99),margin=clampNumber(input.ambiguityMargin,.05,.01,.30),live=clampNumber(input.livenessThreshold,.70,.5,.99),quality=clampNumber(input.qualityThreshold,.55,.3,.99);
    await this.database.query(`INSERT INTO att_biometric_settings(organization_id,algorithm_version,match_threshold,ambiguity_margin,liveness_threshold,quality_threshold,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(organization_id) DO UPDATE SET algorithm_version=excluded.algorithm_version,match_threshold=excluded.match_threshold,ambiguity_margin=excluded.ambiguity_margin,liveness_threshold=excluded.liveness_threshold,quality_threshold=excluded.quality_threshold,updated_by=excluded.updated_by,updated_at=now()`,[organizationId,algorithm,match,margin,live,quality,userId]);
    await this.auditEvent({organizationId,actorId:userId,action:"biometric.settings.updated",entityType:"biometric_settings",entityId:organizationId,details:{algorithm,match,margin,live,quality},requestId});
    return {algorithmVersion:algorithm,matchThreshold:match,ambiguityMargin:margin,livenessThreshold:live,qualityThreshold:quality,templateEncryptionReady:biometricReady(this.biometricKey)};
  }

  async biometricEnrollmentJobs(organizationId){
    const result=await this.database.query(`SELECT j.*,d.name AS device_name,COALESCE(trim(concat_ws(' ',s.first_name,s.last_name)),trim(concat_ws(' ',sp.first_name,sp.last_name))) AS person_name FROM att_biometric_enrollment_jobs j JOIN att_devices d ON d.id=j.device_id LEFT JOIN school_students s ON j.person_type='student' AND s.id=j.person_id LEFT JOIN school_staff_profiles sp ON j.person_type='staff' AND sp.id=j.person_id WHERE j.organization_id=$1 ORDER BY j.requested_at DESC LIMIT 200`,[organizationId]);
    return camels(result.rows);
  }

  async createBiometricEnrollmentJob({organizationId,userId,input,requestId=null}){
    const personType=String(input.personType??""),personId=String(input.personId??""),deviceId=String(input.deviceId??""),consentStatus=String(input.consentStatus??"granted");
    if(!PERSON_TYPES.has(personType)||!personId||!deviceId)fail(422,"VALIDATION_ERROR","Person and kiosk are required");
    if(!["granted","not_required"].includes(consentStatus))fail(422,"BIOMETRIC_CONSENT_REQUIRED","Face enrollment requires granted consent or an explicitly documented not-required basis");
    if(!biometricReady(this.biometricKey))fail(503,"BIOMETRIC_KEY_REQUIRED","Configure a valid 32-byte BIOMETRIC_ENCRYPTION_KEY before requesting face enrollment");
    await this.assertPerson(this.database,organizationId,personType,personId);
    const device=await this.database.query(`SELECT * FROM att_devices WHERE id=$1 AND organization_id=$2 AND status='active'`,[deviceId,organizationId]);
    if(!device.rows[0])fail(404,"ATTENDANCE_DEVICE_NOT_FOUND","Active attendance kiosk not found");
    if(device.rows[0].population!=="mixed"&&device.rows[0].population!==`${personType}s`)fail(409,"KIOSK_POPULATION_MISMATCH","Selected kiosk does not serve this person type");
    const jobId=id("aej");
    await this.database.transaction(async(tx)=>{
      await tx.query(`UPDATE att_biometric_enrollment_jobs SET status='cancelled',updated_at=now() WHERE organization_id=$1 AND person_type=$2 AND person_id=$3 AND status IN ('pending','claimed')`,[organizationId,personType,personId]);
      await tx.query(`INSERT INTO att_biometric_enrollment_jobs(id,organization_id,device_id,person_type,person_id,consent_status,requested_by) VALUES($1,$2,$3,$4,$5,$6,$7)`,[jobId,organizationId,deviceId,personType,personId,consentStatus,userId]);
    });
    await this.auditEvent({organizationId,actorId:userId,action:"biometric.enrollment.requested",entityType:"biometric_enrollment_job",entityId:jobId,details:{deviceId,personType,personId,consentStatus},requestId});
    return {id:jobId,status:"pending"};
  }

  async cancelBiometricEnrollmentJob({organizationId,userId,jobId,requestId=null}){
    await this.database.query(`UPDATE att_biometric_enrollment_jobs SET status='cancelled',updated_at=now() WHERE id=$1 AND organization_id=$2 AND status IN ('pending','claimed')`,[jobId,organizationId]);
    await this.auditEvent({organizationId,actorId:userId,action:"biometric.enrollment.cancelled",entityType:"biometric_enrollment_job",entityId:jobId,requestId});
    return {id:jobId,status:"cancelled"};
  }

  async biometrics(organizationId){
    const result=await this.database.query(`SELECT b.*,COALESCE(trim(concat_ws(' ',s.first_name,s.last_name)),trim(concat_ws(' ',sp.first_name,sp.last_name))) AS person_name FROM att_biometric_profiles b LEFT JOIN school_students s ON b.person_type='student' AND s.id=b.person_id LEFT JOIN school_staff_profiles sp ON b.person_type='staff' AND sp.id=b.person_id WHERE b.organization_id=$1 ORDER BY b.updated_at DESC`,[organizationId]);
    return camels(result.rows);
  }

  async createBiometricProfile({organizationId,userId,input,requestId=null}){
    const personType=String(input.personType??""),personId=String(input.personId??""),algorithm=String(input.algorithmVersion??"");
    if(!algorithm)fail(422,"VALIDATION_ERROR","Algorithm version is required");
    await this.assertPerson(this.database,organizationId,personType,personId);
    const profileId=id("abp");
    const result=await this.database.query(`INSERT INTO att_biometric_profiles(id,organization_id,person_type,person_id,provider_profile_ref,algorithm_version,quality_score,consent_status,status,enrolled_by,enrolled_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'active',$9,now()) ON CONFLICT(organization_id,person_type,person_id) DO UPDATE SET provider_profile_ref=excluded.provider_profile_ref,algorithm_version=excluded.algorithm_version,quality_score=excluded.quality_score,consent_status=excluded.consent_status,status='active',enrolled_by=excluded.enrolled_by,enrolled_at=now(),deleted_at=NULL,updated_at=now() RETURNING *`,[profileId,organizationId,personType,personId,input.providerProfileRef||null,algorithm,input.qualityScore??null,input.consentStatus||"granted",userId]);
    await this.auditEvent({organizationId,actorId:userId,action:"biometric.enrolled",entityType:"biometric_profile",entityId:result.rows[0].id,details:{personType,personId,qualityScore:input.qualityScore},requestId});
    return camel(result.rows[0]);
  }

  async deleteBiometricProfile({organizationId,userId,profileId,requestId=null}){
    await this.database.transaction(async(tx)=>{
      await tx.query(`UPDATE att_biometric_profiles SET status='deleted',provider_profile_ref=NULL,deleted_at=now(),updated_at=now() WHERE id=$1 AND organization_id=$2`,[profileId,organizationId]);
      await tx.query(`UPDATE att_biometric_templates SET active=false,updated_at=now() WHERE profile_id=$1 AND organization_id=$2`,[profileId,organizationId]);
      await tx.query(`UPDATE att_biometric_template_samples SET active=false,updated_at=now() WHERE profile_id=$1 AND organization_id=$2`,[profileId,organizationId]);
    });
    await this.auditEvent({organizationId,actorId:userId,action:"biometric.deleted",entityType:"biometric_profile",entityId:profileId,requestId});
    return {id:profileId,status:"deleted"};
  }

  async policies(organizationId){const r=await this.database.query(`SELECT * FROM att_policies WHERE organization_id=$1 ORDER BY active DESC,name`,[organizationId]);return camels(r.rows);}
  async createPolicy({organizationId,userId,input}){const name=String(input.name??"").trim();if(!name)fail(422,"VALIDATION_ERROR","Policy name is required");const policyId=id("atp");await this.database.query(`INSERT INTO att_policies(id,organization_id,name,population,school_starts_at,late_after,absence_after,expected_departure_at,duplicate_cooldown_seconds,early_departure_minutes,timezone,active,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[policyId,organizationId,name,input.population||"all",input.schoolStartsAt||"08:00",input.lateAfter||"08:10",input.absenceAfter||"09:00",input.expectedDepartureAt||"16:30",clampInt(input.duplicateCooldownSeconds,60,1,86400),clampInt(input.earlyDepartureMinutes,15,0,1440),input.timezone||"Africa/Kampala",input.active!==false,userId]);return{id:policyId,...input,name};}
  async notificationRules(organizationId){const r=await this.database.query(`SELECT * FROM att_notification_rules WHERE organization_id=$1 ORDER BY active DESC,name`,[organizationId]);return camels(r.rows);}
  async createNotificationRule({organizationId,userId,input}){const name=String(input.name??"").trim(),triggerType=String(input.triggerType??"").trim();if(!name||!triggerType)fail(422,"VALIDATION_ERROR","Rule name and trigger are required");const ruleId=id("anr");await this.database.query(`INSERT INTO att_notification_rules(id,organization_id,name,trigger_type,channels_json,recipient_mode,active,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[ruleId,organizationId,name,triggerType,JSON.stringify(Array.isArray(input.channels)?input.channels:["sms"]),input.recipientMode||"primary_guardian",input.active!==false,userId]);return{id:ruleId,...input,name,triggerType};}
  async exceptions(organizationId){const r=await this.database.query(`SELECT x.*,COALESCE(trim(concat_ws(' ',s.first_name,s.last_name)),trim(concat_ws(' ',sp.first_name,sp.last_name))) AS person_name FROM att_exceptions x LEFT JOIN school_students s ON x.person_type='student' AND s.id=x.person_id LEFT JOIN school_staff_profiles sp ON x.person_type='staff' AND sp.id=x.person_id WHERE x.organization_id=$1 ORDER BY x.starts_at DESC LIMIT 500`,[organizationId]);return camels(r.rows);}
  async createException({organizationId,userId,input,requestId=null}){const personType=String(input.personType??""),personId=String(input.personId??"");await this.assertPerson(this.database,organizationId,personType,personId);if(!input.startsAt||!input.endsAt||!String(input.reason??"").trim())fail(422,"VALIDATION_ERROR","Start, end and reason are required");const exceptionId=id("atx");await this.database.query(`INSERT INTO att_exceptions(id,organization_id,person_type,person_id,exception_type,starts_at,ends_at,reason,status,approved_by,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'approved',$9,$9)`,[exceptionId,organizationId,personType,personId,input.exceptionType||"other",asIso(input.startsAt,"startsAt"),asIso(input.endsAt,"endsAt"),String(input.reason),userId]);await this.auditEvent({organizationId,actorId:userId,action:"exception.created",entityType:"attendance_exception",entityId:exceptionId,details:input,requestId});return{id:exceptionId,...input,status:"approved"};}
  async corrections(organizationId){const r=await this.database.query(`SELECT c.*,u.display_name AS requested_by_name FROM att_corrections c LEFT JOIN users u ON u.id=c.requested_by WHERE c.organization_id=$1 ORDER BY c.created_at DESC LIMIT 500`,[organizationId]);return camels(r.rows);}

  async correctRecord({organizationId,userId,recordId,input,requestId=null}){
    const reason=String(input.reason??"").trim();if(!reason)fail(422,"CORRECTION_REASON_REQUIRED","A correction reason is required");
    const current=await this.database.query(`SELECT * FROM att_records WHERE id=$1 AND organization_id=$2`,[recordId,organizationId]);const old=current.rows[0];if(!old)fail(404,"ATTENDANCE_RECORD_NOT_FOUND","Attendance record not found");
    const changes=input.changes&&typeof input.changes==="object"?input.changes:{};if(changes.status){const allowed=old.person_type==="student"?STUDENT_STATUSES:STAFF_STATUSES;if(!allowed.has(changes.status))fail(422,"VALIDATION_ERROR","Invalid corrected status");}
    const correctionId=id("atc"),after={...camel(old),...changes};
    await this.database.transaction(async(tx)=>{
      await tx.query(`INSERT INTO att_corrections(id,organization_id,record_id,before_json,after_json,reason,status,requested_by,approved_by,decided_at) VALUES($1,$2,$3,$4,$5,$6,'approved',$7,$7,now())`,[correctionId,organizationId,recordId,JSON.stringify(camel(old)),JSON.stringify(after),reason,userId]);
      await tx.query(`UPDATE att_records SET status=COALESCE($1,status),first_in_at=COALESCE($2,first_in_at),last_out_at=COALESCE($3,last_out_at),reason=COALESCE($4,reason),notes=COALESCE($5,notes),source_method='ADMIN_OVERRIDE',approved_by=$6,updated_at=now() WHERE id=$7 AND organization_id=$8`,[changes.status??null,changes.firstInAt??null,changes.lastOutAt??null,changes.reason??null,changes.notes??null,userId,recordId,organizationId]);
    });
    await this.auditEvent({organizationId,actorId:userId,action:"record.corrected",entityType:"attendance_record",entityId:recordId,details:{correctionId,reason},requestId});return{id:recordId,correctionId};
  }

  async reportSummary({organizationId,from,to}){const start=asDate(from),end=asDate(to??from);const r=await this.database.query(`SELECT attendance_date,person_type,count(*)::int AS total,count(*) FILTER(WHERE status='present')::int AS present,count(*) FILTER(WHERE status='late')::int AS late,count(*) FILTER(WHERE status='absent')::int AS absent,count(*) FILTER(WHERE status IN ('excused','sick','permission','on_leave','official_duty','remote','half_day'))::int AS exceptions,round(100.0*count(*) FILTER(WHERE status IN ('present','late','official_duty','remote','half_day'))/NULLIF(count(*),0),1) AS attendance_percent FROM att_records WHERE organization_id=$1 AND attendance_date BETWEEN $2 AND $3 AND official=true GROUP BY attendance_date,person_type ORDER BY attendance_date DESC`,[organizationId,start,end]);return camels(r.rows);}

  async studentSession(db,organizationId,studentId,date,userId){
    const enrollment=await db.query(`SELECT e.academic_year_id,e.class_id,e.stream_id,s.campus_id,t.id AS term_id FROM school_enrollments e JOIN school_students s ON s.id=e.student_id LEFT JOIN school_terms t ON t.organization_id=e.organization_id AND t.academic_year_id=e.academic_year_id AND t.starts_on<=$1 AND t.ends_on>=$1 WHERE e.organization_id=$2 AND e.student_id=$3 AND e.enrolled_on<=$1 AND (e.left_on IS NULL OR e.left_on>=$1) AND e.status IN ('active','completed','repeated') ORDER BY e.enrolled_on DESC LIMIT 1`,[date,organizationId,studentId]);
    const e=enrollment.rows[0];if(!e)fail(409,"ACTIVE_ENROLLMENT_REQUIRED","The student has no active enrollment for this date");
    let session=await db.query(`SELECT * FROM att_sessions WHERE organization_id=$1 AND attendance_date=$2 AND session_type='daily' AND population='students' AND class_id=$3 AND COALESCE(stream_id,'')=COALESCE($4,'') LIMIT 1`,[organizationId,date,e.class_id,e.stream_id??null]);
    if(session.rows[0])return session.rows[0];
    const count=await db.query(`SELECT count(*)::int AS n FROM school_enrollments WHERE organization_id=$1 AND academic_year_id=$2 AND class_id=$3 AND COALESCE(stream_id,'')=COALESCE($4,'') AND enrolled_on<=$5 AND (left_on IS NULL OR left_on>=$5) AND status IN ('active','completed','repeated')`,[organizationId,e.academic_year_id,e.class_id,e.stream_id??null,date]);
    const sessionId=id("ats");
    await db.query(`INSERT INTO att_sessions(id,organization_id,academic_year_id,term_id,campus_id,attendance_date,session_type,population,class_id,stream_id,status,expected_count,source,created_by) VALUES($1,$2,$3,$4,$5,$6,'daily','students',$7,$8,'open',$9,'DEVICE',$10) ON CONFLICT DO NOTHING`,[sessionId,organizationId,e.academic_year_id,e.term_id??null,e.campus_id??null,date,e.class_id,e.stream_id??null,Number(count.rows[0]?.n??0),userId]);
    session=await db.query(`SELECT * FROM att_sessions WHERE organization_id=$1 AND attendance_date=$2 AND session_type='daily' AND population='students' AND class_id=$3 AND COALESCE(stream_id,'')=COALESCE($4,'') LIMIT 1`,[organizationId,date,e.class_id,e.stream_id??null]);
    return session.rows[0];
  }

  async recordEvent({organizationId,userId=null,input,actorType="user",requestId=null}){
    const event=normalizeEvent(input);
    return this.database.transaction(async(tx)=>{
      const person=await this.assertPerson(tx,organizationId,event.personType,event.personId);
      const p=await this.policy(tx,organizationId,event.personType==="student"?"students":"staff");
      const date=localDay(event.capturedAt,String(p.timezone||"Africa/Kampala"));const cooldown=Math.max(1,Number(p.duplicate_cooldown_seconds||60));const official=event.official===false?false:true;
      if(event.clientEventId){const existing=await tx.query(`SELECT id,captured_at,record_id FROM att_events WHERE organization_id=$1 AND ((device_id=$2 AND client_event_id=$3) OR (mobile_sync_device_id=$4 AND client_event_id=$3)) LIMIT 1`,[organizationId,event.deviceId??null,event.clientEventId,event.mobileSyncDeviceId??null]);if(existing.rows[0])return{duplicate:true,eventId:existing.rows[0].id,recordId:existing.rows[0].record_id,capturedAt:existing.rows[0].captured_at};}
      const recent=await tx.query(`SELECT id,captured_at,record_id FROM att_events WHERE organization_id=$1 AND person_type=$2 AND person_id=$3 AND direction=$4 AND verification_status='verified' AND official=$5 AND captured_at >= $6::timestamptz - ($7::int * interval '1 second') ORDER BY captured_at DESC LIMIT 1`,[organizationId,event.personType,event.personId,event.direction,official,event.capturedAt,cooldown]);
      if(recent.rows[0])return{duplicate:true,eventId:recent.rows[0].id,recordId:recent.rows[0].record_id,capturedAt:recent.rows[0].captured_at};
      if(!official){const eventId=id("ate");await tx.query(`INSERT INTO att_events(id,organization_id,device_id,sync_batch_id,client_event_id,person_type,person_id,direction,method,verification_mode,verification_status,confidence,liveness_score,captured_at,synced_at,official,metadata_json,created_by,mobile_sync_device_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'verified',$11,$12,$13,$14,false,$15,$16,$17)`,[eventId,organizationId,event.deviceId??null,event.syncBatchId??null,event.clientEventId,event.personType,event.personId,event.direction,event.method,event.verificationMode,event.confidence??null,event.livenessScore??null,event.capturedAt,event.syncedAt??null,JSON.stringify(event.metadata),userId,event.mobileSyncDeviceId??null]);return{duplicate:false,eventId,recordId:null,status:"test",capturedAt:event.capturedAt,person:camel(person)};}
      if(event.method==="FACE"&&event.verificationMode==="STANDARD"){
        const settings=await tx.query(`SELECT * FROM att_biometric_settings WHERE organization_id=$1`,[organizationId]);const s=settings.rows[0]??{};const minConfidence=Number(s.match_threshold??.78),minLiveness=Number(s.liveness_threshold??.70),minMargin=Number(s.ambiguity_margin??.05),confidence=Number(event.confidence??0),liveness=Number(event.livenessScore??0),margin=Number(event.matchMargin??event.metadata?.matchMargin??0);
        if(confidence<minConfidence||liveness<minLiveness||margin<minMargin){const eventId=id("ate");await tx.query(`INSERT INTO att_events(id,organization_id,device_id,sync_batch_id,client_event_id,person_type,person_id,direction,method,verification_mode,verification_status,confidence,liveness_score,captured_at,synced_at,official,metadata_json,created_by,mobile_sync_device_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'FACE','STANDARD','rejected',$9,$10,$11,$12,false,$13,$14,$15)`,[eventId,organizationId,event.deviceId??null,event.syncBatchId??null,event.clientEventId,event.personType,event.personId,event.direction,event.confidence??null,event.livenessScore??null,event.capturedAt,event.syncedAt??null,JSON.stringify({...event.metadata,matchMargin:margin,rejectionReason:"FACE_THRESHOLD_FAILED",required:{confidence:minConfidence,liveness:minLiveness,margin:minMargin}}),userId,event.mobileSyncDeviceId??null]);return{duplicate:false,rejected:true,eventId,recordId:null,status:"rejected",capturedAt:event.capturedAt,person:camel(person)};}
      }
      let session=null;if(event.personType==="student")session=await this.studentSession(tx,organizationId,event.personId,date,userId);
      const current=event.personType==="student"?await tx.query(`SELECT * FROM att_records WHERE organization_id=$1 AND session_id=$2 AND person_type='student' AND person_id=$3 FOR UPDATE`,[organizationId,session.id,event.personId]):await tx.query(`SELECT * FROM att_records WHERE organization_id=$1 AND attendance_date=$2 AND person_type='staff' AND person_id=$3 AND session_id IS NULL FOR UPDATE`,[organizationId,date,event.personId]);let record=current.rows[0];const minute=localMinutes(event.capturedAt,String(p.timezone||"Africa/Kampala"));const late=Math.max(0,(minute??0)-hhmm(String(p.late_after||"08:10")));const status=event.direction==="IN"?(late>0?"late":"present"):(record?.status||"present");const recordId=record?.id||id("atr");
      if(record)await tx.query(`UPDATE att_records SET status=$1,first_in_at=CASE WHEN $2='IN' AND first_in_at IS NULL THEN $3::timestamptz ELSE first_in_at END,last_out_at=CASE WHEN $2='OUT' THEN $3::timestamptz ELSE last_out_at END,minutes_late=CASE WHEN $2='IN' THEN $4 ELSE minutes_late END,source_method=$5,official=true,updated_at=now() WHERE id=$6 AND organization_id=$7`,[status,event.direction,event.capturedAt,late,event.method,recordId,organizationId]);
      else {await tx.query(`INSERT INTO att_records(id,organization_id,session_id,attendance_date,person_type,person_id,status,first_in_at,last_out_at,minutes_late,source_method,official,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,$12)`,[recordId,organizationId,session?.id??null,date,event.personType,event.personId,status,event.direction==="IN"?event.capturedAt:null,event.direction==="OUT"?event.capturedAt:null,late,event.method,userId]);if(session)await tx.query(`UPDATE att_sessions SET marked_count=marked_count+1,updated_at=now() WHERE id=$1`,[session.id]);}
      const eventId=id("ate");await tx.query(`INSERT INTO att_events(id,organization_id,device_id,sync_batch_id,client_event_id,person_type,person_id,direction,method,verification_mode,verification_status,confidence,liveness_score,captured_at,synced_at,official,record_id,metadata_json,created_by,mobile_sync_device_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'verified',$11,$12,$13,$14,true,$15,$16,$17,$18)`,[eventId,organizationId,event.deviceId??null,event.syncBatchId??null,event.clientEventId,event.personType,event.personId,event.direction,event.method,event.verificationMode,event.confidence??null,event.livenessScore??null,event.capturedAt,event.syncedAt??null,recordId,JSON.stringify(event.metadata),userId,event.mobileSyncDeviceId??null]);
      await this.auditEvent({organizationId,actorType,actorId:userId??event.deviceId??"attendance",action:"event.captured",entityType:"attendance_event",entityId:eventId,details:{personType:event.personType,personId:event.personId,direction:event.direction,method:event.method},requestId});return{duplicate:false,eventId,recordId,status,capturedAt:event.capturedAt,person:camel(person)};
    });
  }

  async offlineSync({organizationId,userId,deviceId,clientBatchId,events,actorType="user"}){
    if(!String(deviceId??"").trim()||!String(clientBatchId??"").trim()||!Array.isArray(events)||events.length<1||events.length>500)fail(422,"VALIDATION_ERROR","Invalid offline sync batch");
    const device=await this.database.query(`SELECT * FROM att_devices WHERE id=$1 AND organization_id=$2 AND status='active'`,[deviceId,organizationId]);if(!device.rows[0])fail(403,"DEVICE_INACTIVE","The attendance device is not active");
    const old=await this.database.query(`SELECT * FROM att_device_sync_batches WHERE organization_id=$1 AND device_id=$2 AND client_batch_id=$3`,[organizationId,deviceId,clientBatchId]);if(old.rows[0])return{...camel(old.rows[0]),idempotent:true};
    const batchId=id("asb");await this.database.query(`INSERT INTO att_device_sync_batches(id,organization_id,device_id,client_batch_id,event_count) VALUES($1,$2,$3,$4,$5)`,[batchId,organizationId,deviceId,clientBatchId,events.length]);let accepted=0,duplicates=0,rejected=0;
    for(const raw of events){try{const event=normalizeEvent({...raw,deviceId,syncBatchId:batchId,syncedAt:new Date().toISOString()});if(event.verificationMode==="TEST"){const grant=await this.database.query(`SELECT 1 FROM att_test_mode_grants WHERE organization_id=$1 AND device_id=$2 AND revoked_at IS NULL AND expires_at>now() ORDER BY enabled_at DESC LIMIT 1`,[organizationId,deviceId]);if(!grant.rows[0])throw new Error("Expired test mode");event.official=false;}const r=await this.recordEvent({organizationId,userId,input:event,actorType});r.duplicate?duplicates++:r.rejected?rejected++:accepted++;}catch{rejected++;}}
    const status=rejected===events.length?"rejected":rejected?"partial":"processed";await this.database.query(`UPDATE att_device_sync_batches SET accepted_count=$1,duplicate_count=$2,rejected_count=$3,status=$4,completed_at=now() WHERE id=$5`,[accepted,duplicates,rejected,status,batchId]);await this.database.query(`UPDATE att_devices SET last_sync_at=now(),last_seen_at=now() WHERE id=$1`,[deviceId]);return{id:batchId,eventCount:events.length,accepted,duplicates,rejected,status};
  }

  async createKioskEnrollment({organizationId,userId,input,requestId=null}){
    const name=String(input.name??"").trim();if(!name)fail(422,"VALIDATION_ERROR","Kiosk name is required");const deviceId=id("atd"),count=await this.database.query(`SELECT count(*)::int AS n FROM att_devices WHERE organization_id=$1`,[organizationId]),deviceCode=`ATT-${String(Number(count.rows[0]?.n??0)+1).padStart(6,"0")}`,population=POPULATIONS.has(input.population)?input.population:"mixed",direction=DEVICE_DIRECTIONS.has(input.direction)?input.direction:"BOTH";
    await this.database.query(`INSERT INTO att_devices(id,organization_id,device_code,name,location_name,campus_id,population,direction,status,registered_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9)`,[deviceId,organizationId,deviceCode,name,String(input.locationName??"").trim()||null,input.campusId||null,population,direction,userId]);const enrollment=await this.issueEnrollment({organizationId,deviceId,userId});await this.auditEvent({organizationId,actorId:userId,action:"device.enrollment.created",entityType:"attendance_device",entityId:deviceId,details:{deviceCode,expiresAt:enrollment.enrollmentExpiresAt},requestId});return{id:deviceId,deviceCode,name,status:"pending",...enrollment,note:"Scan this one-time QR code on the Android kiosk before it expires."};
  }

  async issueEnrollment({organizationId,deviceId,userId}){await this.database.query(`UPDATE att_device_enrollment_tokens SET consumed_at=now() WHERE organization_id=$1 AND device_id=$2 AND consumed_at IS NULL`,[organizationId,deviceId]);const enrollmentToken=token(32),enrollmentExpiresAt=new Date(Date.now()+10*60_000).toISOString();await this.database.query(`INSERT INTO att_device_enrollment_tokens(id,organization_id,device_id,token_hash,expires_at,created_by) VALUES($1,$2,$3,$4,$5,$6)`,[id("ade"),organizationId,deviceId,sha256(enrollmentToken),enrollmentExpiresAt,userId]);return{enrollmentToken,enrollmentExpiresAt};}
  async refreshKioskEnrollment({organizationId,userId,deviceId,requestId=null}){const r=await this.database.query(`SELECT id,device_code,name,status FROM att_devices WHERE id=$1 AND organization_id=$2`,[deviceId,organizationId]);const d=r.rows[0];if(!d)fail(404,"ATTENDANCE_DEVICE_NOT_FOUND","Attendance kiosk not found");if(d.status!=="pending")fail(409,"KIOSK_ALREADY_REGISTERED","Only a pending kiosk can receive a new enrollment QR code");const enrollment=await this.issueEnrollment({organizationId,deviceId,userId});await this.auditEvent({organizationId,actorId:userId,action:"device.enrollment.refreshed",entityType:"attendance_device",entityId:deviceId,details:{expiresAt:enrollment.enrollmentExpiresAt},requestId});return{id:deviceId,deviceCode:d.device_code,name:d.name,status:"pending",...enrollment};}

  async enrollDevice({enrollmentToken,appVersion=null}){
    if(String(enrollmentToken??"").length<20)fail(422,"VALIDATION_ERROR","Invalid kiosk enrollment request");const hash=sha256(enrollmentToken);return this.database.transaction(async(tx)=>{const lookup=await tx.query(`SELECT e.id AS enrollment_id,e.organization_id,e.device_id,d.device_code,d.name FROM att_device_enrollment_tokens e JOIN att_devices d ON d.id=e.device_id AND d.organization_id=e.organization_id JOIN organization_modules om ON om.organization_id=e.organization_id AND om.module_key='attendance' AND om.enabled=true WHERE e.token_hash=$1 AND e.consumed_at IS NULL AND e.expires_at>now() AND d.status='pending' LIMIT 1 FOR UPDATE`,[hash]);const row=lookup.rows[0];if(!row)fail(401,"INVALID_ENROLLMENT_QR","This kiosk QR code is invalid, expired or already used");const claimed=await tx.query(`UPDATE att_device_enrollment_tokens SET consumed_at=now() WHERE id=$1 AND consumed_at IS NULL AND expires_at>now() RETURNING id`,[row.enrollment_id]);if(!claimed.rowCount)fail(409,"ENROLLMENT_ALREADY_USED","This kiosk QR code has already been used");const credential=token(32);await tx.query(`UPDATE att_device_credentials SET revoked_at=now() WHERE organization_id=$1 AND device_id=$2 AND revoked_at IS NULL`,[row.organization_id,row.device_id]);await tx.query(`INSERT INTO att_device_credentials(id,organization_id,device_id,credential_hash) VALUES($1,$2,$3,$4)`,[id("adc"),row.organization_id,row.device_id,sha256(credential)]);await tx.query(`UPDATE att_devices SET status='active',app_version=$1,last_seen_at=now(),updated_at=now() WHERE id=$2 AND organization_id=$3 AND status='pending'`,[appVersion||null,row.device_id,row.organization_id]);await this.auditEvent({organizationId:row.organization_id,actorType:"device",actorId:row.device_id,action:"device.enrolled",entityType:"attendance_device",entityId:row.device_id,details:{method:"qr",appVersion:appVersion||null}});return{deviceId:row.device_id,deviceCode:row.device_code,name:row.name,credential,status:"active"};});
  }

  async authenticateDevice(authorization){const match=/^Device\s+([^\.\s]+)\.([^\s]+)$/.exec(String(authorization??""));if(!match)fail(401,"DEVICE_AUTH_REQUIRED","A device credential is required");const r=await this.database.query(`SELECT d.* FROM att_devices d JOIN att_device_credentials cr ON cr.device_id=d.id AND cr.organization_id=d.organization_id JOIN organization_modules om ON om.organization_id=d.organization_id AND om.module_key='attendance' AND om.enabled=true WHERE d.id=$1 AND d.status='active' AND cr.credential_hash=$2 AND cr.revoked_at IS NULL AND (cr.expires_at IS NULL OR cr.expires_at>now()) ORDER BY cr.created_at DESC LIMIT 1`,[match[1],sha256(match[2])]);const d=r.rows[0];if(!d)fail(401,"INVALID_DEVICE_CREDENTIAL","Device credential is invalid, expired or revoked");await Promise.all([this.database.query(`UPDATE att_devices SET last_seen_at=now() WHERE id=$1`,[d.id]),this.database.query(`UPDATE att_device_credentials SET last_used_at=now() WHERE organization_id=$1 AND device_id=$2 AND credential_hash=$3 AND revoked_at IS NULL`,[d.organization_id,d.id,sha256(match[2])])]);return d;}

  async deviceBootstrap(device){const org=device.organization_id,pop=String(device.population);const [studentPolicy,staffPolicy,testMode,students,staff,identifiers]=await Promise.all([this.policy(this.database,org,"students"),this.policy(this.database,org,"staff"),this.database.query(`SELECT allow_screen_image,allow_printed_image,expires_at FROM att_test_mode_grants WHERE organization_id=$1 AND device_id=$2 AND revoked_at IS NULL AND expires_at>now() ORDER BY enabled_at DESC LIMIT 1`,[org,device.id]),pop==="staff"?Promise.resolve({rows:[]}):this.database.query(`SELECT s.id,s.admission_number,s.student_number,trim(concat_ws(' ',s.first_name,s.last_name)) AS name,c.name AS group_name,b.provider_profile_ref,b.algorithm_version FROM school_students s LEFT JOIN school_classes c ON c.id=s.current_class_id LEFT JOIN att_biometric_profiles b ON b.organization_id=s.organization_id AND b.person_type='student' AND b.person_id=s.id AND b.status='active' WHERE s.organization_id=$1 AND s.deleted_at IS NULL AND s.status='active' ORDER BY s.last_name,s.first_name`,[org]),pop==="students"?Promise.resolve({rows:[]}):this.database.query(`SELECT s.id,s.staff_number,trim(concat_ws(' ',s.first_name,s.last_name)) AS name,d.name AS group_name,b.provider_profile_ref,b.algorithm_version FROM school_staff_profiles s LEFT JOIN school_departments d ON d.id=s.department_id LEFT JOIN att_biometric_profiles b ON b.organization_id=s.organization_id AND b.person_type='staff' AND b.person_id=s.id AND b.status='active' WHERE s.organization_id=$1 AND s.deleted_at IS NULL AND s.employment_status='active' ORDER BY s.last_name,s.first_name`,[org]),this.database.query(`SELECT person_type,person_id,method,identifier FROM att_person_identifiers WHERE organization_id=$1 AND active=true`,[org])]);return{generatedAt:new Date().toISOString(),device:camel(device),camera:{source:"device",preferredFacing:"front",allowFacingSwitch:true},policies:{students:camel(studentPolicy),staff:camel(staffPolicy)},testMode:testMode.rows[0]?camel(testMode.rows[0]):null,roster:camels([...students.rows,...staff.rows]),identifiers:camels(identifiers.rows)};}

  async faceState(device){const org=device.organization_id,pop=String(device.population);const [settings,job,primary,samples]=await Promise.all([this.database.query(`SELECT * FROM att_biometric_settings WHERE organization_id=$1`,[org]),this.database.query(`SELECT j.*,COALESCE(trim(concat_ws(' ',s.first_name,s.last_name)),trim(concat_ws(' ',sp.first_name,sp.last_name))) AS person_name,COALESCE(c.name,dep.name) AS group_name FROM att_biometric_enrollment_jobs j LEFT JOIN school_students s ON j.person_type='student' AND s.id=j.person_id LEFT JOIN school_classes c ON s.current_class_id=c.id LEFT JOIN school_staff_profiles sp ON j.person_type='staff' AND sp.id=j.person_id LEFT JOIN school_departments dep ON sp.department_id=dep.id WHERE j.organization_id=$1 AND j.device_id=$2 AND j.status IN ('pending','claimed') ORDER BY CASE j.status WHEN 'claimed' THEN 0 ELSE 1 END,j.requested_at LIMIT 1`,[org,device.id]),this.database.query(`SELECT count(*)::int AS count,max(t.updated_at) AS version FROM att_biometric_templates t JOIN att_biometric_profiles p ON p.id=t.profile_id WHERE t.organization_id=$1 AND t.active=true AND p.status='active' AND ($2='mixed' OR ($2='students' AND t.person_type='student') OR ($2='staff' AND t.person_type='staff'))`,[org,pop]),this.database.query(`SELECT count(*)::int AS count,max(t.updated_at) AS version FROM att_biometric_template_samples t JOIN att_biometric_profiles p ON p.id=t.profile_id WHERE t.organization_id=$1 AND t.active=true AND p.status='active' AND ($2='mixed' OR ($2='students' AND t.person_type='student') OR ($2='staff' AND t.person_type='staff'))`,[org,pop])]);const count=Number(primary.rows[0]?.count??0)+Number(samples.rows[0]?.count??0),versions=[primary.rows[0]?.version,samples.rows[0]?.version].filter(Boolean).map(x=>new Date(x).getTime());return{settings:camel(settings.rows[0]??{algorithm_version:"facenet-128-v1",match_threshold:.78,ambiguity_margin:.05,liveness_threshold:.70,quality_threshold:.55}),enrollmentJob:job.rows[0]?camel(job.rows[0]):null,templates:{count,version:versions.length?new Date(Math.max(...versions)).toISOString():null}};}

  async faceTemplates(device){if(!biometricReady(this.biometricKey))fail(503,"BIOMETRIC_KEY_REQUIRED","Biometric template encryption key is not configured");const org=device.organization_id,pop=String(device.population);const r=await this.database.query(`SELECT t.person_type,t.person_id,'primary' AS sample_id,t.algorithm_version,t.embedding_ciphertext,t.embedding_iv,t.quality_score,t.updated_at FROM att_biometric_templates t JOIN att_biometric_profiles p ON p.id=t.profile_id WHERE t.organization_id=$1 AND t.active=true AND p.status='active' AND ($2='mixed' OR ($2='students' AND t.person_type='student') OR ($2='staff' AND t.person_type='staff')) UNION ALL SELECT t.person_type,t.person_id,'pose-'||t.sample_index AS sample_id,t.algorithm_version,t.embedding_ciphertext,t.embedding_iv,t.quality_score,t.updated_at FROM att_biometric_template_samples t JOIN att_biometric_profiles p ON p.id=t.profile_id WHERE t.organization_id=$1 AND t.active=true AND p.status='active' AND ($2='mixed' OR ($2='students' AND t.person_type='student') OR ($2='staff' AND t.person_type='staff')) ORDER BY person_type,person_id,sample_id`,[org,pop]);const templates=[];for(const row of r.rows){const context=row.sample_id==="primary"?`${org}:${row.person_type}:${row.person_id}:${row.algorithm_version}`:`${org}:${row.person_type}:${row.person_id}:${row.algorithm_version}:${row.sample_id}`;templates.push({personType:row.person_type,personId:row.person_id,sampleId:row.sample_id,algorithmVersion:row.algorithm_version,embeddingBase64:await decryptEmbedding(this.biometricKey,row.embedding_ciphertext,row.embedding_iv,context),qualityScore:row.quality_score,updatedAt:row.updated_at});}const version=templates.length?String(Math.max(...r.rows.map(row=>new Date(row.updated_at).getTime()||0))):"0";return{version,count:templates.length,replaceAll:true,templates};}

  async claimEnrollmentJob(device,jobId){const r=await this.database.query(`UPDATE att_biometric_enrollment_jobs SET status='claimed',claimed_at=COALESCE(claimed_at,now()),updated_at=now() WHERE id=$1 AND organization_id=$2 AND device_id=$3 AND status IN ('pending','claimed') RETURNING id,status`,[jobId,device.organization_id,device.id]);if(!r.rows[0])fail(404,"ENROLLMENT_JOB_NOT_FOUND","Enrollment job is unavailable");return{id:jobId,status:"claimed"};}

  async completeEnrollmentJob(device,jobId,input){const org=device.organization_id;const jobResult=await this.database.query(`SELECT * FROM att_biometric_enrollment_jobs WHERE id=$1 AND organization_id=$2 AND device_id=$3 AND status IN ('pending','claimed')`,[jobId,org,device.id]);const job=jobResult.rows[0];if(!job)fail(404,"ENROLLMENT_JOB_NOT_FOUND","Enrollment job is unavailable");const settingsResult=await this.database.query(`SELECT * FROM att_biometric_settings WHERE organization_id=$1`,[org]);const settings=settingsResult.rows[0]??{};const algorithm=String(input.algorithmVersion??""),quality=Number(input.qualityScore),live=Number(input.livenessScore),poseCount=clampInt(input.poseCount,0,1,12),primary=String(input.embeddingBase64??""),samplesRaw=Array.isArray(input.embeddingsBase64)?input.embeddingsBase64:[];if(!algorithm||primary.length<16||!Number.isFinite(quality)||!Number.isFinite(live))fail(422,"VALIDATION_ERROR","Invalid biometric enrollment result");const minQ=Number(settings.quality_threshold??.55),minL=Number(settings.liveness_threshold??.70),expectedAlgorithm=String(settings.algorithm_version||"facenet-128-v1");if(quality<minQ)fail(422,"FACE_QUALITY_TOO_LOW",`Face quality must be at least ${minQ}`);if(live<minL)fail(422,"LIVENESS_FAILED",`Liveness score must be at least ${minL}`);if(algorithm!==expectedAlgorithm)fail(409,"FACE_ALGORITHM_MISMATCH","Kiosk face model does not match the school's configured algorithm");const secured=await encryptEmbedding(this.biometricKey,primary,`${org}:${job.person_type}:${job.person_id}:${algorithm}`,algorithm==="facenet-128-v1"?512:undefined);const samples=[];for(let index=0;index<samplesRaw.length;index++){samples.push({index,secured:await encryptEmbedding(this.biometricKey,String(samplesRaw[index]),`${org}:${job.person_type}:${job.person_id}:${algorithm}:pose-${index}`,algorithm==="facenet-128-v1"?512:undefined)});}return this.database.transaction(async(tx)=>{const existing=await tx.query(`SELECT id FROM att_biometric_profiles WHERE organization_id=$1 AND person_type=$2 AND person_id=$3`,[org,job.person_type,job.person_id]);const profileId=existing.rows[0]?.id||id("abp");const profile=await tx.query(`INSERT INTO att_biometric_profiles(id,organization_id,person_type,person_id,provider_profile_ref,algorithm_version,quality_score,consent_status,status,enrolled_by,enrolled_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'active',$9,now()) ON CONFLICT(organization_id,person_type,person_id) DO UPDATE SET provider_profile_ref=excluded.provider_profile_ref,algorithm_version=excluded.algorithm_version,quality_score=excluded.quality_score,consent_status=excluded.consent_status,status='active',enrolled_by=excluded.enrolled_by,enrolled_at=now(),deleted_at=NULL,updated_at=now() RETURNING id`,[profileId,org,job.person_type,job.person_id,`local:${profileId}`,algorithm,quality,job.consent_status,job.requested_by]);const actualProfileId=profile.rows[0].id;await tx.query(`INSERT INTO att_biometric_templates(id,organization_id,profile_id,person_type,person_id,algorithm_version,embedding_ciphertext,embedding_iv,embedding_bytes,quality_score,liveness_score) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(organization_id,person_type,person_id) DO UPDATE SET profile_id=excluded.profile_id,algorithm_version=excluded.algorithm_version,embedding_ciphertext=excluded.embedding_ciphertext,embedding_iv=excluded.embedding_iv,embedding_bytes=excluded.embedding_bytes,quality_score=excluded.quality_score,liveness_score=excluded.liveness_score,version=att_biometric_templates.version+1,active=true,updated_at=now()`,[id("abt"),org,actualProfileId,job.person_type,job.person_id,algorithm,secured.ciphertext,secured.iv,secured.bytes,quality,live]);await tx.query(`UPDATE att_biometric_template_samples SET active=false,updated_at=now() WHERE organization_id=$1 AND person_type=$2 AND person_id=$3`,[org,job.person_type,job.person_id]);for(const sample of samples){await tx.query(`INSERT INTO att_biometric_template_samples(id,organization_id,profile_id,person_type,person_id,sample_index,algorithm_version,embedding_ciphertext,embedding_iv,embedding_bytes,quality_score,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true) ON CONFLICT(organization_id,person_type,person_id,sample_index) DO UPDATE SET profile_id=excluded.profile_id,algorithm_version=excluded.algorithm_version,embedding_ciphertext=excluded.embedding_ciphertext,embedding_iv=excluded.embedding_iv,embedding_bytes=excluded.embedding_bytes,quality_score=excluded.quality_score,active=true,updated_at=now()`,[id("abs"),org,actualProfileId,job.person_type,job.person_id,sample.index,algorithm,sample.secured.ciphertext,sample.secured.iv,sample.secured.bytes,quality]);}await tx.query(`INSERT INTO att_biometric_enrollments(id,organization_id,profile_id,provider_enrollment_ref,algorithm_version,pose_count,quality_score,liveness_score,status,enrolled_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'completed',$9)`,[id("abe"),org,actualProfileId,`device:${device.id}`,algorithm,poseCount,quality,live,job.requested_by]);await tx.query(`UPDATE att_biometric_enrollment_jobs SET status='completed',completed_at=now(),result_profile_id=$1,result_quality_score=$2,result_liveness_score=$3,failure_reason=NULL,updated_at=now() WHERE id=$4`,[actualProfileId,quality,live,jobId]);await this.auditEvent({organizationId:org,actorType:"device",actorId:device.id,action:"biometric.enrolled",entityType:"biometric_profile",entityId:actualProfileId,details:{personType:job.person_type,personId:job.person_id,algorithmVersion:algorithm,qualityScore:quality,livenessScore:live,sampleCount:samples.length,timings:input.timings||{}}});return{jobId,profileId:actualProfileId,status:"completed",qualityScore:quality,livenessScore:live};});}

  async failEnrollmentJob(device,jobId,reason){const message=String(reason||"Enrollment failed").slice(0,500);const r=await this.database.query(`UPDATE att_biometric_enrollment_jobs SET status='failed',failure_reason=$1,completed_at=now(),updated_at=now() WHERE id=$2 AND organization_id=$3 AND device_id=$4 AND status IN ('pending','claimed') RETURNING id`,[message,jobId,device.organization_id,device.id]);if(!r.rowCount)fail(404,"ENROLLMENT_JOB_NOT_FOUND","Enrollment job is unavailable");return{id:jobId,status:"failed",reason:message};}

  async readiness(){const r=await this.database.query(`SELECT to_regclass('public.att_records') IS NOT NULL AS records,to_regclass('public.att_events') IS NOT NULL AS events,to_regclass('public.att_sessions') IS NOT NULL AS sessions,to_regclass('public.att_devices') IS NOT NULL AS devices,to_regclass('public.att_biometric_profiles') IS NOT NULL AS biometrics,to_regclass('public.att_device_enrollment_tokens') IS NOT NULL AS enrollment`);const row=r.rows[0]??{};const schemaReady=Object.values(row).every(Boolean);return{ok:schemaReady,provider:this.provider,schemaReady,biometricEncryptionReady:biometricReady(this.biometricKey)};}
  describe(){return{provider:this.provider,canonicalRecords:true,offlineSync:true,kioskEnrollment:true,deviceCredentials:true,biometrics:true,cloudflareFallbackPreserved:true};}
}

export function createAttendanceService(options){return new AttendanceService(options);}
