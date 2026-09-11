import { randomUUID } from 'node:crypto';

export class ExamIntegrityError extends Error {
  constructor(message, code = 'EXAM_INTEGRITY', status = 409) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function bool(value) { return value === true || value === 1 || value === '1'; }
function finite(value) { return value != null && Number.isFinite(Number(value)); }

export function examMarkRecordId({ examId, studentId, subjectId }) {
  return `${examId}:${studentId}:${subjectId}`;
}

export async function assertMarkContext(tx, { organizationId, examId, examSubjectId, studentId, classId, subjectId, streamId = null }) {
  const result = await tx.query(`
    SELECT e.status,e.academic_year_id,e.grading_scale_id,es.class_id,es.subject_id,es.max_mark,
           s.current_class_id,s.current_stream_id,
           EXISTS(
             SELECT 1 FROM exm_exam_classes ec
             WHERE ec.organization_id=e.organization_id AND ec.exam_id=e.id AND ec.class_id=es.class_id
               AND (ec.stream_id IS NULL OR ec.stream_id=$7)
           ) AS exam_class_allowed,
           CASE WHEN e.academic_year_id IS NULL THEN s.current_class_id=es.class_id
                ELSE EXISTS(
                  SELECT 1 FROM school_enrollments se
                  WHERE se.organization_id=e.organization_id AND se.student_id=s.id
                    AND se.academic_year_id=e.academic_year_id AND se.class_id=es.class_id
                    AND ($7::text IS NULL OR se.stream_id IS NULL OR se.stream_id=$7)
                    AND se.status IN ('active','completed','promoted','transferred')
                ) END AS student_in_roster
    FROM exm_exams e
    JOIN exm_exam_subjects es ON es.organization_id=e.organization_id AND es.exam_id=e.id AND es.id=$3
    JOIN school_students s ON s.id=$4 AND s.organization_id=e.organization_id
    WHERE e.id=$2 AND e.organization_id=$1 AND es.class_id=$5 AND es.subject_id=$6`,
    [organizationId, examId, examSubjectId, studentId, classId, subjectId, streamId],
  );
  const context = result.rows[0];
  if (!context) throw new ExamIntegrityError('Exam, subject or student is outside this organization', 'EXAM_CONTEXT');
  if (!context.exam_class_allowed || !context.student_in_roster) {
    throw new ExamIntegrityError('Student/class/stream is not in the exam roster', 'EXAM_ROSTER');
  }
  if (['published', 'archived'].includes(context.status)) {
    throw new ExamIntegrityError('Published or archived exam marks are locked', 'EXAM_LOCKED');
  }
  return context;
}

export function selectGradeBand(percentage, bands) {
  if (!finite(percentage)) return null;
  const value = Number(percentage);
  return [...(bands ?? [])]
    .sort((a, b) => Number(a.sort_order ?? a.sortOrder ?? 0) - Number(b.sort_order ?? b.sortOrder ?? 0))
    .find((band) => value >= Number(band.min_mark ?? band.minMark) && value <= Number(band.max_mark ?? band.maxMark)) ?? null;
}

export async function upsertMark(database, input, { emitChange = null } = {}) {
  return database.transaction(async (tx) => {
    const context = await assertMarkContext(tx, input);
    const absent = Boolean(input.isAbsent);
    const exempt = Boolean(input.isExempt);
    if (absent && exempt) throw new ExamIntegrityError('A mark cannot be both absent and exempt', 'MARK_FLAGS', 400);
    const mark = input.marksObtained == null ? null : Number(input.marksObtained);
    if (mark != null && (!Number.isFinite(mark) || mark < 0 || mark > Number(context.max_mark))) {
      throw new ExamIntegrityError('Mark is outside the configured subject maximum', 'MARK_RANGE', 400);
    }
    const existing = await tx.query(
      `SELECT * FROM exm_marks WHERE organization_id=$1 AND exam_id=$2 AND student_id=$3 AND subject_id=$4 FOR UPDATE`,
      [input.organizationId, input.examId, input.studentId, input.subjectId],
    );
    const percentage = mark == null || absent || exempt ? null : (mark / Number(context.max_mark)) * 100;
    const bands = await tx.query(`
      SELECT b.* FROM exm_grade_bands b
      WHERE b.organization_id=$2 AND b.grading_scale_id=$3
      ORDER BY b.sort_order,b.max_mark DESC`, [input.examId, input.organizationId, context.grading_scale_id]);
    const band = selectGradeBand(percentage, bands.rows);
    const id = existing.rows[0]?.id ?? input.id ?? `mark_${randomUUID()}`;
    const result = await tx.query(`
      INSERT INTO exm_marks(id,organization_id,exam_id,exam_subject_id,student_id,class_id,subject_id,
        marks_obtained,is_absent,is_exempt,percentage,grade,grade_points,remarks,entered_by,entered_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now(),now())
      ON CONFLICT(exam_id,student_id,subject_id) DO UPDATE SET
        exam_subject_id=EXCLUDED.exam_subject_id,class_id=EXCLUDED.class_id,marks_obtained=EXCLUDED.marks_obtained,
        is_absent=EXCLUDED.is_absent,is_exempt=EXCLUDED.is_exempt,percentage=EXCLUDED.percentage,
        grade=EXCLUDED.grade,grade_points=EXCLUDED.grade_points,remarks=EXCLUDED.remarks,
        entered_by=EXCLUDED.entered_by,entered_at=EXCLUDED.entered_at,updated_at=now()
      RETURNING *`,
      [id,input.organizationId,input.examId,input.examSubjectId,input.studentId,input.classId,input.subjectId,
       mark,absent,exempt,percentage,band?.grade ?? null,band?.points ?? null,input.remarks ?? null,input.actorUserId ?? null],
    );
    const saved = result.rows[0];
    const previous = existing.rows[0] ?? null;
    await tx.query(`INSERT INTO exm_mark_audit(id,organization_id,mark_id,exam_id,student_id,subject_id,action,old_mark,new_mark,changed_by,reason,changes_json)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[
      `audit_${randomUUID()}`,input.organizationId,saved.id,input.examId,input.studentId,input.subjectId,
      previous ? 'update' : 'insert',previous?.marks_obtained ?? null,saved.marks_obtained,input.actorUserId ?? null,input.reason ?? null,
      JSON.stringify({old:previous,new:saved}),
    ]);
    if (emitChange) await emitChange({transaction:tx,organizationId:input.organizationId,moduleKey:'exams',collectionKey:'marks',recordId:examMarkRecordId(input),operation:'upsert',payload:saved,changedBy:input.actorUserId ?? null});
    return saved;
  });
}

export function calculateAggregate(subjectResults, { bestSubjects = 4 } = {}) {
  const points = (subjectResults ?? [])
    .filter((row) => !bool(row.isAbsent ?? row.is_absent) && !bool(row.isExempt ?? row.is_exempt) && finite(row.gradePoints ?? row.grade_points))
    .map((row) => Number(row.gradePoints ?? row.grade_points))
    .sort((a, b) => a - b);
  return points.slice(0, Math.max(0, Number(bestSubjects) || 0)).reduce((sum, value) => sum + value, 0);
}

export function calculateDivision(aggregate, rules, subjectsSat, { subjectsMissing = 0 } = {}) {
  if (Number(subjectsMissing) > 0) return 'X';
  if (!finite(aggregate)) return null;
  const sorted = [...(rules ?? [])].filter((rule) => rule.active !== false).sort((a,b) => Number(a.sequenceNo ?? a.sequence_no ?? 0) - Number(b.sequenceNo ?? b.sequence_no ?? 0));
  return sorted.find((rule) =>
    (rule.minSubjects == null && rule.min_subjects == null || subjectsSat >= Number(rule.minSubjects ?? rule.min_subjects)) &&
    (rule.minAggregate == null && rule.min_aggregate == null || aggregate >= Number(rule.minAggregate ?? rule.min_aggregate)) &&
    (rule.maxAggregate == null && rule.max_aggregate == null || aggregate <= Number(rule.maxAggregate ?? rule.max_aggregate)))?.code ?? 'U';
}

export function rankResults(rows) {
  const sorted = [...(rows ?? [])].sort((a,b) =>
    (a.aggregate ?? Infinity) - (b.aggregate ?? Infinity) ||
    Number(b.totalMarks ?? b.total_marks ?? 0) - Number(a.totalMarks ?? a.total_marks ?? 0) ||
    String(a.studentId ?? a.student_id).localeCompare(String(b.studentId ?? b.student_id)));
  let prior = null;
  return sorted.map((row, index) => {
    const aggregate = row.aggregate ?? null;
    const total = Number(row.totalMarks ?? row.total_marks ?? 0);
    const tied = prior && aggregate === prior.aggregate && total === prior.total;
    const position = tied ? prior.position : index + 1;
    prior = {aggregate,total,position};
    return {...row,position};
  });
}
