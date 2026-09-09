import type {MobileSession} from "../auth";
import {ledgerlyRequest,query,type SessionUpdater} from "../apiClient";
import {examsOfflineFallback,offlineCommentRules,offlineExam,offlineExamClasses,offlineExamSubjects,offlineExams,offlineGradingScales,offlineMarksheet,offlineOverview,offlineReportCard,offlineReportCards,offlineSchoolSubjects,queueOfflineBulkMarks,queueOfflineMark} from "./offline";
import type {AuditEntry,CommentRule,Exam,ExamClass,ExamSubject,ExamsOverview,GradeBand,GradeScale,Mark,Marksheet,ReportCardSummary,ReportSummary,StudentReportCard} from "./types";
type Client={session:MobileSession;onSession?:SessionUpdater};
const req=<T>(c:Client,path:string,init:RequestInit={})=>ledgerlyRequest<T>(c.session,`/exams${path}`,init,c.onSession);
const json=(method:string,body?:unknown):RequestInit=>({method,body:body===undefined?undefined:JSON.stringify(body)});
const list=<T>(c:Client,path:string,params:Record<string,string|number|boolean|undefined|null>={})=>req<T[]>(c,`${path}${query(params)}`);
export const examsApi={
 overview:(c:Client)=>examsOfflineFallback(()=>req<ExamsOverview>(c,"/overview"),offlineOverview),
 exams:(c:Client,filters:{status?:string;termId?:string;academicYearId?:string}={})=>examsOfflineFallback(()=>list<Exam>(c,"/",filters),()=>offlineExams(filters)),
 exam:(c:Client,id:string)=>examsOfflineFallback(()=>req<Exam>(c,`/${id}`),()=>offlineExam(id)),
 createExam:(c:Client,body:any)=>req<Exam>(c,"/",json("POST",body)),
 updateExam:(c:Client,id:string,body:any)=>req<Exam>(c,`/${id}`,json("PATCH",body)),
 setStatus:(c:Client,id:string,status:string)=>status==="published"?req<any>(c,`/${id}/finalize`,json("POST",{})):req<Exam>(c,`/${id}/status`,json("PATCH",{status})),
 finalize:(c:Client,id:string)=>req<any>(c,`/${id}/finalize`,json("POST",{})),
 schoolSubjects:(c:Client,classId?:string)=>examsOfflineFallback(()=>list<any>(c,"/subjects",{classId}),()=>offlineSchoolSubjects(classId)),
 examClasses:(c:Client,id:string)=>examsOfflineFallback(()=>list<ExamClass>(c,`/${id}/classes`),()=>offlineExamClasses(id)),
 addClass:(c:Client,id:string,classId:string,streamId?:string|null)=>req<ExamClass>(c,`/${id}/classes`,json("POST",{classId,streamId})),
 removeClass:(c:Client,id:string,classId:string)=>req<any>(c,`/${id}/classes/${classId}`,{method:"DELETE"}),
 examSubjects:(c:Client,id:string,classId?:string)=>examsOfflineFallback(()=>list<ExamSubject>(c,`/${id}/subjects`,{classId}),()=>offlineExamSubjects(id,classId)),
 addSubject:(c:Client,id:string,classId:string,subjectId:string,body:any={})=>req<ExamSubject>(c,`/${id}/subjects`,json("POST",{classId,subjectId,...body})),
 bulkAddSubjects:(c:Client,id:string,classId:string,subjectIds:string[])=>req<any[]>(c,`/${id}/subjects/bulk`,json("POST",{classId,subjectIds})),
 removeSubject:(c:Client,id:string,classId:string,subjectId:string)=>req<any>(c,`/${id}/subjects/${subjectId}${query({classId})}`,{method:"DELETE"}),
 marksheet:(c:Client,id:string,classId:string)=>examsOfflineFallback(()=>req<Marksheet>(c,`/${id}/marksheet${query({classId})}`),()=>offlineMarksheet(id,classId)),
 enterMark:(c:Client,id:string,studentId:string,subjectId:string,body:any)=>examsOfflineFallback(()=>req<Mark>(c,`/${id}/marks`,json("POST",{studentId,subjectId,...body})),()=>queueOfflineMark(id,studentId,subjectId,body)),
 bulkMarks:(c:Client,id:string,subjectId:string,records:any[])=>examsOfflineFallback(()=>req<any[]>(c,`/${id}/marks/bulk`,json("POST",{subjectId,records})),()=>queueOfflineBulkMarks(id,subjectId,records)),
 compute:(c:Client,id:string,classId:string)=>req<any>(c,`/${id}/compute`,json("POST",{classId})),
 reportCards:(c:Client,id:string,classId:string)=>examsOfflineFallback(()=>req<ReportCardSummary[]>(c,`/${id}/report-cards${query({classId})}`),()=>offlineReportCards(id,classId)),
 reportCard:(c:Client,id:string,studentId:string)=>examsOfflineFallback(()=>req<StudentReportCard>(c,`/${id}/report-cards/${studentId}`),()=>offlineReportCard(id,studentId)),
 updateComments:(c:Client,id:string,studentId:string,body:any)=>req<StudentReportCard>(c,`/${id}/report-cards/${studentId}/comments`,json("PATCH",body)),
 publishClass:(c:Client,id:string,classId:string)=>req<any>(c,`/${id}/publish`,json("POST",{classId})),
 reportSummary:(c:Client,id:string,classId?:string)=>req<ReportSummary>(c,`/${id}/reports/summary${query({classId})}`),
 audit:(c:Client,id:string,limit=300)=>req<AuditEntry[]>(c,`/${id}/audit${query({limit})}`),
 gradingScales:(c:Client)=>examsOfflineFallback(()=>list<GradeScale>(c,"/grading-scales"),offlineGradingScales),
 seedPle:(c:Client)=>req<GradeScale>(c,"/grading-scales/seed-ple",json("POST",{})),
 updateBand:(c:Client,id:string,body:Partial<GradeBand>)=>req<GradeBand>(c,`/grade-bands/${id}`,json("PATCH",body)),
 commentRules:(c:Client,type?:string)=>examsOfflineFallback(()=>list<CommentRule>(c,"/comment-rules",{type}),()=>offlineCommentRules(type)),
 seedComments:(c:Client)=>req<any>(c,"/comment-rules/seed-defaults",json("POST",{})),
 saveCommentRule:(c:Client,body:any)=>req<CommentRule>(c,"/comment-rules",json("POST",body)),
 deleteCommentRule:(c:Client,id:string)=>req<any>(c,`/comment-rules/${id}`,{method:"DELETE"}),
};
