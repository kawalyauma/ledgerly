import { Hono } from "hono";
import { z } from "zod";
import type { AppVariables, Env } from "../../../src/types";
import { requireScope } from "../../../src/lib/auth";
import { AppError } from "../../../src/lib/errors";
import { createId } from "../../../src/lib/ids";
import { audit, camelizeRow, camelizeRows, date, parseLimit, parseOffset, schoolPermission } from "./common";

export const schoolPromotionRoutes = new Hono<{Bindings:Env;Variables:AppVariables}>();
schoolPromotionRoutes.use("*", requireScope("school:read"));

type RuleRow = {
  id:string; class_level_id:string|null; name:string; minimum_average:number|null; maximum_failed_subjects:number|null;
  minimum_attendance_percent:number|null; target_class_level_id:string|null; allow_manual_override:number; rule_json:string;
};
type LevelRow = {id:string;name:string;code:string;sequence_no:number;promotion_level_id:string|null;terminal:number};
type ClassRow = {id:string;class_level_id:string;campus_id:string|null;code:string;name:string};
type StreamRow = {id:string;class_id:string;code:string;name:string};
type Metrics = {averagePercent:number|null;failedSubjects:number|null;attendancePercent:number|null};

type Recommendation = {
  decision:"promoted"|"repeated"|"graduated"|"review";
  reason:string;
  targetLevelId:string|null;
  targetClassId:string|null;
  targetStreamId:string|null;
  ruleSnapshot:Record<string,unknown>;
};

function num(v:unknown):number|null { return v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v); }
function ruleSnapshot(rule:RuleRow|undefined, metrics:Metrics) {
  return rule ? {
    id:rule.id,name:rule.name,minimumAverage:rule.minimum_average,maximumFailedSubjects:rule.maximum_failed_subjects,
    minimumAttendancePercent:rule.minimum_attendance_percent,targetClassLevelId:rule.target_class_level_id,
    allowManualOverride:Boolean(rule.allow_manual_override),additional:JSON.parse(rule.rule_json||"{}"),metrics
  } : {name:"No active rule",allowManualOverride:true,metrics};
}

function pickClass(classes:ClassRow[], levelId:string|null, campusId:string|null, preferredCode?:string|null) {
  if (!levelId) return null;
  const candidates=classes.filter(x=>x.class_level_id===levelId);
  return candidates.find(x=>preferredCode&&x.code===preferredCode&&(!campusId||x.campus_id===campusId))
    || candidates.find(x=>!campusId||x.campus_id===campusId)
    || candidates[0] || null;
}
function pickStream(streams:StreamRow[], classId:string|null, preferredCode?:string|null) {
  if(!classId)return null;
  const candidates=streams.filter(x=>x.class_id===classId);
  return candidates.find(x=>preferredCode&&x.code===preferredCode)||candidates[0]||null;
}
function recommend(opts:{level:LevelRow|null;rule?:RuleRow;metrics:Metrics;classes:ClassRow[];streams:StreamRow[];campusId:string|null;sourceClassCode:string|null;sourceStreamCode:string|null;levels:LevelRow[]}):Recommendation {
  const {level,rule,metrics,classes,streams,campusId,sourceClassCode,sourceStreamCode,levels}=opts;
  const snapshot=ruleSnapshot(rule,metrics);
  if(!level)return{decision:"review",reason:"Current class level is missing; choose the decision and target manually.",targetLevelId:null,targetClassId:null,targetStreamId:null,ruleSnapshot:snapshot};
  if(Boolean(level.terminal))return{decision:"graduated",reason:`${level.name} is marked as a terminal class.`,targetLevelId:null,targetClassId:null,targetStreamId:null,ruleSnapshot:snapshot};

  const targetLevelId=rule?.target_class_level_id||level.promotion_level_id||levels.find(x=>x.sequence_no>level.sequence_no)?.id||null;
  if(!targetLevelId)return{decision:"graduated",reason:"No higher class level is configured, so the learner is recommended for graduation.",targetLevelId:null,targetClassId:null,targetStreamId:null,ruleSnapshot:snapshot};

  const required:string[]=[];
  if(rule?.minimum_average!=null&&metrics.averagePercent==null)required.push("average");
  if(rule?.maximum_failed_subjects!=null&&metrics.failedSubjects==null)required.push("failed subjects");
  if(rule?.minimum_attendance_percent!=null&&metrics.attendancePercent==null)required.push("attendance");
  if(required.length){
    const target=pickClass(classes,targetLevelId,campusId,null),stream=pickStream(streams,target?.id||null,sourceStreamCode);
    return{decision:"review",reason:`Enter ${required.join(", ")} to evaluate ${rule?.name||"the promotion rule"}.`,targetLevelId,targetClassId:target?.id||null,targetStreamId:stream?.id||null,ruleSnapshot:snapshot};
  }

  const failures:string[]=[];
  if(rule?.minimum_average!=null&&Number(metrics.averagePercent)<Number(rule.minimum_average))failures.push(`average below ${rule.minimum_average}%`);
  if(rule?.maximum_failed_subjects!=null&&Number(metrics.failedSubjects)>Number(rule.maximum_failed_subjects))failures.push(`failed subjects above ${rule.maximum_failed_subjects}`);
  if(rule?.minimum_attendance_percent!=null&&Number(metrics.attendancePercent)<Number(rule.minimum_attendance_percent))failures.push(`attendance below ${rule.minimum_attendance_percent}%`);
  if(failures.length){
    const repeat=pickClass(classes,level.id,campusId,sourceClassCode),stream=pickStream(streams,repeat?.id||null,sourceStreamCode);
    return{decision:"repeated",reason:`Rule recommends repetition: ${failures.join("; ")}.`,targetLevelId:level.id,targetClassId:repeat?.id||null,targetStreamId:stream?.id||null,ruleSnapshot:snapshot};
  }
  const target=pickClass(classes,targetLevelId,campusId,null),stream=pickStream(streams,target?.id||null,sourceStreamCode);
  if(!target)return{decision:"review",reason:"Promotion rule passed, but the target class has not been created in the destination academic year.",targetLevelId,targetClassId:null,targetStreamId:null,ruleSnapshot:snapshot};
  return{decision:"promoted",reason:rule?`Passed promotion rule: ${rule.name}.`:"No active promotion thresholds; promoted to the configured next class level.",targetLevelId,targetClassId:target.id,targetStreamId:stream?.id||null,ruleSnapshot:snapshot};
}

async function promotionReferences(db:D1Database,organizationId:string,toYearId:string){
  const [levelRes,classRes,streamRes,ruleRes]=await Promise.all([
    db.prepare("SELECT id,name,code,sequence_no,promotion_level_id,terminal FROM school_class_levels WHERE organization_id=? AND active=1 ORDER BY sequence_no").bind(organizationId).all<LevelRow>(),
    db.prepare("SELECT id,class_level_id,campus_id,code,name FROM school_classes WHERE organization_id=? AND academic_year_id=? AND active=1 ORDER BY name").bind(organizationId,toYearId).all<ClassRow>(),
    db.prepare("SELECT st.id,st.class_id,st.code,st.name FROM school_streams st JOIN school_classes c ON c.id=st.class_id WHERE st.organization_id=? AND c.academic_year_id=? AND st.active=1").bind(organizationId,toYearId).all<StreamRow>(),
    db.prepare("SELECT id,class_level_id,name,minimum_average,maximum_failed_subjects,minimum_attendance_percent,target_class_level_id,allow_manual_override,rule_json FROM school_promotion_rules WHERE organization_id=? AND active=1 ORDER BY created_at DESC").bind(organizationId).all<RuleRow>()
  ]);
  return{levels:levelRes.results,classes:classRes.results,streams:streamRes.results,rules:ruleRes.results};
}

const previewSchema=z.object({fromAcademicYearId:z.string(),toAcademicYearId:z.string(),sourceClassId:z.string().optional().nullable(),sourceStreamId:z.string().optional().nullable(),effectiveOn:date,notes:z.string().max(2000).optional().nullable()});
schoolPromotionRoutes.post("/runs/preview",requireScope("school:write"),schoolPermission("school.students:approve"),async c=>{
  const p=c.get("principal"),s=previewSchema.safeParse(await c.req.json());
  if(!s.success)throw new AppError(422,"VALIDATION_ERROR","Invalid promotion preview",s.error.flatten());
  const v=s.data;if(v.fromAcademicYearId===v.toAcademicYearId)throw new AppError(422,"INVALID_YEAR","Choose a different destination academic year");
  const years=await c.env.FINANCE_DB.prepare("SELECT id FROM school_academic_years WHERE organization_id=? AND id IN (?,?)").bind(p.organizationId,v.fromAcademicYearId,v.toAcademicYearId).all();
  if(years.results.length!==2)throw new AppError(422,"INVALID_YEAR","One of the selected academic years does not belong to this school");
  if(v.sourceClassId){const row=await c.env.FINANCE_DB.prepare("SELECT 1 FROM school_classes WHERE id=? AND organization_id=? AND academic_year_id=?").bind(v.sourceClassId,p.organizationId,v.fromAcademicYearId).first();if(!row)throw new AppError(422,"INVALID_CLASS","Source class does not belong to the source academic year")}
  if(v.sourceStreamId){const row=await c.env.FINANCE_DB.prepare("SELECT 1 FROM school_streams WHERE id=? AND organization_id=? AND (? IS NULL OR class_id=?)").bind(v.sourceStreamId,p.organizationId,v.sourceClassId??null,v.sourceClassId??null).first();if(!row)throw new AppError(422,"INVALID_STREAM","Source stream does not match the selected class")}

  const where=["s.organization_id=?","s.current_academic_year_id=?","s.status='active'","s.deleted_at IS NULL"],bind:unknown[]=[p.organizationId,v.fromAcademicYearId];
  if(v.sourceClassId){where.push("s.current_class_id=?");bind.push(v.sourceClassId)}if(v.sourceStreamId){where.push("s.current_stream_id=?");bind.push(v.sourceStreamId)}
  const students=await c.env.FINANCE_DB.prepare(`SELECT s.id,s.admission_number,s.student_number,s.first_name,s.middle_name,s.last_name,s.campus_id,s.current_class_id,s.current_stream_id,c.code AS class_code,c.class_level_id,st.code AS stream_code FROM school_students s LEFT JOIN school_classes c ON c.id=s.current_class_id LEFT JOIN school_streams st ON st.id=s.current_stream_id WHERE ${where.join(" AND ")} ORDER BY c.name,st.name,s.last_name,s.first_name LIMIT 500`).bind(...bind).all<Record<string,unknown>>();
  if(!students.results.length)throw new AppError(409,"NO_STUDENTS","No active students match the selected source year/class/stream");
  const refs=await promotionReferences(c.env.FINANCE_DB,p.organizationId,v.toAcademicYearId),levelMap=new Map(refs.levels.map(x=>[x.id,x])),ruleMap=new Map<string,RuleRow>();for(const r of refs.rules)if(r.class_level_id&&!ruleMap.has(r.class_level_id))ruleMap.set(r.class_level_id,r);
  const attendanceRows=await c.env.FINANCE_DB.prepare(`SELECT r.person_id AS student_id,ROUND(100.0*SUM(CASE WHEN r.status IN ('present','late') THEN 1 ELSE 0 END)/NULLIF(SUM(CASE WHEN r.status IN ('present','late','absent','sick') THEN 1 ELSE 0 END),0),2) AS attendance_percent FROM att_records r JOIN att_sessions a ON a.id=r.session_id WHERE r.organization_id=? AND r.person_type='student' AND r.official=1 AND a.academic_year_id=? AND a.session_type='daily' AND a.status IN ('finalized','locked') GROUP BY r.person_id`).bind(p.organizationId,v.fromAcademicYearId).all<{student_id:string;attendance_percent:number|null}>();
  const attendanceByStudent=new Map(attendanceRows.results.map(r=>[r.student_id,r.attendance_percent==null?null:Number(r.attendance_percent)]));
  const runId=createId("prun"),items:Array<{stmt:D1PreparedStatement;decision:string}>=[];
  for(const raw of students.results){
    const levelId=String(raw.class_level_id||""),metrics:Metrics={averagePercent:null,failedSubjects:null,attendancePercent:attendanceByStudent.get(String(raw.id))??null};
    const rec=recommend({level:levelMap.get(levelId)||null,rule:ruleMap.get(levelId),metrics,classes:refs.classes,streams:refs.streams,campusId:raw.campus_id?String(raw.campus_id):null,sourceClassCode:raw.class_code?String(raw.class_code):null,sourceStreamCode:raw.stream_code?String(raw.stream_code):null,levels:refs.levels});
    const final=rec.decision==="review"?null:rec.decision;
    items.push({decision:rec.decision,stmt:c.env.FINANCE_DB.prepare(`INSERT INTO school_promotion_run_items (id,organization_id,run_id,student_id,from_class_id,from_stream_id,source_class_level_id,target_class_level_id,target_class_id,target_stream_id,average_percent,failed_subjects,attendance_percent,metrics_json,rule_snapshot_json,recommended_decision,recommendation_reason,final_decision) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(createId("prit"),p.organizationId,runId,raw.id,raw.current_class_id??null,raw.current_stream_id??null,levelId||null,rec.targetLevelId,rec.targetClassId,rec.targetStreamId,null,null,metrics.attendancePercent,JSON.stringify(metrics),JSON.stringify(rec.ruleSnapshot),rec.decision,rec.reason,final)})
  }
  const counts={promoted:items.filter(x=>x.decision==="promoted").length,repeated:items.filter(x=>x.decision==="repeated").length,graduated:items.filter(x=>x.decision==="graduated").length,review:items.filter(x=>x.decision==="review").length};
  await c.env.FINANCE_DB.batch([c.env.FINANCE_DB.prepare(`INSERT INTO school_promotion_runs (id,organization_id,from_academic_year_id,to_academic_year_id,source_class_id,source_stream_id,effective_on,notes,total_students,recommended_promotions,recommended_repeats,recommended_graduations,review_required,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(runId,p.organizationId,v.fromAcademicYearId,v.toAcademicYearId,v.sourceClassId??null,v.sourceStreamId??null,v.effectiveOn,v.notes??null,items.length,counts.promoted,counts.repeated,counts.graduated,counts.review,p.userId),...items.map(x=>x.stmt)]);
  await audit(c.env.FINANCE_DB,c,"school.promotion.previewed","school_promotion_run",runId,{...v,totalStudents:items.length,...counts});
  return c.json({data:{id:runId,status:"draft",totalStudents:items.length,...counts}},201);
});

schoolPromotionRoutes.get("/runs",schoolPermission("school.students:read"),async c=>{const p=c.get("principal"),limit=parseLimit(c,200),offset=parseOffset(c),rows=await c.env.FINANCE_DB.prepare(`SELECT r.*,fy.name AS from_year_name,ty.name AS to_year_name,cl.name AS source_class_name,st.name AS source_stream_name FROM school_promotion_runs r LEFT JOIN school_academic_years fy ON fy.id=r.from_academic_year_id LEFT JOIN school_academic_years ty ON ty.id=r.to_academic_year_id LEFT JOIN school_classes cl ON cl.id=r.source_class_id LEFT JOIN school_streams st ON st.id=r.source_stream_id WHERE r.organization_id=? ORDER BY r.created_at DESC LIMIT ? OFFSET ?`).bind(p.organizationId,limit,offset).all<Record<string,unknown>>();return c.json({data:camelizeRows(rows.results),pagination:{limit,offset,count:rows.results.length}})});

schoolPromotionRoutes.get("/runs/:id",schoolPermission("school.students:read"),async c=>{const p=c.get("principal"),id=c.req.param("id"),run=await c.env.FINANCE_DB.prepare(`SELECT r.*,fy.name AS from_year_name,ty.name AS to_year_name,cl.name AS source_class_name,st.name AS source_stream_name FROM school_promotion_runs r LEFT JOIN school_academic_years fy ON fy.id=r.from_academic_year_id LEFT JOIN school_academic_years ty ON ty.id=r.to_academic_year_id LEFT JOIN school_classes cl ON cl.id=r.source_class_id LEFT JOIN school_streams st ON st.id=r.source_stream_id WHERE r.id=? AND r.organization_id=?`).bind(id,p.organizationId).first<Record<string,unknown>>();if(!run)throw new AppError(404,"NOT_FOUND","Promotion run not found");const items=await c.env.FINANCE_DB.prepare(`SELECT i.*,s.admission_number,s.student_number,s.first_name,s.middle_name,s.last_name,fc.name AS from_class_name,fs.name AS from_stream_name,tl.name AS target_level_name,tc.name AS target_class_name,ts.name AS target_stream_name FROM school_promotion_run_items i JOIN school_students s ON s.id=i.student_id LEFT JOIN school_classes fc ON fc.id=i.from_class_id LEFT JOIN school_streams fs ON fs.id=i.from_stream_id LEFT JOIN school_class_levels tl ON tl.id=i.target_class_level_id LEFT JOIN school_classes tc ON tc.id=i.target_class_id LEFT JOIN school_streams ts ON ts.id=i.target_stream_id WHERE i.organization_id=? AND i.run_id=? ORDER BY fc.name,fs.name,s.last_name,s.first_name`).bind(p.organizationId,id).all<Record<string,unknown>>();return c.json({data:{...camelizeRow(run),items:camelizeRows(items.results)}})});

const itemSchema=z.object({averagePercent:z.number().min(0).max(100).optional().nullable(),failedSubjects:z.number().int().min(0).optional().nullable(),attendancePercent:z.number().min(0).max(100).optional().nullable(),finalDecision:z.enum(["promoted","repeated","graduated","skipped"]).optional().nullable(),targetClassId:z.string().optional().nullable(),targetStreamId:z.string().optional().nullable(),overrideReason:z.string().max(2000).optional().nullable()});
schoolPromotionRoutes.put("/runs/:runId/items/:itemId",requireScope("school:write"),schoolPermission("school.students:approve"),async c=>{
  const p=c.get("principal"),runId=c.req.param("runId"),itemId=c.req.param("itemId"),s=itemSchema.safeParse(await c.req.json());if(!s.success)throw new AppError(422,"VALIDATION_ERROR","Invalid promotion decision",s.error.flatten());
  const run=await c.env.FINANCE_DB.prepare("SELECT to_academic_year_id AS toYearId,status FROM school_promotion_runs WHERE id=? AND organization_id=?").bind(runId,p.organizationId).first<{toYearId:string;status:string}>();if(!run)throw new AppError(404,"NOT_FOUND","Promotion run not found");if(run.status!=="draft")throw new AppError(409,"RUN_LOCKED","Applied or cancelled promotion runs cannot be edited");
  const item=await c.env.FINANCE_DB.prepare(`SELECT i.*,c.campus_id,c.code AS source_class_code,st.code AS source_stream_code FROM school_promotion_run_items i LEFT JOIN school_classes c ON c.id=i.from_class_id LEFT JOIN school_streams st ON st.id=i.from_stream_id WHERE i.id=? AND i.run_id=? AND i.organization_id=?`).bind(itemId,runId,p.organizationId).first<Record<string,unknown>>();if(!item)throw new AppError(404,"NOT_FOUND","Promotion learner not found");
  const refs=await promotionReferences(c.env.FINANCE_DB,p.organizationId,run.toYearId),level=refs.levels.find(x=>x.id===item.source_class_level_id)||null,rule=refs.rules.find(x=>x.class_level_id===item.source_class_level_id),metrics:Metrics={averagePercent:"averagePercent" in s.data?s.data.averagePercent??null:num(item.average_percent),failedSubjects:"failedSubjects" in s.data?s.data.failedSubjects??null:num(item.failed_subjects),attendancePercent:"attendancePercent" in s.data?s.data.attendancePercent??null:num(item.attendance_percent)};
  const rec=recommend({level,rule,metrics,classes:refs.classes,streams:refs.streams,campusId:item.campus_id?String(item.campus_id):null,sourceClassCode:item.source_class_code?String(item.source_class_code):null,sourceStreamCode:item.source_stream_code?String(item.source_stream_code):null,levels:refs.levels});
  const final="finalDecision" in s.data?s.data.finalDecision:(item.final_decision?String(item.final_decision) as "promoted"|"repeated"|"graduated"|"skipped":rec.decision==="review"?null:rec.decision);
  const explicitClass=Object.prototype.hasOwnProperty.call(s.data,"targetClassId"),explicitStream=Object.prototype.hasOwnProperty.call(s.data,"targetStreamId");
  let targetClassId:string|null=explicitClass?s.data.targetClassId??null:rec.targetClassId,targetStreamId:string|null=explicitStream?s.data.targetStreamId??null:rec.targetStreamId;
  if(!explicitClass&&final==="repeated")targetClassId=pickClass(refs.classes,level?.id||null,item.campus_id?String(item.campus_id):null,item.source_class_code?String(item.source_class_code):null)?.id||null;
  if(!explicitClass&&final==="promoted")targetClassId=pickClass(refs.classes,rec.targetLevelId,item.campus_id?String(item.campus_id):null,null)?.id||null;
  if(!explicitStream&&targetClassId)targetStreamId=pickStream(refs.streams,targetClassId,item.source_stream_code?String(item.source_stream_code):null)?.id||null;
  if(final==="graduated"||final==="skipped"){targetClassId=null;targetStreamId=null}
  if(final&&["promoted","repeated"].includes(final)&&!targetClassId)throw new AppError(422,"TARGET_CLASS_REQUIRED","Choose a target class before applying this learner's decision");
  if(targetClassId&&!refs.classes.some(x=>x.id===targetClassId))throw new AppError(422,"INVALID_TARGET_CLASS","Target class must belong to the destination academic year");if(targetStreamId&&!refs.streams.some(x=>x.id===targetStreamId&&x.class_id===targetClassId))throw new AppError(422,"INVALID_TARGET_STREAM","Target stream must belong to the selected target class");
  const differs=Boolean(final&&final!=="skipped"&&(rec.decision==="review"||final!==rec.decision||targetClassId!==rec.targetClassId||targetStreamId!==rec.targetStreamId));if(differs&&!s.data.overrideReason&&!item.override_reason)throw new AppError(422,"OVERRIDE_REASON_REQUIRED","Enter a reason for overriding the promotion rule recommendation or target");if(differs&&rule&&!rule.allow_manual_override)throw new AppError(409,"OVERRIDE_NOT_ALLOWED","This promotion rule does not allow manual overrides");
  await c.env.FINANCE_DB.prepare(`UPDATE school_promotion_run_items SET average_percent=?,failed_subjects=?,attendance_percent=?,metrics_json=?,rule_snapshot_json=?,recommended_decision=?,recommendation_reason=?,target_class_level_id=?,target_class_id=?,target_stream_id=?,final_decision=?,override_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND run_id=? AND organization_id=?`).bind(metrics.averagePercent,metrics.failedSubjects,metrics.attendancePercent,JSON.stringify(metrics),JSON.stringify(rec.ruleSnapshot),rec.decision,rec.reason,rec.targetLevelId,targetClassId,targetStreamId,final??null,s.data.overrideReason??item.override_reason??null,itemId,runId,p.organizationId).run();
  await audit(c.env.FINANCE_DB,c,"school.promotion.item.reviewed","school_promotion_run_item",itemId,{metrics,recommendedDecision:rec.decision,finalDecision:final,targetClassId,targetStreamId,overrideReason:s.data.overrideReason});return c.json({data:{id:itemId,metrics,recommendedDecision:rec.decision,recommendationReason:rec.reason,finalDecision:final,targetClassId,targetStreamId}})
});

schoolPromotionRoutes.post("/runs/:id/apply",requireScope("school:write"),schoolPermission("school.students:approve"),async c=>{
  const p=c.get("principal"),runId=c.req.param("id"),run=await c.env.FINANCE_DB.prepare("SELECT * FROM school_promotion_runs WHERE id=? AND organization_id=?").bind(runId,p.organizationId).first<Record<string,unknown>>();if(!run)throw new AppError(404,"NOT_FOUND","Promotion run not found");if(run.status!=="draft")throw new AppError(409,"RUN_LOCKED","Only draft promotion runs can be applied");
  const items=await c.env.FINANCE_DB.prepare("SELECT * FROM school_promotion_run_items WHERE run_id=? AND organization_id=? ORDER BY created_at").bind(runId,p.organizationId).all<Record<string,unknown>>();const unresolved=items.results.filter(x=>!x.final_decision);if(unresolved.length)throw new AppError(409,"UNRESOLVED_DECISIONS",`${unresolved.length} learners still require a final promotion decision`);
  const statements:D1PreparedStatement[]=[];let applied=0,skipped=0;
  for(const item of items.results){const final=String(item.final_decision);if(final==="skipped"){statements.push(c.env.FINANCE_DB.prepare("UPDATE school_promotion_run_items SET item_status='skipped',updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(item.id,p.organizationId));skipped++;continue}
    const student=await c.env.FINANCE_DB.prepare("SELECT current_academic_year_id AS yearId,current_class_id AS classId,current_stream_id AS streamId,campus_id AS campusId,status FROM school_students WHERE id=? AND organization_id=? AND deleted_at IS NULL").bind(item.student_id,p.organizationId).first<{yearId:string|null;classId:string|null;streamId:string|null;campusId:string|null;status:string}>();if(!student)throw new AppError(409,"STALE_STUDENT","A learner in this promotion run no longer exists");if(student.yearId!==run.from_academic_year_id||student.status!=="active")throw new AppError(409,"STALE_PROMOTION_RUN","A learner's current year/status changed after the preview. Create a fresh promotion preview before applying.");
    const targetClassId=item.target_class_id?String(item.target_class_id):null,targetStreamId=item.target_stream_id?String(item.target_stream_id):null;if(final!=="graduated"&&!targetClassId)throw new AppError(409,"TARGET_CLASS_REQUIRED","Every promoted/repeated learner needs a target class");
    const override=String(item.recommended_decision)!==final||Boolean(item.override_reason),historyDecision=override?"manual_override":final,promotionId=createId("pro"),snapshot={runId,metrics:JSON.parse(String(item.metrics_json||"{}")),rule:JSON.parse(String(item.rule_snapshot_json||"{}")),recommendedDecision:item.recommended_decision,finalDecision:final,overrideReason:item.override_reason||null};
    statements.push(c.env.FINANCE_DB.prepare(`INSERT INTO school_student_promotions (id,organization_id,student_id,from_academic_year_id,to_academic_year_id,from_class_id,to_class_id,from_stream_id,to_stream_id,decision,reason,rule_snapshot_json,effective_on,approved_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(promotionId,p.organizationId,item.student_id,run.from_academic_year_id,run.to_academic_year_id,student.classId,final==="graduated"?null:targetClassId,student.streamId,final==="graduated"?null:targetStreamId,historyDecision,item.override_reason||item.recommendation_reason||null,JSON.stringify(snapshot),run.effective_on,p.userId));
    statements.push(c.env.FINANCE_DB.prepare("UPDATE school_students SET current_academic_year_id=?,current_class_id=?,current_stream_id=?,status=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(run.to_academic_year_id,final==="graduated"?null:targetClassId,final==="graduated"?null:targetStreamId,final==="graduated"?"graduated":"active",p.userId,item.student_id,p.organizationId));
    statements.push(c.env.FINANCE_DB.prepare("UPDATE school_enrollments SET status=?,left_on=?,reason=?,updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND student_id=? AND status='active'").bind(final==="repeated"?"repeated":"completed",run.effective_on,final==="repeated"?"Year-end repetition":"Year-end promotion",p.organizationId,item.student_id));
    if(final!=="graduated")statements.push(c.env.FINANCE_DB.prepare(`INSERT INTO school_enrollments (id,organization_id,student_id,academic_year_id,class_id,stream_id,campus_id,enrolled_on,status,reason,created_by) VALUES (?,?,?,?,?,?,?,?, 'active',?,?) ON CONFLICT(organization_id,student_id,academic_year_id) DO UPDATE SET class_id=excluded.class_id,stream_id=excluded.stream_id,campus_id=excluded.campus_id,enrolled_on=excluded.enrolled_on,status='active',reason=excluded.reason,updated_at=CURRENT_TIMESTAMP`).bind(createId("enr"),p.organizationId,item.student_id,run.to_academic_year_id,targetClassId,targetStreamId,student.campusId,run.effective_on,final==="repeated"?"Repeated from prior academic year":"Promoted from prior academic year",p.userId));
    statements.push(c.env.FINANCE_DB.prepare("INSERT INTO school_student_timeline (id,organization_id,student_id,event_type,title,description,event_at,actor_id,source_type,source_id) VALUES (?,?,?,'promotion',?,?,?,?,'promotion',?)").bind(createId("stl"),p.organizationId,item.student_id,final==="graduated"?"Student graduated":final==="repeated"?"Student repeated":"Student promoted",item.override_reason||item.recommendation_reason||null,run.effective_on,p.userId,promotionId));
    statements.push(c.env.FINANCE_DB.prepare("UPDATE school_promotion_run_items SET item_status='applied',applied_promotion_id=?,error_message=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(promotionId,item.id,p.organizationId));applied++;
  }
  statements.push(c.env.FINANCE_DB.prepare("UPDATE school_promotion_runs SET status='applied',applied_students=?,applied_by=?,applied_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(applied,p.userId,runId,p.organizationId));await c.env.FINANCE_DB.batch(statements);await audit(c.env.FINANCE_DB,c,"school.promotion.applied","school_promotion_run",runId,{applied,skipped,total:items.results.length});return c.json({data:{id:runId,status:"applied",applied,skipped,total:items.results.length}})
});

schoolPromotionRoutes.post("/runs/:id/cancel",requireScope("school:write"),schoolPermission("school.students:approve"),async c=>{const p=c.get("principal"),id=c.req.param("id"),row=await c.env.FINANCE_DB.prepare("SELECT status FROM school_promotion_runs WHERE id=? AND organization_id=?").bind(id,p.organizationId).first<{status:string}>();if(!row)throw new AppError(404,"NOT_FOUND","Promotion run not found");if(row.status!=="draft")throw new AppError(409,"RUN_LOCKED","Only draft promotion runs can be cancelled");await c.env.FINANCE_DB.prepare("UPDATE school_promotion_runs SET status='cancelled',cancelled_by=?,cancelled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(p.userId,id,p.organizationId).run();await audit(c.env.FINANCE_DB,c,"school.promotion.cancelled","school_promotion_run",id);return c.json({data:{id,status:"cancelled"}})});

schoolPromotionRoutes.get("/students/:studentId/history",schoolPermission("school.students:read"),async c=>{const p=c.get("principal"),studentId=c.req.param("studentId"),rows=await c.env.FINANCE_DB.prepare(`SELECT sp.*,fy.name AS from_year_name,ty.name AS to_year_name,fc.name AS from_class_name,tc.name AS to_class_name,fs.name AS from_stream_name,ts.name AS to_stream_name FROM school_student_promotions sp LEFT JOIN school_academic_years fy ON fy.id=sp.from_academic_year_id LEFT JOIN school_academic_years ty ON ty.id=sp.to_academic_year_id LEFT JOIN school_classes fc ON fc.id=sp.from_class_id LEFT JOIN school_classes tc ON tc.id=sp.to_class_id LEFT JOIN school_streams fs ON fs.id=sp.from_stream_id LEFT JOIN school_streams ts ON ts.id=sp.to_stream_id WHERE sp.organization_id=? AND sp.student_id=? ORDER BY sp.effective_on DESC,sp.created_at DESC`).bind(p.organizationId,studentId).all<Record<string,unknown>>();return c.json({data:camelizeRows(rows.results)})});
