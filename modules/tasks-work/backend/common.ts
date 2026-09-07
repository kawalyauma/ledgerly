import type { Context, MiddlewareHandler } from "hono";
import { AppError } from "../../../src/lib/errors";
import { createId } from "../../../src/lib/ids";
import type { AppVariables, Env } from "../../../src/types";

export type WorkContext = Context<{ Bindings: Env; Variables: AppVariables }>;

export function newId(prefix: string) { return createId(prefix); }
export function parseLimit(c: WorkContext, max = 500) {
  const raw = Number(c.req.query("limit") || 50);
  return Math.max(1, Math.min(Number.isFinite(raw) ? Math.trunc(raw) : 50, max));
}
export function parseOffset(c: WorkContext) {
  const raw = Number(c.req.query("offset") || 0);
  return Math.max(0, Number.isFinite(raw) ? Math.trunc(raw) : 0);
}
export function parseBool(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return fallback;
}
export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}
export function camelize(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    if (key.endsWith("_json") && typeof value === "string") out[camel.replace(/Json$/, "")] = parseJson(value, key === "tags_json" || key === "mentions_json" ? [] : {});
    else out[camel] = value;
  }
  return out;
}
export const camelizeRows = (rows: Record<string, unknown>[]) => rows.map(camelize);

export function workAccess(level: "read" | "write" | "manage" = "read"): MiddlewareHandler<{ Bindings: Env; Variables: AppVariables }> {
  return async (c, next) => {
    const p = c.get("principal");
    if (p.role === "owner" || p.role === "admin") { await next(); return; }
    const wildcard = p.scopes.includes("work:*");
    const explicit = p.scopes.includes(`work:${level}`) || (level === "read" && p.scopes.includes("work:write")) || (level !== "manage" && p.scopes.includes("work:manage"));
    // Source Tasks & Work roles rank viewer < member < manager < admin < owner.
    // Ledgerly's accountant role maps to the source "member" level; viewer remains read-only.
    const roleAllowed = level === "read"
      ? ["manager", "accountant", "viewer"].includes(p.role)
      : level === "write"
        ? ["manager", "accountant"].includes(p.role)
        : p.role === "manager";
    if (!wildcard && !explicit && !roleAllowed) throw new AppError(403, "FORBIDDEN", `Missing Tasks & Work ${level} permission`);
    await next();
  };
}

export async function requireOrgUser(db: D1Database, organizationId: string, userId: string, label = "Member") {
  const row = await db.prepare(`SELECT u.id,u.display_name AS displayName,u.email,m.role
    FROM memberships m JOIN users u ON u.id=m.user_id
    WHERE m.organization_id=? AND m.user_id=? AND u.status='active'`).bind(organizationId, userId).first<Record<string, unknown>>();
  if (!row) throw new AppError(422, "INVALID_MEMBER", `${label} is not an active member of this organization`);
  return row;
}

export async function requireTask(db: D1Database, organizationId: string, taskId: string) {
  const row = await db.prepare("SELECT * FROM work_tasks WHERE id=? AND organization_id=? AND archived_at IS NULL").bind(taskId, organizationId).first<Record<string, unknown>>();
  if (!row) throw new AppError(404, "TASK_NOT_FOUND", "Task not found");
  return row;
}
export async function requireProject(db: D1Database, organizationId: string, projectId: string) {
  const row = await db.prepare("SELECT * FROM work_projects WHERE id=? AND organization_id=? AND archived_at IS NULL").bind(projectId, organizationId).first<Record<string, unknown>>();
  if (!row) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
  return row;
}
export async function requireTeam(db: D1Database, organizationId: string, teamId: string) {
  const row = await db.prepare("SELECT * FROM work_teams WHERE id=? AND organization_id=? AND status='active'").bind(teamId, organizationId).first<Record<string, unknown>>();
  if (!row) throw new AppError(404, "TEAM_NOT_FOUND", "Team not found");
  return row;
}
export async function requireContact(db: D1Database, organizationId: string, contactId: string) {
  const row = await db.prepare(`SELECT c.*,
      (SELECT cp.phone FROM contact_people cp WHERE cp.organization_id=c.organization_id AND cp.contact_id=c.id ORDER BY cp.is_primary DESC,cp.created_at LIMIT 1) AS phone,
      (SELECT cp.name FROM contact_people cp WHERE cp.organization_id=c.organization_id AND cp.contact_id=c.id ORDER BY cp.is_primary DESC,cp.created_at LIMIT 1) AS primary_person_name
    FROM contacts c WHERE c.id=? AND c.organization_id=? AND c.archived_at IS NULL AND c.active=1`).bind(contactId, organizationId).first<Record<string, unknown>>();
  if (!row) throw new AppError(404, "CONTACT_NOT_FOUND", "Ledgerly contact not found");
  return row;
}

export async function nextTaskNumber(db: D1Database, organizationId: string): Promise<number> {
  await db.prepare(`INSERT INTO work_sequences (organization_id,sequence_name,current_value) VALUES (?,'task',1)
    ON CONFLICT(organization_id,sequence_name) DO UPDATE SET current_value=current_value+1`).bind(organizationId).run();
  const row = await db.prepare("SELECT current_value AS currentValue FROM work_sequences WHERE organization_id=? AND sequence_name='task'").bind(organizationId).first<{currentValue:number}>();
  return Number(row?.currentValue || 1);
}

export async function auditWork(db: D1Database, c: WorkContext, action: string, entityType: string, entityId: string, before?: unknown, after?: unknown) {
  const p = c.get("principal");
  const requestId = c.get("requestId" as never) as string | undefined;
  await db.prepare(`INSERT INTO audit_logs
    (id,organization_id,actor_id,action,entity_type,entity_id,request_id,before,after)
    VALUES (?,?,?,?,?,?,?,?,?)`).bind(
      newId("aud"),p.organizationId,p.userId,action,entityType,entityId,requestId ?? null,
      before == null ? null : JSON.stringify(before),after == null ? null : JSON.stringify(after),
    ).run();
}

export function cleanString(value: unknown, max = 10000) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}
export function requiredString(value: unknown, field: string, max = 500) {
  const text = cleanString(value, max);
  if (!text) throw new AppError(422, "VALIDATION_ERROR", `${field} is required`);
  return text;
}
