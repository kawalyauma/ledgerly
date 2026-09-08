// @ts-nocheck
import {Hono} from "hono";
import type {AppVariables,Env} from "../../../src/types";
import {requireScope} from "../../../src/lib/auth";
import {requireModuleEnabled} from "../../../src/lib/modules";
import {AppError} from "../../../src/lib/errors";
import {schoolPermission} from "../../school/backend/common";
import * as S from "./service";

export const academicsMobileSafeRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
academicsMobileSafeRoutes.use("*",requireModuleEnabled("school-management"));
academicsMobileSafeRoutes.use("*",requireModuleEnabled("academics"));
academicsMobileSafeRoutes.use("*",requireScope("school:read"));
const body=(c:any)=>c.req.json<Record<string,any>>().catch(()=>({}));
const row=async(c:any,table:string,id:string,label:string)=>{const p=c.get("principal"),x=await c.env.FINANCE_DB.prepare(`SELECT * FROM ${table} WHERE id=? AND organization_id=?`).bind(id,p.organizationId).first<any>();if(!x)throw new AppError(404,"NOT_FOUND",`${label} not found`);return x};
const parse=(v:any)=>{if(!v)return{};try{return JSON.parse(String(v))}catch{return{}}};

academicsMobileSafeRoutes.patch("/scheme-items/:id/mobile",requireScope("school:write"),schoolPermission("school.academics:write"),async c=>{const p=c.get("principal"),id=c.req.param("id"),x=await row(c,"acad_scheme_items",id,"Scheme item"),d=await body(c);return c.json({data:await S.updateSchemeItem(c.env.FINANCE_DB,p.organizationId,id,{weekNo:x.week_no,lessonNo:x.lesson_no,topic:x.topic,subtopic:x.subtopic,learningObjectives:x.learning_objectives,competencies:x.competencies,teachingMethods:x.teaching_methods,learningMaterials:x.learning_materials,referencesText:x.references_text,plannedActivities:x.planned_activities,assessmentActivities:x.assessment_activities,plannedDate:x.planned_date,coverageStatus:x.coverage_status,teacherReflection:x.teacher_reflection,...d})})});

academicsMobileSafeRoutes.patch("/deliveries/:id/mobile",requireScope("school:write"),schoolPermission("school.academics:write"),async c=>{const p=c.get("principal"),id=c.req.param("id"),x=await row(c,"acad_lesson_deliveries",id,"Lesson delivery"),d=await body(c);return c.json({data:await S.updateDelivery(c.env.FINANCE_DB,p.organizationId,id,{lessonPlanId:x.lesson_plan_id,substituteTeacherUserId:x.substitute_teacher_user_id,attendanceSessionId:x.canonical_attendance_session_id,actualStartsAt:x.actual_starts_at,actualEndsAt:x.actual_ends_at,deliveryStatus:x.delivery_status,actualTopic:x.actual_topic,actualSubtopic:x.actual_subtopic,studentAttendanceSummary:x.student_attendance_summary,lessonNotes:x.lesson_notes,missedReason:x.missed_reason,recoveryDate:x.recovery_date,...d})})});

academicsMobileSafeRoutes.patch("/observations/:id/mobile",requireScope("school:write"),schoolPermission("school.academics:supervise"),async c=>{const p=c.get("principal"),id=c.req.param("id"),x=await row(c,"acad_observations",id,"Observation"),d=await body(c);return c.json({data:await S.updateObservation(c.env.FINANCE_DB,p.organizationId,id,{observedAt:x.observed_at,status:x.status,rubric:parse(x.rubric_json),preparationScore:x.preparation_score,teachingMethodsScore:x.teaching_methods_score,classroomManagementScore:x.classroom_management_score,learnerParticipationScore:x.learner_participation_score,materialsUseScore:x.materials_use_score,timeManagementScore:x.time_management_score,strengths:x.strengths,areasForImprovement:x.areas_for_improvement,recommendations:x.recommendations,confidentialNotes:x.confidential_notes,teacherResponse:x.teacher_response,followupDate:x.followup_date,...d})})});

academicsMobileSafeRoutes.patch("/inspections/:id/mobile",requireScope("school:write"),schoolPermission("school.academics:supervise"),async c=>{const p=c.get("principal"),id=c.req.param("id"),x=await row(c,"acad_inspections",id,"Inspection"),d=await body(c);return c.json({data:await S.updateInspection(c.env.FINANCE_DB,p.organizationId,id,{status:x.status,quantityOfWork:x.quantity_of_work,qualityOfMarking:x.quality_of_marking,correctionFeedbackChecks:x.correction_feedback_checks,dateOfLastMarking:x.date_of_last_marking,findings:x.findings,recommendations:x.recommendations,teacherResponse:x.teacher_response,followupDate:x.followup_date,confidentialNotes:x.confidential_notes,...d})})});
