import type {MobileSession} from "../auth";
import {ledgerlyRequest,query,type SessionUpdater} from "../apiClient";
import {academicsOfflineFallback,offlineAcademicsOverview,offlineAcademicsSetup,offlineAvailability,offlineDeliveries,offlineInspections,offlineLessonPlan,offlineLessonPlans,offlineObservations,offlineRooms,offlineScheme,offlineSchemes,offlineTeacherAllocations,offlineTemplates,offlineTimetableChanges,offlineTimetableEntries,offlineTimetables,queueOfflineDeliveryUpdate,queueOfflineLessonPlan,queueOfflineLessonPlanUpdate,queueOfflineScheme,queueOfflineSchemeItem,queueOfflineSchemeItemUpdate} from "./offline";
import type {AcademicsOverview,AcademicsSetup,Delivery,Inspection,LessonPlan,Observation,Room,Scheme,TeacherAllocation,Timetable,TimetableEntry} from "./types";

type Client={session:MobileSession;onSession?:SessionUpdater};
const req=<T>(c:Client,path:string,init:RequestInit={})=>ledgerlyRequest<T>(c.session,`/academics${path}`,init,c.onSession);
const json=(method:string,body?:unknown):RequestInit=>({method,body:body===undefined?undefined:JSON.stringify(body)});
const list=<T>(c:Client,path:string,params:Record<string,string|number|boolean|undefined|null>={})=>req<T[]>(c,`${path}${query(params)}`);
const backendWeekday=(v:any)=>Number(v)===0?7:Number(v);
const normalizePlan=(x:any):LessonPlan=>({...x,lessonDate:x.lessonDate||x.lesson_date,academicYearId:x.academicYearId||x.academic_year_id,termId:x.termId||x.term_id,classId:x.classId||x.class_id,streamId:x.streamId||x.stream_id,subjectId:x.subjectId||x.subject_id,teacherUserId:x.teacherUserId||x.teacher_user_id,hodFeedback:x.hodFeedback||x.hod_feedback,lessonObjectives:x.lessonObjectives||x.lesson_objectives,priorKnowledge:x.priorKnowledge||x.prior_knowledge,introductionText:x.introductionText||x.introduction_text,lessonDevelopment:x.lessonDevelopment||x.lesson_development,teacherActivities:x.teacherActivities||x.teacher_activities,learnerActivities:x.learnerActivities||x.learner_activities,teachingMethods:x.teachingMethods||x.teaching_methods,requiredMaterials:x.requiredMaterials||x.required_materials,lessonAssessment:x.lessonAssessment||x.lesson_assessment,lessonConclusion:x.lessonConclusion||x.lesson_conclusion,teacherReflection:x.teacherReflection||x.teacher_reflection});
export const academicsApi={
 setup:(c:Client)=>academicsOfflineFallback(()=>req<AcademicsSetup>(c,"/setup"),offlineAcademicsSetup),
 overview:(c:Client)=>academicsOfflineFallback(()=>req<AcademicsOverview>(c,"/overview"),offlineAcademicsOverview),
 teacherAllocations:(c:Client)=>academicsOfflineFallback(()=>list<TeacherAllocation>(c,"/teacher-allocations"),offlineTeacherAllocations),
 createTeacherAllocation:(c:Client,body:any)=>req<any>(c,"/teacher-allocations",json("POST",body)),
 deleteTeacherAllocation:(c:Client,id:string)=>req<void>(c,`/teacher-allocations/${id}`,{method:"DELETE"}),
 rooms:(c:Client)=>academicsOfflineFallback(()=>list<Room>(c,"/rooms"),offlineRooms),
 createRoom:(c:Client,body:any)=>req<Room>(c,"/rooms",json("POST",body)),
 updateRoom:async(c:Client,id:string,body:any)=>{const current=(await list<Room>(c,"/rooms")).find(x=>x.id===id);return req<Room>(c,`/rooms/${id}`,json("PATCH",{...(current||{}),...body,id:undefined}))},
 availability:(c:Client,teacherUserId?:string)=>academicsOfflineFallback(()=>list<any>(c,"/teacher-availability",{teacherUserId}),()=>offlineAvailability(teacherUserId)),
 createAvailability:(c:Client,body:any)=>req<any>(c,"/teacher-availability",json("POST",body)),
 deleteAvailability:(c:Client,id:string)=>req<void>(c,`/teacher-availability/${id}`,{method:"DELETE"}),
 timetables:(c:Client)=>academicsOfflineFallback(()=>list<Timetable>(c,"/timetables"),offlineTimetables),
 createTimetable:(c:Client,body:any)=>req<Timetable>(c,"/timetables",json("POST",body)),
 timetableEntries:(c:Client,id:string)=>academicsOfflineFallback(async()=>(await list<TimetableEntry>(c,`/timetables/${id}/entries`)).map(x=>({...x,weekday:Number(x.weekday)===7?0:Number(x.weekday)})),()=>offlineTimetableEntries(id)),
 detectConflicts:(c:Client,id:string,body:any)=>req<{conflicts:any[]}>(c,`/timetables/${id}/conflicts`,json("POST",{...body,weekday:backendWeekday(body.weekday)})),
 createTimetableEntry:(c:Client,id:string,body:any)=>req<TimetableEntry>(c,`/timetables/${id}/entries`,json("POST",{...body,weekday:backendWeekday(body.weekday)})),
 deleteTimetableEntry:(c:Client,id:string)=>req<any>(c,`/timetable-entries/${id}`,{method:"DELETE"}),
 timetableWorkflow:(c:Client,id:string,action:string)=>req<any>(c,`/timetables/${id}/workflow`,json("POST",{action})),
 timetableChanges:(c:Client,id:string)=>academicsOfflineFallback(()=>list<any>(c,`/timetables/${id}/changes`),()=>offlineTimetableChanges(id)),
 temporaryChange:(c:Client,entryId:string,body:any)=>req<any>(c,`/timetable-entries/${entryId}/temporary-change`,json("POST",body)),
 createSubstitute:(c:Client,body:any)=>req<any>(c,"/substitutes",json("POST",body)),
 workload:(c:Client,id:string)=>list<any>(c,`/timetables/${id}/workload`),
 schemes:(c:Client)=>academicsOfflineFallback(()=>list<Scheme>(c,"/schemes"),offlineSchemes),
 createScheme:(c:Client,body:any)=>academicsOfflineFallback(()=>req<Scheme>(c,"/schemes",json("POST",body)),()=>queueOfflineScheme(body)),
 scheme:(c:Client,id:string)=>academicsOfflineFallback(async()=>{const[raw,rows]=await Promise.all([req<any>(c,`/schemes/${id}`),list<Scheme>(c,"/schemes")]);return{...(rows.find(x=>x.id===id)||{}),...raw,items:raw.items||[],versions:raw.versions||[]} as Scheme},()=>offlineScheme(id)),
 addSchemeItem:(c:Client,id:string,body:any)=>academicsOfflineFallback(()=>req<any>(c,`/schemes/${id}/items`,json("POST",body)),()=>queueOfflineSchemeItem(id,body)),
 updateSchemeItem:(c:Client,id:string,body:any)=>academicsOfflineFallback(()=>req<any>(c,`/scheme-items/${id}/mobile`,json("PATCH",body)),()=>queueOfflineSchemeItemUpdate(id,body)),
 schemeWorkflow:(c:Client,id:string,action:string,feedback?:string)=>req<any>(c,`/schemes/${id}/workflow`,json("POST",{action,feedback})),
 lessonPlanTemplates:(c:Client)=>academicsOfflineFallback(()=>list<any>(c,"/lesson-plan-templates"),offlineTemplates),
 createLessonPlanTemplate:(c:Client,body:any)=>req<any>(c,"/lesson-plan-templates",json("POST",body)),
 lessonPlans:(c:Client)=>academicsOfflineFallback(()=>list<LessonPlan>(c,"/lesson-plans"),offlineLessonPlans),
 createLessonPlan:(c:Client,body:any)=>academicsOfflineFallback(()=>req<LessonPlan>(c,"/lesson-plans",json("POST",body)),()=>queueOfflineLessonPlan(body)),
 lessonPlan:(c:Client,id:string)=>academicsOfflineFallback(async()=>{const[raw,rows]=await Promise.all([req<any>(c,`/lesson-plans/${id}`),list<LessonPlan>(c,"/lesson-plans")]);return{...(rows.find(x=>x.id===id)||{}),...normalizePlan(raw)} as LessonPlan},()=>offlineLessonPlan(id)),
 updateLessonPlan:(c:Client,id:string,body:any)=>academicsOfflineFallback(()=>req<LessonPlan>(c,`/lesson-plans/${id}`,json("PATCH",body)),()=>queueOfflineLessonPlanUpdate(id,body)),
 lessonWorkflow:(c:Client,id:string,action:string,feedback?:string)=>req<any>(c,`/lesson-plans/${id}/workflow`,json("POST",{action,feedback})),
 resubmitLessonPlan:(c:Client,id:string)=>req<any>(c,`/lesson-plans/${id}/resubmit`,json("POST",{})),
 deliveries:(c:Client,date?:string)=>academicsOfflineFallback(()=>list<Delivery>(c,"/deliveries",{date}),()=>offlineDeliveries(date)),
 syncDeliveries:(c:Client,timetableId:string,date:string)=>req<any>(c,"/deliveries/sync-timetable",json("POST",{timetableId,date})),
 updateDelivery:(c:Client,id:string,body:any)=>academicsOfflineFallback(()=>req<Delivery>(c,`/deliveries/${id}/mobile`,json("PATCH",body)),()=>queueOfflineDeliveryUpdate(id,body)),
 attachDeliveryFile:(c:Client,id:string,fileId:string,caption?:string)=>req<any>(c,`/deliveries/${id}/attachments`,json("POST",{fileId,caption})),
 observations:(c:Client)=>academicsOfflineFallback(()=>list<Observation>(c,"/observations"),offlineObservations),
 createObservation:(c:Client,body:any)=>req<Observation>(c,"/observations",json("POST",body)),
 updateObservation:(c:Client,id:string,body:any)=>req<Observation>(c,`/observations/${id}/mobile`,json("PATCH",body)),
 acknowledgeObservation:(c:Client,id:string,response?:string)=>req<any>(c,`/observations/${id}/acknowledge`,json("POST",{response})),
 attachObservationFile:(c:Client,id:string,fileId:string,caption?:string)=>req<any>(c,`/observations/${id}/attachments`,json("POST",{fileId,caption})),
 inspections:(c:Client)=>academicsOfflineFallback(()=>list<Inspection>(c,"/inspections"),offlineInspections),
 createInspection:(c:Client,body:any)=>req<Inspection>(c,"/inspections",json("POST",body)),
 updateInspection:(c:Client,id:string,body:any)=>req<Inspection>(c,`/inspections/${id}/mobile`,json("PATCH",body)),
 attachInspectionFile:(c:Client,id:string,fileId:string,caption?:string)=>req<any>(c,`/inspections/${id}/attachments`,json("POST",{fileId,caption})),
};
