import { z } from "zod";
import type { Context, MiddlewareHandler } from "hono";
import type { AppVariables, Env } from "../../../src/types";
import { AppError } from "../../../src/lib/errors";
import { createId } from "../../../src/lib/ids";
import { auditStatement } from "../../../src/services/audit";

export type SchoolContext = Context<{ Bindings: Env; Variables: AppVariables }>;

export const id = z.string().min(3).max(100);
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const optionalDate = date.optional().nullable();
export const jsonObject = z.record(z.string(), z.unknown()).default({});

export function parseLimit(c: SchoolContext, max = 500) {
  const raw = Number(c.req.query("limit") || 100);
  return Math.max(1, Math.min(Number.isFinite(raw) ? Math.trunc(raw) : 100, max));
}
export function parseOffset(c: SchoolContext) {
  const raw = Number(c.req.query("offset") || 0);
  return Math.max(0, Number.isFinite(raw) ? Math.trunc(raw) : 0);
}
export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}
export function camelizeRow(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    if (key.endsWith("_json") && typeof value === "string") out[camel.replace(/Json$/, "")] = parseJson(value, {});
    else out[camel] = value;
  }
  return out;
}
export function camelizeRows(rows: Record<string, unknown>[]) { return rows.map(camelizeRow); }

export async function requireOrgEntity(db: D1Database, table: string, entityId: string | null | undefined, organizationId: string, label = "Referenced record") {
  if (!entityId) return;
  const allowed = new Set([
    "school_branches","school_academic_years","school_terms","school_departments","school_class_levels","school_classes","school_streams","school_subjects","school_grading_scales","school_assessment_types","school_roles","school_students","school_guardians","accounts","products","contacts","users"
  ]);
  if (!allowed.has(table)) throw new Error("Unsafe entity table");
  if (table === "users") {
    const found = await db.prepare("SELECT 1 FROM memberships WHERE organization_id=? AND user_id=?").bind(organizationId, entityId).first();
    if (!found) throw new AppError(422, "INVALID_REFERENCE", `${label} does not belong to this organization`);
    return;
  }
  const found = await db.prepare(`SELECT 1 FROM ${table} WHERE id=? AND organization_id=?`).bind(entityId, organizationId).first();
  if (!found) throw new AppError(422, "INVALID_REFERENCE", `${label} does not belong to this organization`);
}

export async function audit(db: D1Database, c: SchoolContext, action: string, entityType: string, entityId: string, after?: unknown) {
  const p = c.get("principal");
  await auditStatement(db, { organizationId: p.organizationId, actorId: p.userId, action, entityType, entityId, requestId: c.get("requestId" as never), after }).run();
}

export function schoolPermission(permission: string): MiddlewareHandler<{ Bindings: Env; Variables: AppVariables }> {
  return async (c, next) => {
    const p = c.get("principal");
    if (p.role === "owner" || p.role === "admin") { await next(); return; }
    const direct = p.scopes.includes(permission) || p.scopes.includes("school:*") || (p.scopes.includes("school:write") && (permission.endsWith(":write") || permission.endsWith(":approve") || permission.endsWith(":export")));
    if (direct) { await next(); return; }
    const row = await c.env.FINANCE_DB.prepare(`SELECT 1
      FROM school_user_roles ur
      JOIN school_role_permissions rp ON rp.organization_id=ur.organization_id AND rp.role_id=ur.role_id
      WHERE ur.organization_id=? AND ur.user_id=? AND rp.permission=? AND rp.effect='allow'
        AND (ur.starts_at IS NULL OR ur.starts_at<=CURRENT_TIMESTAMP)
        AND (ur.ends_at IS NULL OR ur.ends_at>=CURRENT_TIMESTAMP)
      UNION ALL
      SELECT 1 FROM school_temporary_permissions tp
      WHERE tp.organization_id=? AND tp.user_id=? AND tp.permission=? AND tp.revoked_at IS NULL
        AND tp.starts_at<=CURRENT_TIMESTAMP AND tp.ends_at>=CURRENT_TIMESTAMP
      LIMIT 1`).bind(p.organizationId,p.userId,permission,p.organizationId,p.userId,permission).first();
    if (!row) throw new AppError(403, "FORBIDDEN", `Missing school permission: ${permission}`);
    await next();
  };
}

export async function uniqueNumber(db: D1Database, organizationId: string, entity: "application"|"admission"|"student"|"staff", prefixFallback: string) {
  const setting = await db.prepare("SELECT value_json AS value FROM school_settings WHERE organization_id=? AND setting_group='numbering' AND setting_key=?").bind(organizationId, `${entity}_format`).first<{value:string}>();
  const config = setting ? parseJson<Record<string, unknown>>(setting.value, {}) : {};
  const prefix = String(config.prefix || prefixFallback);
  const width = Math.max(3, Math.min(Number(config.width || 6), 12));
  const year = new Date().getUTCFullYear();
  const table = entity === "application" ? "school_admission_applications" : "school_students";
  const col = entity === "application" ? "application_number" : entity === "admission" ? "admission_number" : "student_number";
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE organization_id=?`).bind(organizationId).first<{count:number}>();
  const seq = Number(row?.count || 0) + 1;
  return `${prefix}${year}${String(seq).padStart(width, "0")}`;
}

export function newId(prefix: string) { return createId(prefix); }
