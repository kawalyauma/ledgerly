import { PostgresAcademicsService } from './service.mjs';

function text(value){if(value==null)return null;const v=String(value).trim();return v||null;}
function camel(row){if(!row||typeof row!=='object')return row;const out={};for(const[k,v]of Object.entries(row)){const n=k.replace(/_([a-z])/g,(_,c)=>c.toUpperCase());if(k.endsWith('_json')){try{out[n.replace(/Json$/,'')]=typeof v==='string'?JSON.parse(v):v??{};}catch{out[n.replace(/Json$/,'')]={};}}else out[n]=v;}return out;}
function fail(status,code,message){const e=new Error(message);e.status=status;e.code=code;throw e;}

// Keep these action names/statuses identical to the Cloudflare Academics service and web UI.
// The explicit HOD-approved stage is important because DOS submission is a separate control step.
export const ACADEMICS_SCHEME_TRANSITIONS=Object.freeze({
  submit_hod:Object.freeze({from:Object.freeze(['draft','rejected']),to:'submitted_hod'}),
  hod_approve:Object.freeze({from:Object.freeze(['submitted_hod']),to:'hod_approved'}),
  submit_dos:Object.freeze({from:Object.freeze(['hod_approved']),to:'submitted_dos'}),
  dos_approve:Object.freeze({from:Object.freeze(['submitted_dos']),to:'approved'}),
  reject:Object.freeze({from:Object.freeze(['submitted_hod','submitted_dos']),to:'rejected'}),
});

export class PostgresAcademicsParityService extends PostgresAcademicsService{
  manifest(){return{...super.manifest(),examsIncluded:false};}

  async schemeWorkflow({organizationId,userId,id:schemeId,action,feedback=null,requestId=null}){
    const s=await this.owned('acad_schemes',schemeId,organizationId,'Scheme of work');
    const x=ACADEMICS_SCHEME_TRANSITIONS[action];
    if(!x||!x.from.includes(s.status))fail(409,'INVALID_STATUS',`Cannot ${action} this scheme from ${s.status}.`);
    let sql='UPDATE acad_schemes SET status=$1,updated_at=now()',vals=[x.to];
    if(action==='hod_approve'){vals.push(text(feedback),userId);sql+=',hod_feedback=$2,hod_reviewed_by=$3,hod_reviewed_at=now()';}
    else if(action==='dos_approve'){vals.push(text(feedback),userId);sql+=',dos_feedback=$2,dos_approved_by=$3,dos_approved_at=now()';}
    else if(action==='reject'){vals.push(text(feedback));sql+=s.status==='submitted_hod'?',hod_feedback=$2':',dos_feedback=$2';}
    vals.push(schemeId,organizationId);sql+=` WHERE id=$${vals.length-1} AND organization_id=$${vals.length}`;
    await this.database.query(sql,vals);
    await this.database.query('UPDATE acad_schemes SET version_no=version_no+1,updated_at=now() WHERE id=$1 AND organization_id=$2',[schemeId,organizationId]);
    await this.snapshotScheme({organizationId,schemeId,userId,changeNote:`${action}${feedback?`: ${feedback}`:''}`});
    await this.auditEvent({organizationId,actorId:userId,action:`academics.scheme.${action}`,entityType:'scheme',entityId:schemeId,details:{feedback},requestId});
    return this.schemeDetail({organizationId,id:schemeId});
  }

  async updateDelivery({organizationId,userId,id:deliveryId,input,requestId=null}){
    const old=await this.owned('acad_lesson_deliveries',deliveryId,organizationId,'Lesson delivery'),d=input??{};
    const planId=text(d.lessonPlanId??old.lesson_plan_id);
    await this.database.query(`UPDATE acad_lesson_deliveries SET lesson_plan_id=$1,substitute_teacher_user_id=$2,canonical_attendance_session_id=$3,actual_starts_at=$4,actual_ends_at=$5,delivery_status=coalesce($6,delivery_status),actual_topic=$7,actual_subtopic=$8,student_attendance_summary=$9,lesson_notes=$10,missed_reason=$11,recovery_date=$12,updated_at=now() WHERE id=$13 AND organization_id=$14`,[planId,text(d.substituteTeacherUserId??old.substitute_teacher_user_id),text(d.attendanceSessionId??d.canonicalAttendanceSessionId??old.canonical_attendance_session_id),text(d.actualStartsAt??old.actual_starts_at),text(d.actualEndsAt??old.actual_ends_at),text(d.deliveryStatus),text(d.actualTopic??old.actual_topic),text(d.actualSubtopic??old.actual_subtopic),text(d.studentAttendanceSummary??old.student_attendance_summary),text(d.lessonNotes??old.lesson_notes),text(d.missedReason??old.missed_reason),text(d.recoveryDate??old.recovery_date),deliveryId,organizationId]);
    if(d.deliveryStatus==='taught'&&planId){
      await this.database.query("UPDATE acad_lesson_plans SET status='delivered',updated_at=now() WHERE id=$1 AND organization_id=$2",[planId,organizationId]);
      const item=await this.database.query(`SELECT si.id,si.scheme_id FROM acad_lesson_plans lp JOIN acad_scheme_items si ON si.id=lp.scheme_item_id AND si.organization_id=lp.organization_id WHERE lp.id=$1 AND lp.organization_id=$2 LIMIT 1`,[planId,organizationId]);
      if(item.rows[0]){await this.database.query("UPDATE acad_scheme_items SET coverage_status='covered',covered_at=coalesce(covered_at,now()),updated_at=now() WHERE id=$1 AND organization_id=$2",[item.rows[0].id,organizationId]);await this.recalcCoverage(organizationId,item.rows[0].scheme_id);}
    }
    await this.auditEvent({organizationId,actorId:userId,action:'academics.delivery.updated',entityType:'lesson_delivery',entityId:deliveryId,details:d,requestId});
    return camel(await this.owned('acad_lesson_deliveries',deliveryId,organizationId,'Lesson delivery'));
  }
}

export function createAcademicsParityService(options){return new PostgresAcademicsParityService(options);}
