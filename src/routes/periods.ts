import { Hono } from "hono";
import { z } from "zod";
import type { AppVariables, Env } from "../types";
import { requireScope } from "../lib/auth";
import { AppError } from "../lib/errors";
import { createId } from "../lib/ids";
import { auditStatement } from "../services/audit";

const createInput = z.object({ name: z.string().trim().min(1).max(80), startsOn: z.iso.date(), endsOn: z.iso.date() });
const statusInput = z.object({ status: z.enum(["open", "soft_closed", "locked"]), reason: z.string().trim().min(3).max(500).optional() });
export const periodsRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

periodsRoutes.get("/", requireScope("periods:read"), async (c) => {
  const p = c.get("principal");
  const result = await c.env.FINANCE_DB.prepare(`SELECT id,name,starts_on AS startsOn,ends_on AS endsOn,status,
    locked_at AS lockedAt,locked_by AS lockedBy FROM fiscal_periods WHERE organization_id=? ORDER BY starts_on DESC`)
    .bind(p.organizationId).all();
  return c.json({ data: result.results });
});
periodsRoutes.post("/", requireScope("periods:write"), async (c) => {
  const parsed = createInput.safeParse(await c.req.json());
  if (!parsed.success || parsed.data.startsOn > parsed.data.endsOn) throw new AppError(422, "VALIDATION_ERROR", "A valid non-empty period range is required", parsed.success ? undefined : parsed.error.flatten());
  const p = c.get("principal"); const v = parsed.data;
  const overlap = await c.env.FINANCE_DB.prepare(`SELECT id FROM fiscal_periods WHERE organization_id=? AND starts_on<=? AND ends_on>=? LIMIT 1`)
    .bind(p.organizationId, v.endsOn, v.startsOn).first();
  if (overlap) throw new AppError(409, "PERIOD_OVERLAP", "Fiscal periods cannot overlap");
  const id = createId("fpd");
  await c.env.FINANCE_DB.batch([
    c.env.FINANCE_DB.prepare("INSERT INTO fiscal_periods (id,organization_id,name,starts_on,ends_on,status) VALUES (?,?,?,?,?,'open')").bind(id,p.organizationId,v.name,v.startsOn,v.endsOn),
    auditStatement(c.env.FINANCE_DB,{organizationId:p.organizationId,actorId:p.userId,action:"fiscal_period.created",entityType:"fiscal_period",entityId:id,after:v}),
  ]);
  return c.json({ data: { id, ...v, status: "open" } }, 201);
});
periodsRoutes.patch("/:id/status", requireScope("periods:write"), async (c) => {
  const parsed = statusInput.safeParse(await c.req.json());
  if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid period status", parsed.error.flatten());
  const p = c.get("principal");
  const existing = await c.env.FINANCE_DB.prepare("SELECT status FROM fiscal_periods WHERE id=? AND organization_id=?").bind(c.req.param("id"),p.organizationId).first<{status:string}>();
  if (!existing) throw new AppError(404,"NOT_FOUND","Fiscal period not found");
  if (existing.status === "locked" && parsed.data.status !== "locked") {
    if (!["owner", "admin"].includes(p.role)) throw new AppError(403, "FORBIDDEN", "Only an owner or administrator can reopen a locked period");
    if (!parsed.data.reason) throw new AppError(422, "REOPEN_REASON_REQUIRED", "A reason is required to reopen a locked period");
  }
  await c.env.FINANCE_DB.batch([
    c.env.FINANCE_DB.prepare(`UPDATE fiscal_periods SET status=?,locked_at=CASE WHEN ?='locked' THEN CURRENT_TIMESTAMP ELSE NULL END,
      locked_by=CASE WHEN ?='locked' THEN ? ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`)
      .bind(parsed.data.status,parsed.data.status,parsed.data.status,p.userId,c.req.param("id"),p.organizationId),
    auditStatement(c.env.FINANCE_DB,{organizationId:p.organizationId,actorId:p.userId,action:"fiscal_period.status_changed",entityType:"fiscal_period",entityId:c.req.param("id"),after:{from:existing.status,to:parsed.data.status,reason:parsed.data.reason}}),
  ]);
  return c.json({ data: { id: c.req.param("id"), status: parsed.data.status } });
});
