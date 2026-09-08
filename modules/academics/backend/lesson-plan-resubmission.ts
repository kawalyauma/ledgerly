// @ts-nocheck
import {Hono} from "hono";
import type {AppVariables,Env} from "../../../src/types";
import {requireScope} from "../../../src/lib/auth";
import {requireModuleEnabled} from "../../../src/lib/modules";
import {AppError} from "../../../src/lib/errors";
import {schoolPermission} from "../../school/backend/common";

export const lessonPlanResubmissionRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
lessonPlanResubmissionRoutes.use("*",requireModuleEnabled("school-management"));
lessonPlanResubmissionRoutes.use("*",requireModuleEnabled("academics"));
lessonPlanResubmissionRoutes.use("*",requireScope("school:read"));
lessonPlanResubmissionRoutes.post("/lesson-plans/:id/resubmit",requireScope("school:write"),schoolPermission("school.academics:write"),async c=>{
  const p=c.get("principal"),id=c.req.param("id");
  const row=await c.env.FINANCE_DB.prepare("SELECT id,status FROM acad_lesson_plans WHERE id=? AND organization_id=?").bind(id,p.organizationId).first<any>();
  if(!row)throw new AppError(404,"NOT_FOUND","Lesson plan not found");
  if(row.status!=="rejected")throw new AppError(409,"INVALID_STATUS",`Cannot resubmit a lesson plan from ${row.status}.`);
  await c.env.FINANCE_DB.prepare("UPDATE acad_lesson_plans SET status='submitted',updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(id,p.organizationId).run();
  return c.json({data:{id,status:"submitted"}});
});
