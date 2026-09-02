import { Hono } from "hono";
import { z } from "zod";
import type { AppVariables, Env } from "../types";
import { requireScope } from "../lib/auth";
import { AppError } from "../lib/errors";
import { createId } from "../lib/ids";
import { reportTypes } from "../services/reports";

const input=z.object({name:z.string().min(1).max(120),reportType:z.string(),format:z.enum(["json","csv","xlsx","pdf"]),filters:z.record(z.string(),z.union([z.string(),z.number(),z.boolean(),z.null()])).default({}),cadence:z.enum(["hourly","daily","weekly","monthly"]),recipients:z.array(z.email()).max(50).default([]),nextRunAt:z.iso.datetime()});
export const reportSchedulesRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
reportSchedulesRoutes.get("/",requireScope("reports:read"),async c=>{const p=c.get("principal");const r=await c.env.FINANCE_DB.prepare("SELECT id,name,report_type AS reportType,format,filters,cron AS cadence,recipients,active,next_run_at AS nextRunAt,last_run_at AS lastRunAt FROM report_schedules WHERE organization_id=? ORDER BY name").bind(p.organizationId).all<Record<string,unknown>>();return c.json({data:r.results.map(v=>({...v,filters:JSON.parse(String(v.filters)),recipients:JSON.parse(String(v.recipients))}))})});
reportSchedulesRoutes.post("/",requireScope("reports:write"),async c=>{const s=input.safeParse(await c.req.json());if(!s.success)throw new AppError(422,"VALIDATION_ERROR","Invalid report schedule",s.error.flatten());if(!reportTypes.includes(s.data.reportType as never))throw new AppError(422,"UNKNOWN_REPORT","Unknown report type");const p=c.get("principal"),id=createId("rsc");await c.env.FINANCE_DB.prepare(`INSERT INTO report_schedules (id,organization_id,name,report_type,format,filters,cron,recipients,next_run_at) VALUES (?,?,?,?,?,?,?,?,?)`).bind(id,p.organizationId,s.data.name,s.data.reportType,s.data.format,JSON.stringify(s.data.filters),s.data.cadence,JSON.stringify(s.data.recipients),s.data.nextRunAt).run();return c.json({data:{id,active:true,...s.data}},201)});
reportSchedulesRoutes.delete("/:id",requireScope("reports:write"),async c=>{const p=c.get("principal");await c.env.FINANCE_DB.prepare("UPDATE report_schedules SET active=0,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(c.req.param("id"),p.organizationId).run();return c.body(null,204)});
