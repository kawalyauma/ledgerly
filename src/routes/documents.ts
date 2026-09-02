import { Hono } from "hono";
import { z } from "zod";
import type { AppVariables, Env } from "../types";
import { requireScope } from "../lib/auth";
import { AppError } from "../lib/errors";
import { pagination } from "../lib/http";
import { createDocument, postDocument, reverseDocument } from "../services/documents";
import { auditStatement } from "../services/audit";
import { publishWebhookEvent } from "../services/webhooks";

const line = z.object({
  productId: z.string().optional(), accountId: z.string(), taxAccountId: z.string().optional(), description: z.string().min(1).max(500),
  quantityMicros: z.number().int().positive().default(1_000_000), unitPriceMinor: z.number().int().nonnegative(),
  taxMinor: z.number().int().nonnegative().default(0), projectId: z.string().optional(),
});
const input = z.object({
  type: z.enum(["invoice", "bill", "credit_note", "supplier_credit"]), number: z.string().min(1).max(60), contactId: z.string(),
  issueDate: z.iso.date(), dueDate: z.iso.date().optional(), currency: z.string().length(3).toUpperCase(),
  customFields: z.record(z.string(), z.unknown()).optional(), lines: z.array(line).min(1).max(500),
});
const posting = z.object({ controlAccountId: z.string() });
const reversal = z.object({ postingDate: z.iso.date(), reason: z.string().trim().min(3).max(500) });
export const documentsRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

documentsRoutes.get("/", requireScope("documents:read"), async (c) => {
  const p = c.get("principal"); const { limit, offset } = pagination(c); const type = c.req.query("type");
  const result = await c.env.FINANCE_DB.prepare(`SELECT d.id,d.type,d.number,d.issue_date AS issueDate,d.due_date AS dueDate,
    d.status,d.currency,d.subtotal_minor AS subtotalMinor,d.tax_minor AS taxMinor,d.total_minor AS totalMinor,d.paid_minor AS paidMinor,
    c.name AS contact FROM documents d LEFT JOIN contacts c ON c.id=d.contact_id AND c.organization_id=d.organization_id
    WHERE d.organization_id=? ${type ? "AND d.type=?" : ""} ORDER BY d.issue_date DESC,d.number DESC LIMIT ? OFFSET ?`)
    .bind(p.organizationId, ...(type ? [type] : []), limit, offset).all();
  return c.json({ data: result.results, pagination: { limit, offset } });
});
documentsRoutes.get("/:id", requireScope("documents:read"), async (c) => {
  const p = c.get("principal");
  const doc = await c.env.FINANCE_DB.prepare("SELECT * FROM documents WHERE id=? AND organization_id=?").bind(c.req.param("id"), p.organizationId).first();
  if (!doc) throw new AppError(404, "NOT_FOUND", "Document not found");
  const lines = await c.env.FINANCE_DB.prepare("SELECT * FROM document_lines WHERE document_id=? AND organization_id=? ORDER BY id").bind(c.req.param("id"), p.organizationId).all();
  return c.json({ data: { ...doc, lines: lines.results } });
});
documentsRoutes.post("/", requireScope("documents:write"), async (c) => {
  const parsed = input.safeParse(await c.req.json());
  if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid document", parsed.error.flatten());
  const p = c.get("principal");
  return c.json({ data: await createDocument(c.env.FINANCE_DB, p.organizationId, p.userId, parsed.data) }, 201);
});
documentsRoutes.post("/:id/post", requireScope("documents:write"), async (c) => {
  const parsed = posting.safeParse(await c.req.json());
  if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Control account is required", parsed.error.flatten());
  const p = c.get("principal");
  const result=await postDocument(c.env.FINANCE_DB, p.organizationId, p.userId, c.req.param("id"), parsed.data.controlAccountId);
  c.executionCtx.waitUntil(publishWebhookEvent(c.env,p.organizationId,"document.posted",result));
  return c.json({ data: result });
});
documentsRoutes.post("/:id/reverse", requireScope("documents:write"), async (c) => {
  const parsed = reversal.safeParse(await c.req.json());
  if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "A posting date and reason are required", parsed.error.flatten());
  const p = c.get("principal");
  const result=await reverseDocument(c.env.FINANCE_DB, p.organizationId, p.userId, c.req.param("id"), parsed.data.postingDate, parsed.data.reason);
  c.executionCtx.waitUntil(publishWebhookEvent(c.env,p.organizationId,"document.reversed",result));
  return c.json({ data: result });
});
documentsRoutes.delete("/:id", requireScope("documents:write"), async (c) => {
  const p=c.get("principal"); const id=c.req.param("id");
  const doc=await c.env.FINANCE_DB.prepare("SELECT status FROM documents WHERE id=? AND organization_id=?").bind(id,p.organizationId).first<{status:string}>();
  if(!doc)throw new AppError(404,"NOT_FOUND","Document not found");
  if(doc.status!=="draft")throw new AppError(409,"IMMUTABLE_POSTED_TRANSACTION","Posted documents must be reversed, not deleted");
  await c.env.FINANCE_DB.batch([
    c.env.FINANCE_DB.prepare("DELETE FROM document_lines WHERE document_id=? AND organization_id=?").bind(id,p.organizationId),
    c.env.FINANCE_DB.prepare("DELETE FROM documents WHERE id=? AND organization_id=? AND status='draft'").bind(id,p.organizationId),
    auditStatement(c.env.FINANCE_DB,{organizationId:p.organizationId,actorId:p.userId,action:"document.draft_deleted",entityType:"document",entityId:id}),
  ]);
  return c.body(null,204);
});
