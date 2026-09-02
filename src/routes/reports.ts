import { Hono } from "hono";
import type { AppVariables, Env, ReportJobMessage } from "../types";
import { requireScope } from "../lib/auth";
import { AppError } from "../lib/errors";
import { createId } from "../lib/ids";
import { generateReport, reportTypes } from "../services/reports";

export const reportsRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

reportsRoutes.get("/", requireScope("reports:read"), (c) => c.json({ data: reportTypes.map((id) => ({ id })) }));

reportsRoutes.get("/:type", requireScope("reports:read"), async (c) => {
  const p = c.get("principal");
  const filters = {
    from: c.req.query("from"), to: c.req.query("to"), asOf: c.req.query("asOf"), accountId: c.req.query("accountId"),
    contactId: c.req.query("contactId"), projectId: c.req.query("projectId"),
  };
  const report = await generateReport(c.env.FINANCE_DB, p.organizationId, c.req.param("type"), filters);
  return c.json({ data: report });
});

reportsRoutes.post("/:type/exports", requireScope("reports:write"), async (c) => {
  const type = c.req.param("type");
  if (!reportTypes.includes(type as never)) throw new AppError(404, "UNKNOWN_REPORT", "Unknown report type");
  const p = c.get("principal");
  const body: { format?: "json" | "csv" | "xlsx" | "pdf"; filters?: Record<string, string | number | boolean | null> } =
    await c.req.json<{ format?: "json" | "csv" | "xlsx" | "pdf"; filters?: Record<string, string | number | boolean | null> }>().catch(() => ({}));
  const format = body.format ?? "csv";
  if (!(["json", "csv", "xlsx", "pdf"] as const).includes(format)) throw new AppError(422, "INVALID_FORMAT", "Format must be json, csv, xlsx or pdf");
  const filters=Object.fromEntries(Object.entries(body.filters??{}).filter(([,value])=>value!==""&&value!=null));
  const id = createId("rpt");
  await c.env.FINANCE_DB.prepare(`INSERT INTO report_jobs (id, organization_id, requested_by, report_type, format, filters, status)
    VALUES (?, ?, ?, ?, ?, ?, 'queued')`).bind(id, p.organizationId, p.userId, type, format, JSON.stringify(filters)).run();
  const message: ReportJobMessage = { jobId: id, organizationId: p.organizationId, reportType: type, format, filters };
  await c.env.REPORT_QUEUE.send(message, { contentType: "json" });
  return c.json({ data: { id, status: "queued" } }, 202);
});

reportsRoutes.get("/exports/:id/status", requireScope("reports:read"), async (c) => {
  const p = c.get("principal");
  const job = await c.env.FINANCE_DB.prepare(`SELECT id, report_type AS reportType, format, status, object_key AS objectKey,
    error, created_at AS createdAt, completed_at AS completedAt FROM report_jobs WHERE id = ? AND organization_id = ?`)
    .bind(c.req.param("id"), p.organizationId).first();
  if (!job) throw new AppError(404, "NOT_FOUND", "Report job not found");
  return c.json({ data: job });
});

reportsRoutes.get("/exports/:id/download", requireScope("reports:read"), async (c) => {
  const p = c.get("principal");
  const job = await c.env.FINANCE_DB.prepare("SELECT object_key AS objectKey, format FROM report_jobs WHERE id = ? AND organization_id = ? AND status = 'completed'")
    .bind(c.req.param("id"), p.organizationId).first<{ objectKey: string; format: string }>();
  if (!job?.objectKey) throw new AppError(404, "REPORT_NOT_READY", "Completed report not found");
  const object = await c.env.REPORTS_BUCKET.get(job.objectKey);
  if (!object) throw new AppError(404, "FILE_NOT_FOUND", "Report file not found");
  const contentTypes:Record<string,string>={csv:"text/csv; charset=utf-8",json:"application/json",xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",pdf:"application/pdf"};
  c.header("Content-Type", contentTypes[job.format]??"application/octet-stream");
  c.header("Content-Disposition", `attachment; filename="${c.req.param("id")}.${job.format}"`);
  return c.body(object.body);
});
