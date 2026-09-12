const PREFIX='/api/v1/academics';

function fail(status,code,message,details){const e=new Error(message);e.status=status;e.code=code;if(details!==undefined)e.details=details;throw e;}
async function json(request,maxBytes){const chunks=[];let size=0;for await(const chunk of request){size+=chunk.length;if(size>maxBytes)fail(413,'SELFHOST_REQUEST_TOO_LARGE','Request body exceeds the configured limit.');chunks.push(chunk);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail(400,'INVALID_JSON','Request body must be valid JSON');}}
function req(value,label){const x=String(value??'').trim();if(!x)fail(422,'VALIDATION_ERROR',`${label} is required`);return x;}
function scopes(principal){return Array.isArray(principal?.scopes)?principal.scopes:[];}
function direct(principal,permission){if(principal.role==='owner'||principal.role==='admin')return true;const s=scopes(principal);if(s.includes('*')||s.includes('school:*')||s.includes(permission))return true;if(permission==='school:read')return s.includes('school:read')||s.includes('school:write');if(permission==='school:write')return s.includes('school:write');if(permission==='school.academics:read')return s.includes('school.academics:read')||s.includes('school.academics:write')||s.includes('school.academics:approve')||s.includes('school.academics:supervise');if(permission==='school.academics:write')return s.includes('school.academics:write');return false;}
async function requirePermission(runtime,principal,permission){if(direct(principal,permission))return;const r=await runtime.services.database.query(`SELECT 1 FROM school_user_roles ur JOIN school_role_permissions rp ON rp.organization_id=ur.organization_id AND rp.role_id=ur.role_id WHERE ur.organization_id=$1 AND ur.user_id=$2 AND rp.permission=$3 AND rp.effect='allow' AND (ur.starts_at IS NULL OR ur.starts_at<=CURRENT_TIMESTAMP) AND (ur.ends_at IS NULL OR ur.ends_at>=CURRENT_TIMESTAMP) UNION ALL SELECT 1 FROM school_temporary_permissions tp WHERE tp.organization_id=$1 AND tp.user_id=$2 AND tp.permission=$3 AND tp.revoked_at IS NULL AND tp.starts_at<=CURRENT_TIMESTAMP AND tp.ends_at>=CURRENT_TIMESTAMP LIMIT 1`,[principal.organizationId,principal.userId,permission]);if(!r.rows[0])fail(403,'FORBIDDEN',`Missing school permission: ${permission}`);}
async function readAccess(runtime,p){await requirePermission(runtime,p,'school:read');await requirePermission(runtime,p,'school.academics:read');}
async function writeAccess(runtime,p){await requirePermission(runtime,p,'school:write');await requirePermission(runtime,p,'school.academics:write');}
async function approveAccess(runtime,p){await requirePermission(runtime,p,'school:write');await requirePermission(runtime,p,'school.academics:approve');}
async function superviseAccess(runtime,p){await requirePermission(runtime,p,'school:write');await requirePermission(runtime,p,'school.academics:supervise');}
function suffixOf(url){return url.pathname.slice(PREFIX.length).replace(/^\/+|\/+$/g,'');}
function decode(value){return decodeURIComponent(value);}

export default{
  name:'academics-api',prefix:PREFIX,business:true,
  enabled(config){return config.extensions?.academics?.enabled===true;},
  async handle({request,url,requestId,runtime,config}){
    const principal=await runtime.auth.authenticateRequest({headers:request.headers});
    const service=runtime.extensions?.academics?.api;if(!service)fail(503,'ACADEMICS_NOT_READY','Academics self-hosted API is unavailable');
    await service.requireEnabled(principal.organizationId);
    const suffix=suffixOf(url),ctx={organizationId:principal.organizationId,userId:principal.userId,requestId};

    if(request.method==='GET'&&suffix==='manifest'){await readAccess(runtime,principal);return{status:200,body:{data:service.manifest()}};}
    if(request.method==='GET'&&suffix==='setup'){await readAccess(runtime,principal);return{status:200,body:{data:await service.setup(principal.organizationId)}};}
    if(request.method==='GET'&&suffix==='overview'){await readAccess(runtime,principal);return{status:200,body:{data:await service.overview(principal.organizationId)}};}

    if(request.method==='GET'&&suffix==='teacher-allocations'){await readAccess(runtime,principal);return{status:200,body:{data:await service.listTeacherAllocations(principal.organizationId)}};}
    if(request.method==='POST'&&suffix==='teacher-allocations'){await writeAccess(runtime,principal);const input=await json(request,config.http.maxRequestBodyBytes);return{status:201,body:{data:await service.createTeacherAllocation({...ctx,input})}};}
    let match=suffix.match(/^teacher-allocations\/([^/]+)$/);
    if(request.method==='DELETE'&&match){await writeAccess(runtime,principal);await service.deleteTeacherAllocation({...ctx,id:decode(match[1])});return{status:204,body:null};}

    if(request.method==='GET'&&suffix==='rooms'){await readAccess(runtime,principal);return{status:200,body:{data:await service.listRooms(principal.organizationId)}};}
    if(request.method==='POST'&&suffix==='rooms'){await writeAccess(runtime,principal);return{status:201,body:{data:await service.createRoom({...ctx,input:await json(request,config.http.maxRequestBodyBytes)})}};}
    match=suffix.match(/^rooms\/([^/]+)$/);
    if(request.method==='PATCH'&&match){await writeAccess(runtime,principal);return{status:200,body:{data:await service.updateRoom({...ctx,id:decode(match[1]),input:await json(request,config.http.maxRequestBodyBytes)})}};}

    if(request.method==='GET'&&suffix==='teacher-availability'){await readAccess(runtime,principal);return{status:200,body:{data:await service.listAvailability({organizationId:principal.organizationId,teacherUserId:url.searchParams.get('teacherUserId')})}};}
    if(request.method==='POST'&&suffix==='teacher-availability'){await writeAccess(runtime,principal);return{status:201,body:{data:await service.createAvailability({...ctx,input:await json(request,config.http.maxRequestBodyBytes)})}};}
    match=suffix.match(/^teacher-availability\/([^/]+)$/);
    if(request.method==='DELETE'&&match){await writeAccess(runtime,principal);await service.deleteAvailability({...ctx,id:decode(match[1])});return{status:204,body:null};}

    if(request.method==='GET'&&suffix==='timetables'){await readAccess(runtime,principal);return{status:200,body:{data:await service.listTimetables(principal.organizationId)}};}
    if(request.method==='POST'&&suffix==='timetables'){await writeAccess(runtime,principal);return{status:201,body:{data:await service.createTimetable({...ctx,input:await json(request,config.http.maxRequestBodyBytes)})}};}
    match=suffix.match(/^timetables\/([^/]+)\/entries$/);
    if(request.method==='GET'&&match){await readAccess(runtime,principal);return{status:200,body:{data:await service.timetableEntries({organizationId:principal.organizationId,timetableId:decode(match[1])})}};}
    if(request.method==='POST'&&match){await writeAccess(runtime,principal);return{status:201,body:{data:await service.createTimetableEntry({...ctx,timetableId:decode(match[1]),input:await json(request,config.http.maxRequestBodyBytes)})}};}
    match=suffix.match(/^timetables\/([^/]+)\/conflicts$/);
    if(request.method==='POST'&&match){await writeAccess(runtime,principal);const input=await json(request,config.http.maxRequestBodyBytes);return{status:200,body:{data:{conflicts:await service.detectConflicts({organizationId:principal.organizationId,timetableId:decode(match[1]),input})}}};}
    match=suffix.match(/^timetables\/([^/]+)\/workflow$/);
    if(request.method==='POST'&&match){await approveAccess(runtime,principal);const input=await json(request,config.http.maxRequestBodyBytes);return{status:200,body:{data:await service.timetableWorkflow({...ctx,id:decode(match[1]),action:req(input.action,'Action')})}};}
    match=suffix.match(/^timetables\/([^/]+)\/changes$/);
    if(request.method==='GET'&&match){await readAccess(runtime,principal);return{status:200,body:{data:await service.timetableChanges({organizationId:principal.organizationId,timetableId:decode(match[1])})}};}
    match=suffix.match(/^timetables\/([^/]+)\/workload$/);
    if(request.method==='GET'&&match){await readAccess(runtime,principal);return{status:200,body:{data:await service.workload({organizationId:principal.organizationId,timetableId:decode(match[1])})}};}
    match=suffix.match(/^timetable-entries\/([^/]+)$/);
    if(request.method==='DELETE'&&match){await writeAccess(runtime,principal);return{status:200,body:{data:await service.deleteTimetableEntry({...ctx,id:decode(match[1])})}};}
    match=suffix.match(/^timetable-entries\/([^/]+)\/temporary-change$/);
    if(request.method==='POST'&&match){await writeAccess(runtime,principal);return{status:201,body:{data:await service.createTemporaryChange({...ctx,entryId:decode(match[1]),input:await json(request,config.http.maxRequestBodyBytes)})}};}
    if(request.method==='POST'&&suffix==='substitutes'){await writeAccess(runtime,principal);return{status:201,body:{data:await service.createSubstitute({...ctx,input:await json(request,config.http.maxRequestBodyBytes)})}};}

    if(request.method==='GET'&&suffix==='schemes'){await readAccess(runtime,principal);return{status:200,body:{data:await service.listSchemes(principal.organizationId)}};}
    if(request.method==='POST'&&suffix==='schemes'){await writeAccess(runtime,principal);return{status:201,body:{data:await service.createScheme({...ctx,input:await json(request,config.http.maxRequestBodyBytes)})}};}
    match=suffix.match(/^schemes\/([^/]+)$/);
    if(request.method==='GET'&&match){await readAccess(runtime,principal);return{status:200,body:{data:await service.schemeDetail({organizationId:principal.organizationId,id:decode(match[1])})}};}
    match=suffix.match(/^schemes\/([^/]+)\/items$/);
    if(request.method==='POST'&&match){await writeAccess(runtime,principal);return{status:201,body:{data:await service.addSchemeItem({...ctx,schemeId:decode(match[1]),input:await json(request,config.http.maxRequestBodyBytes)})}};}
    match=suffix.match(/^scheme-items\/([^/]+)$/);
    if(request.method==='PATCH'&&match){await writeAccess(runtime,principal);return{status:200,body:{data:await service.updateSchemeItem({...ctx,id:decode(match[1]),input:await json(request,config.http.maxRequestBodyBytes)})}};}
    match=suffix.match(/^scheme-items\/([^/]+)\/mobile$/);
    if(request.method==='PATCH'&&match){await writeAccess(runtime,principal);const entityId=decode(match[1]),old=await service.owned('acad_scheme_items',entityId,principal.organizationId,'Scheme item'),input=await json(request,config.http.maxRequestBodyBytes);return{status:200,body:{data:await service.updateSchemeItem({...ctx,id:entityId,input:{weekNo:old.week_no,lessonNo:old.lesson_no,topic:old.topic,subtopic:old.subtopic,learningObjectives:old.learning_objectives,competencies:old.competencies,teachingMethods:old.teaching_methods,learningMaterials:old.learning_materials,referencesText:old.references_text,plannedActivities:old.planned_activities,assessmentActivities:old.assessment_activities,plannedDate:old.planned_date,coverageStatus:old.coverage_status,teacherReflection:old.teacher_reflection,...input}})}};}
    match=suffix.match(/^schemes\/([^/]+)\/workflow$/);
    if(request.method==='POST'&&match){await approveAccess(runtime,principal);const input=await json(request,config.http.maxRequestBodyBytes);return{status:200,body:{data:await service.schemeWorkflow({...ctx,id:decode(match[1]),action:req(input.action,'Action'),feedback:input.feedback})}};}

    if(request.method==='GET'&&suffix==='lesson-plan-templates'){await readAccess(runtime,principal);return{status:200,body:{data:await service.listTemplates(principal.organizationId)}};}
    if(request.method==='POST'&&suffix==='lesson-plan-templates'){await writeAccess(runtime,principal);return{status:201,body:{data:await service.createTemplate({...ctx,input:await json(request,config.http.maxRequestBodyBytes)})}};}
    if(request.method==='GET'&&suffix==='lesson-plans'){await readAccess(runtime,principal);return{status:200,body:{data:await service.listLessonPlans(principal.organizationId)}};}
    if(request.method==='POST'&&suffix==='lesson-plans'){await writeAccess(runtime,principal);return{status:201,body:{data:await service.createLessonPlan({...ctx,input:await json(request,config.http.maxRequestBodyBytes)})}};}
    match=suffix.match(/^lesson-plans\/([^/]+)$/);
    if(request.method==='GET'&&match){await readAccess(runtime,principal);return{status:200,body:{data:await service.lessonPlanDetail({organizationId:principal.organizationId,id:decode(match[1])})}};}
    if(request.method==='PATCH'&&match){await writeAccess(runtime,principal);return{status:200,body:{data:await service.updateLessonPlan({...ctx,id:decode(match[1]),input:await json(request,config.http.maxRequestBodyBytes)})}};}
    match=suffix.match(/^lesson-plans\/([^/]+)\/workflow$/);
    if(request.method==='POST'&&match){await approveAccess(runtime,principal);const input=await json(request,config.http.maxRequestBodyBytes);return{status:200,body:{data:await service.lessonWorkflow({...ctx,id:decode(match[1]),action:req(input.action,'Action'),feedback:input.feedback})}};}
    match=suffix.match(/^lesson-plans\/([^/]+)\/resubmit$/);
    if(request.method==='POST'&&match){await writeAccess(runtime,principal);return{status:200,body:{data:await service.resubmitLessonPlan({...ctx,id:decode(match[1])})}};}

    if(request.method==='GET'&&suffix==='deliveries'){await readAccess(runtime,principal);return{status:200,body:{data:await service.listDeliveries({organizationId:principal.organizationId,date:url.searchParams.get('date')})}};}
    if(request.method==='POST'&&suffix==='deliveries/sync-timetable'){await writeAccess(runtime,principal);const input=await json(request,config.http.maxRequestBodyBytes);return{status:200,body:{data:await service.syncDeliveriesFromTimetable({...ctx,timetableId:req(input.timetableId,'Timetable'),scheduledDate:req(input.date,'Date')})}};}
    match=suffix.match(/^deliveries\/([^/]+)$/);
    if(request.method==='PATCH'&&match){await writeAccess(runtime,principal);return{status:200,body:{data:await service.updateDelivery({...ctx,id:decode(match[1]),input:await json(request,config.http.maxRequestBodyBytes)})}};}
    match=suffix.match(/^deliveries\/([^/]+)\/mobile$/);
    if(request.method==='PATCH'&&match){await writeAccess(runtime,principal);const entityId=decode(match[1]),old=await service.owned('acad_lesson_deliveries',entityId,principal.organizationId,'Lesson delivery'),input=await json(request,config.http.maxRequestBodyBytes);return{status:200,body:{data:await service.updateDelivery({...ctx,id:entityId,input:{lessonPlanId:old.lesson_plan_id,substituteTeacherUserId:old.substitute_teacher_user_id,attendanceSessionId:old.canonical_attendance_session_id,actualStartsAt:old.actual_starts_at,actualEndsAt:old.actual_ends_at,deliveryStatus:old.delivery_status,actualTopic:old.actual_topic,actualSubtopic:old.actual_subtopic,studentAttendanceSummary:old.student_attendance_summary,lessonNotes:old.lesson_notes,missedReason:old.missed_reason,recoveryDate:old.recovery_date,...input}})}};}
    match=suffix.match(/^deliveries\/([^/]+)\/attachments$/);
    if(request.method==='POST'&&match){await writeAccess(runtime,principal);const input=await json(request,config.http.maxRequestBodyBytes);return{status:201,body:{data:await service.attachFile({...ctx,kind:'delivery',entityId:decode(match[1]),fileId:req(input.fileId,'File'),caption:input.caption})}};}

    if(request.method==='GET'&&suffix==='observations'){await readAccess(runtime,principal);return{status:200,body:{data:await service.listObservations(principal.organizationId)}};}
    if(request.method==='POST'&&suffix==='observations'){await superviseAccess(runtime,principal);return{status:201,body:{data:await service.createObservation({...ctx,input:await json(request,config.http.maxRequestBodyBytes)})}};}
    match=suffix.match(/^observations\/([^/]+)$/);
    if(request.method==='PATCH'&&match){await superviseAccess(runtime,principal);return{status:200,body:{data:await service.updateObservation({...ctx,id:decode(match[1]),input:await json(request,config.http.maxRequestBodyBytes)})}};}
    match=suffix.match(/^observations\/([^/]+)\/mobile$/);
    if(request.method==='PATCH'&&match){await superviseAccess(runtime,principal);const entityId=decode(match[1]),old=await service.owned('acad_observations',entityId,principal.organizationId,'Observation'),input=await json(request,config.http.maxRequestBodyBytes);return{status:200,body:{data:await service.updateObservation({...ctx,id:entityId,input:{observedAt:old.observed_at,status:old.status,rubric:old.rubric_json?JSON.parse(old.rubric_json):{},preparationScore:old.preparation_score,teachingMethodsScore:old.teaching_methods_score,classroomManagementScore:old.classroom_management_score,learnerParticipationScore:old.learner_participation_score,materialsUseScore:old.materials_use_score,timeManagementScore:old.time_management_score,strengths:old.strengths,areasForImprovement:old.areas_for_improvement,recommendations:old.recommendations,confidentialNotes:old.confidential_notes,teacherResponse:old.teacher_response,followupDate:old.followup_date,...input}})}};}
    match=suffix.match(/^observations\/([^/]+)\/acknowledge$/);
    if(request.method==='POST'&&match){await writeAccess(runtime,principal);const input=await json(request,config.http.maxRequestBodyBytes);return{status:200,body:{data:await service.acknowledgeObservation({...ctx,id:decode(match[1]),response:input.response})}};}
    match=suffix.match(/^observations\/([^/]+)\/attachments$/);
    if(request.method==='POST'&&match){await superviseAccess(runtime,principal);const input=await json(request,config.http.maxRequestBodyBytes);return{status:201,body:{data:await service.attachFile({...ctx,kind:'observation',entityId:decode(match[1]),fileId:req(input.fileId,'File'),caption:input.caption})}};}

    if(request.method==='GET'&&suffix==='inspections'){await readAccess(runtime,principal);return{status:200,body:{data:await service.listInspections(principal.organizationId)}};}
    if(request.method==='POST'&&suffix==='inspections'){await superviseAccess(runtime,principal);return{status:201,body:{data:await service.createInspection({...ctx,input:await json(request,config.http.maxRequestBodyBytes)})}};}
    match=suffix.match(/^inspections\/([^/]+)$/);
    if(request.method==='PATCH'&&match){await superviseAccess(runtime,principal);return{status:200,body:{data:await service.updateInspection({...ctx,id:decode(match[1]),input:await json(request,config.http.maxRequestBodyBytes)})}};}
    match=suffix.match(/^inspections\/([^/]+)\/mobile$/);
    if(request.method==='PATCH'&&match){await superviseAccess(runtime,principal);const entityId=decode(match[1]),old=await service.owned('acad_inspections',entityId,principal.organizationId,'Inspection'),input=await json(request,config.http.maxRequestBodyBytes);return{status:200,body:{data:await service.updateInspection({...ctx,id:entityId,input:{status:old.status,quantityOfWork:old.quantity_of_work,qualityOfMarking:old.quality_of_marking,correctionFeedbackChecks:old.correction_feedback_checks,dateOfLastMarking:old.date_of_last_marking,findings:old.findings,recommendations:old.recommendations,teacherResponse:old.teacher_response,followupDate:old.followup_date,confidentialNotes:old.confidential_notes,...input}})}};}
    match=suffix.match(/^inspections\/([^/]+)\/attachments$/);
    if(request.method==='POST'&&match){await superviseAccess(runtime,principal);const input=await json(request,config.http.maxRequestBodyBytes);return{status:201,body:{data:await service.attachFile({...ctx,kind:'inspection',entityId:decode(match[1]),fileId:req(input.fileId,'File'),caption:input.caption})}};}

    fail(404,'ACADEMICS_ROUTE_NOT_FOUND','Academics route not found');
  }
};
