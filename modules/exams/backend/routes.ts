// @ts-nocheck
import { Hono } from "hono";
import { z } from "zod";
import type { AppVariables, Env } from "../../../src/types";
import { requireScope } from "../../../src/lib/auth";
import { requireModuleEnabled } from "../../../src/lib/modules";
import { AppError } from "../../../src/lib/errors";
import { schoolPermission } from "../../school/backend/common";
import * as S from "./service";

export const examRoutes = new Hono<{Bindings:Env;Variables:AppVariables}>();
examRoutes.use("*", requireModuleEnabled("exams"));
examRoutes.use("*", requireScope("school:read"));

const body=async(c:any)=>c.req.json<Record<string,unknown>>().catch(()=>({}));
const required=(v:any,name:string)=>{const s=String(v??"").trim();if(!s)throw new AppError(422,"VALIDATION_ERROR",`${name} is required`);return s};
const maxLimit=(v:any,d=200)=>Math.min(1000,Math.max(1,Number(v)||d));

examRoutes.get("/manifest", c=>c.json({data:{key:"exams",name:"Examinations",version:"1.0.0",standalone:true,sharedEntities:["school_students","school_classes","school_streams","school_subjects","school_terms","school_academic_years","users","att_records"],reportStyle:"Attached Uganda PLE report-card generator"}}));
examRoutes.get("/overview", schoolPermission("school.exams:read"), async c=>c.json({data:await S.overview(c.env.FINANCE_DB,c.get("principal").organizationId)}));
examRoutes.get("/subjects", schoolPermission("school.exams:read"), async c=>c.json({data:await S.listSchoolSubjects(c.env.FINANCE_DB,c.get("principal").organizationId,c.req.query("classId")||null)}));

examRoutes.get("/grading-scales", schoolPermission("school.exams:read"), async c=>c.json({data:await S.listScales(c.env.FINANCE_DB,c.get("principal").organizationId)}));
examRoutes.post("/grading-scales/seed-ple", requireScope("school:write"), schoolPermission("school.exams:manage"), async c=>{const p=c.get("principal");return c.json({data:await S.seedPleScale(c.env.FINANCE_DB,p.organizationId,p.userId)},201)});
examRoutes.patch("/grade-bands/:id", requireScope("school:write"), schoolPermission("school.exams:manage"), async c=>{const p=c.get("principal");return c.json({data:await S.updateBand(c.env.FINANCE_DB,p.organizationId,c.req.param("id"),await body(c))})});
examRoutes.get("/comment-rules", schoolPermission("school.exams:read"), async c=>c.json({data:await S.listComments(c.env.FINANCE_DB,c.get("principal").organizationId,c.req.query("type")||null)}));
examRoutes.post("/comment-rules/seed-defaults", requireScope("school:write"), schoolPermission("school.exams:manage"), async c=>{const p=c.get("principal");return c.json({data:await S.seedDefaultComments(c.env.FINANCE_DB,p.organizationId,p.userId)})});
examRoutes.post("/comment-rules", requireScope("school:write"), schoolPermission("school.exams:manage"), async c=>{const p=c.get("principal"),d=await body(c);required(d.comment_type,"comment_type");required(d.comment_text,"comment_text");return c.json({data:await S.upsertComment(c.env.FINANCE_DB,p.organizationId,p.userId,d)},201)});
examRoutes.delete("/comment-rules/:id", requireScope("school:write"), schoolPermission("school.exams:manage"), async c=>c.json({data:await S.deleteComment(c.env.FINANCE_DB,c.get("principal").organizationId,c.req.param("id"))}));

examRoutes.get("/", schoolPermission("school.exams:read"), async c=>{const p=c.get("principal");return c.json({data:await S.listExams(c.env.FINANCE_DB,p.organizationId,{status:c.req.query("status"),term_id:c.req.query("termId"),academic_year_id:c.req.query("academicYearId")})})});
examRoutes.post("/", requireScope("school:write"), schoolPermission("school.exams:manage"), async c=>{const p=c.get("principal"),d=await body(c);required(d.name,"Exam name");return c.json({data:await S.createExam(c.env.FINANCE_DB,p.organizationId,p.userId,d)},201)});
examRoutes.get("/:examId", schoolPermission("school.exams:read"), async c=>c.json({data:await S.getExam(c.env.FINANCE_DB,c.get("principal").organizationId,c.req.param("examId"))}));
examRoutes.patch("/:examId", requireScope("school:write"), schoolPermission("school.exams:manage"), async c=>{const p=c.get("principal");return c.json({data:await S.updateExam(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("examId"),await body(c))})});
examRoutes.patch("/:examId/status", requireScope("school:write"), schoolPermission("school.exams:manage"), async c=>{const p=c.get("principal"),d=await body(c);return c.json({data:await S.updateExamStatus(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("examId"),required(d.status,"status"))})});

examRoutes.get("/:examId/classes", schoolPermission("school.exams:read"), async c=>c.json({data:await S.listExamClasses(c.env.FINANCE_DB,c.get("principal").organizationId,c.req.param("examId"))}));
examRoutes.post("/:examId/classes", requireScope("school:write"), schoolPermission("school.exams:manage"), async c=>{const p=c.get("principal"),d=await body(c);return c.json({data:await S.enrollClass(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("examId"),required(d.class_id??d.classId,"class_id"),String(d.stream_id??d.streamId??"")||null)},201)});
examRoutes.delete("/:examId/classes/:classId", requireScope("school:write"), schoolPermission("school.exams:manage"), async c=>c.json({data:await S.removeClass(c.env.FINANCE_DB,c.get("principal").organizationId,c.req.param("examId"),c.req.param("classId"))}));

examRoutes.get("/:examId/subjects", schoolPermission("school.exams:read"), async c=>c.json({data:await S.listExamSubjects(c.env.FINANCE_DB,c.get("principal").organizationId,c.req.param("examId"),c.req.query("classId")||null)}));
examRoutes.post("/:examId/subjects", requireScope("school:write"), schoolPermission("school.exams:manage"), async c=>{const p=c.get("principal"),d=await body(c);return c.json({data:await S.addSubject(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("examId"),required(d.class_id??d.classId,"class_id"),required(d.subject_id??d.subjectId,"subject_id"),d)},201)});
examRoutes.post("/:examId/subjects/bulk", requireScope("school:write"), schoolPermission("school.exams:manage"), async c=>{const p=c.get("principal"),d=await body(c),ids=Array.isArray(d.subject_ids)?d.subject_ids:Array.isArray(d.subjectIds)?d.subjectIds:[];if(!ids.length)throw new AppError(422,"VALIDATION_ERROR","subject_ids[] is required");return c.json({data:await S.bulkAddSubjects(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("examId"),required(d.class_id??d.classId,"class_id"),ids.map(String))})});
examRoutes.delete("/:examId/subjects/:subjectId", requireScope("school:write"), schoolPermission("school.exams:manage"), async c=>{const classId=c.req.query("classId");if(!classId)throw new AppError(422,"VALIDATION_ERROR","classId is required");return c.json({data:await S.removeSubject(c.env.FINANCE_DB,c.get("principal").organizationId,c.req.param("examId"),classId,c.req.param("subjectId"))})});

examRoutes.get("/:examId/marksheet", schoolPermission("school.exams:read"), async c=>{const classId=c.req.query("classId");if(!classId)throw new AppError(422,"VALIDATION_ERROR","classId is required");return c.json({data:await S.getMarksheet(c.env.FINANCE_DB,c.get("principal").organizationId,c.req.param("examId"),classId)})});
examRoutes.post("/:examId/marks", requireScope("school:write"), schoolPermission("school.exams:write"), async c=>{const p=c.get("principal"),d=await body(c);return c.json({data:await S.enterMark(c.env.FINANCE_DB,p.organizationId,c.req.param("examId"),required(d.student_id??d.studentId,"student_id"),required(d.subject_id??d.subjectId,"subject_id"),d,p.userId)})});
examRoutes.post("/:examId/marks/bulk", requireScope("school:write"), schoolPermission("school.exams:write"), async c=>{const p=c.get("principal"),d=await body(c),records=Array.isArray(d.records)?d.records:[];return c.json({data:await S.bulkEnterMarks(c.env.FINANCE_DB,p.organizationId,c.req.param("examId"),required(d.subject_id??d.subjectId,"subject_id"),records,p.userId)})});

examRoutes.post("/:examId/compute", requireScope("school:write"), schoolPermission("school.exams:manage"), async c=>{const p=c.get("principal"),d=await body(c);return c.json({data:await S.computeClassReportCards(c.env.FINANCE_DB,p.organizationId,c.req.param("examId"),required(d.class_id??d.classId,"class_id"),p.userId)})});
examRoutes.get("/:examId/report-cards", schoolPermission("school.exams:read"), async c=>{const classId=c.req.query("classId");if(!classId)throw new AppError(422,"VALIDATION_ERROR","classId is required");return c.json({data:await S.getClassReportSummary(c.env.FINANCE_DB,c.get("principal").organizationId,c.req.param("examId"),classId)})});
examRoutes.get("/:examId/report-cards/:studentId", schoolPermission("school.exams:read"), async c=>c.json({data:await S.getStudentReportCard(c.env.FINANCE_DB,c.get("principal").organizationId,c.req.param("examId"),c.req.param("studentId"))}));
examRoutes.patch("/:examId/report-cards/:studentId/comments", requireScope("school:write"), schoolPermission("school.exams:write"), async c=>{const p=c.get("principal");return c.json({data:await S.updateComments(c.env.FINANCE_DB,p.organizationId,c.req.param("examId"),c.req.param("studentId"),p.userId,await body(c))})});
examRoutes.post("/:examId/publish", requireScope("school:write"), schoolPermission("school.exams:publish"), async c=>{const p=c.get("principal"),d=await body(c);return c.json({data:await S.publishClass(c.env.FINANCE_DB,p.organizationId,c.req.param("examId"),required(d.class_id??d.classId,"class_id"),p.userId)})});
examRoutes.get("/:examId/reports/summary", schoolPermission("school.exams:read"), async c=>c.json({data:await S.reportSummary(c.env.FINANCE_DB,c.get("principal").organizationId,c.req.param("examId"),c.req.query("classId")||null)}));
examRoutes.get("/:examId/audit", schoolPermission("school.exams:manage"), async c=>c.json({data:await S.markAudit(c.env.FINANCE_DB,c.get("principal").organizationId,c.req.param("examId"),maxLimit(c.req.query("limit"),200))}));
