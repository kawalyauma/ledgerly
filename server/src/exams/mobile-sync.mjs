import { randomUUID } from 'node:crypto';
import { assertMarkContext, examMarkRecordId, selectGradeBand } from './integrity.mjs';

async function hasPermission(database, organizationId, userId, permission) {
  const result = await database.query(`
    SELECT 1
    FROM memberships m
    WHERE m.organization_id=$1 AND m.user_id=$2
      AND (
        m.role IN ('owner','admin','super_admin')
        OR EXISTS (
          SELECT 1 FROM school_user_roles ur
          JOIN school_role_permissions rp ON rp.organization_id=ur.organization_id AND rp.role_id=ur.role_id
          WHERE ur.organization_id=m.organization_id AND ur.user_id=m.user_id
            AND rp.permission=$3 AND rp.effect='allow'
            AND (ur.starts_at IS NULL OR ur.starts_at<=now()) AND (ur.ends_at IS NULL OR ur.ends_at>now())
        )
      )
    LIMIT 1`, [organizationId,userId,permission]);
  return result.rowCount>0;
}

export async function canReadExamSync(database,{organizationId,userId,collectionKey,recordId}) {
  if(!await hasPermission(database,organizationId,userId,'school.exams:read')) return false;
  if(collectionKey==='setup') {
    const [kind,id]=String(recordId).split(':',2);
    const mapping={exam:['exm_exams','id'],class:['exm_exam_classes','id'],subject:['exm_exam_subjects','id'],scale:['exm_grading_scales','id'],band:['exm_grade_bands','id'],comment:['exm_comment_rules','id']};
    const entry=mapping[kind]; if(!entry)return false;
    const result=await database.query(`SELECT 1 FROM ${entry[0]} WHERE organization_id=$1 AND ${entry[1]}=$2 LIMIT 1`,[organizationId,id]);
    return result.rowCount>0;
  }
  if(collectionKey==='marks') {
    const [examId,studentId,subjectId]=String(recordId).split(':');
    const result=await database.query(`SELECT 1 FROM exm_marks WHERE organization_id=$1 AND exam_id=$2 AND student_id=$3 AND subject_id=$4 LIMIT 1`,[organizationId,examId,studentId,subjectId]);
    return result.rowCount>0;
  }
  if(collectionKey==='report-cards') {
    const [examId,studentId]=String(recordId).split(':');
    const result=await database.query(`SELECT 1 FROM exm_report_cards WHERE organization_id=$1 AND exam_id=$2 AND student_id=$3 LIMIT 1`,[organizationId,examId,studentId]);
    return result.rowCount>0;
  }
  return false;
}

export async function applyExamMarkSync({transaction,organizationId,userId,operation}) {
  if(!await hasPermission({query:(...args)=>transaction.query(...args)},organizationId,userId,'school.exams:write')) {
    throw Object.assign(new Error('school.exams:write permission required'),{code:'SYNC_FORBIDDEN',status:403});
  }
  const payload=operation.payload??{};
  const examId=payload.examId; const studentId=payload.studentId; const subjectId=payload.subjectId;
  if(examMarkRecordId({examId,studentId,subjectId})!==operation.recordId) throw Object.assign(new Error('exam mark record id mismatch'),{code:'SYNC_RECORD_MISMATCH',status:400});
  if(operation.kind==='delete') {
    const exam=await transaction.query(`SELECT status FROM exm_exams WHERE organization_id=$1 AND id=$2 FOR UPDATE`,[organizationId,examId]);
    if(!exam.rows[0]) throw Object.assign(new Error('exam not found'),{code:'EXAM_CONTEXT',status:404});
    if(['published','archived'].includes(exam.rows[0].status)) throw Object.assign(new Error('published or archived exam marks are locked'),{code:'EXAM_LOCKED',status:409});
    const prior=await transaction.query(`DELETE FROM exm_marks WHERE organization_id=$1 AND exam_id=$2 AND student_id=$3 AND subject_id=$4 RETURNING *`,[organizationId,examId,studentId,subjectId]);
    if(prior.rows[0]) await transaction.query(`INSERT INTO exm_mark_audit(id,organization_id,mark_id,exam_id,student_id,subject_id,action,old_mark,new_mark,changed_by,changes_json) VALUES($1,$2,$3,$4,$5,$6,'delete',$7,NULL,$8,$9)`,[`audit_${randomUUID()}`,organizationId,prior.rows[0].id,examId,studentId,subjectId,prior.rows[0].marks_obtained,userId,JSON.stringify({old:prior.rows[0]})]);
    return {result:{deleted:Boolean(prior.rows[0])}};
  }
  const context=await assertMarkContext(transaction,{organizationId,examId,examSubjectId:payload.examSubjectId,studentId,classId:payload.classId,subjectId,streamId:payload.streamId??null});
  const absent=Boolean(payload.isAbsent),exempt=Boolean(payload.isExempt); if(absent&&exempt)throw Object.assign(new Error('mark cannot be absent and exempt'),{code:'MARK_FLAGS',status:400});
  const mark=payload.marksObtained==null?null:Number(payload.marksObtained); if(mark!=null&&(!Number.isFinite(mark)||mark<0||mark>Number(context.max_mark)))throw Object.assign(new Error('mark outside configured maximum'),{code:'MARK_RANGE',status:400});
  const prior=(await transaction.query(`SELECT * FROM exm_marks WHERE organization_id=$1 AND exam_id=$2 AND student_id=$3 AND subject_id=$4 FOR UPDATE`,[organizationId,examId,studentId,subjectId])).rows[0]??null;
  const percentage=mark==null||absent||exempt?null:(mark/Number(context.max_mark))*100;
  const bands=await transaction.query(`SELECT * FROM exm_grade_bands WHERE organization_id=$1 AND grading_scale_id=$2 ORDER BY sort_order,max_mark DESC`,[organizationId,context.grading_scale_id]); const band=selectGradeBand(percentage,bands.rows);
  const saved=(await transaction.query(`INSERT INTO exm_marks(id,organization_id,exam_id,exam_subject_id,student_id,class_id,subject_id,marks_obtained,is_absent,is_exempt,percentage,grade,grade_points,remarks,entered_by,entered_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now(),now()) ON CONFLICT(exam_id,student_id,subject_id) DO UPDATE SET exam_subject_id=EXCLUDED.exam_subject_id,class_id=EXCLUDED.class_id,marks_obtained=EXCLUDED.marks_obtained,is_absent=EXCLUDED.is_absent,is_exempt=EXCLUDED.is_exempt,percentage=EXCLUDED.percentage,grade=EXCLUDED.grade,grade_points=EXCLUDED.grade_points,remarks=EXCLUDED.remarks,entered_by=EXCLUDED.entered_by,entered_at=EXCLUDED.entered_at,updated_at=now() RETURNING *`,[prior?.id??payload.id??`mark_${randomUUID()}`,organizationId,examId,payload.examSubjectId,studentId,payload.classId,subjectId,mark,absent,exempt,percentage,band?.grade??null,band?.points??null,payload.remarks??null,userId])).rows[0];
  await transaction.query(`INSERT INTO exm_mark_audit(id,organization_id,mark_id,exam_id,student_id,subject_id,action,old_mark,new_mark,changed_by,changes_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[`audit_${randomUUID()}`,organizationId,saved.id,examId,studentId,subjectId,prior?'update':'insert',prior?.marks_obtained??null,saved.marks_obtained,userId,JSON.stringify({old:prior,new:saved})]);
  return {payload:{id:saved.id,examId:saved.exam_id,examSubjectId:saved.exam_subject_id,studentId:saved.student_id,classId:saved.class_id,subjectId:saved.subject_id,marksObtained:saved.marks_obtained,isAbsent:saved.is_absent,isExempt:saved.is_exempt,percentage:saved.percentage,grade:saved.grade,gradePoints:saved.grade_points,remarks:saved.remarks,enteredBy:saved.entered_by,enteredAt:saved.entered_at,updatedAt:saved.updated_at},result:{id:saved.id}};
}
