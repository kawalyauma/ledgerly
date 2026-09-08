// @ts-nocheck
import {Hono} from "hono";
import type {AppVariables,Env} from "../../../src/types";
import {requireScope} from "../../../src/lib/auth";
import {requireModuleEnabled} from "../../../src/lib/modules";
import {AppError} from "../../../src/lib/errors";
import {schoolPermission} from "../../school/backend/common";

export const examFinalizationRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
examFinalizationRoutes.use("*",requireModuleEnabled("exams"));
examFinalizationRoutes.use("*",requireScope("school:read"));
examFinalizationRoutes.post("/:examId/finalize",requireScope("school:write"),schoolPermission("school.exams:publish"),async c=>{
  const p=c.get("principal"),examId=c.req.param("examId"),db=c.env.FINANCE_DB;
  const exam=await db.prepare("SELECT id,status FROM exm_exams WHERE id=? AND organization_id=?").bind(examId,p.organizationId).first<any>();
  if(!exam)throw new AppError(404,"EXAM_NOT_FOUND","Exam not found");
  if(exam.status==="published")return c.json({data:{id:examId,status:"published",alreadyPublished:true}});
  if(exam.status!=="marking")throw new AppError(409,"INVALID_STATUS","Move the examination to marking before final publication.");
  const rows=(await db.prepare(`SELECT ec.class_id AS classId,c.name AS className,COUNT(rc.id) AS cards,SUM(CASE WHEN rc.is_published=1 THEN 1 ELSE 0 END) AS publishedCards
    FROM exm_exam_classes ec JOIN school_classes c ON c.id=ec.class_id
    LEFT JOIN exm_report_cards rc ON rc.organization_id=ec.organization_id AND rc.exam_id=ec.exam_id AND rc.class_id=ec.class_id
    WHERE ec.organization_id=? AND ec.exam_id=? GROUP BY ec.class_id,c.name ORDER BY c.name`).bind(p.organizationId,examId).all()).results as any[];
  if(!rows.length)throw new AppError(409,"EXAM_HAS_NO_CLASSES","Enroll at least one class before finalizing this examination.");
  const pending=rows.filter(x=>Number(x.cards||0)===0||Number(x.cards||0)!==Number(x.publishedCards||0));
  if(pending.length)throw new AppError(409,"UNPUBLISHED_CLASS_RESULTS",`Publish the computed report cards for every enrolled class first. Pending: ${pending.map(x=>x.className).join(", ")}.`);
  await db.prepare("UPDATE exm_exams SET status='published',updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(p.userId,examId,p.organizationId).run();
  return c.json({data:{id:examId,status:"published",classes:rows.length,reportCards:rows.reduce((n,x)=>n+Number(x.cards||0),0)}});
});
