import { Hono } from "hono";
import { z } from "zod";
import type { AppVariables, Env } from "../types";
import { requireScope } from "../lib/auth";
import { AppError } from "../lib/errors";
import { pagination } from "../lib/http";
import { allocatePostedPayment, createPayment, postPayment, reversePayment } from "../services/payments";
import { auditStatement } from "../services/audit";
import { publishWebhookEvent } from "../services/webhooks";
import { requireModuleEnabled } from "../lib/modules";
import { getEnabledModules } from "../lib/enabled-modules";

const input = z.object({
  type: z.enum(["receipt", "payment"]), number: z.string().min(1).max(60), contactId: z.string(), bankAccountId: z.string(),
  controlAccountId: z.string(), paymentDate: z.iso.date(), currency: z.string().length(3).toUpperCase(),
  amountMinor: z.number().int().positive(), reference: z.string().max(100).optional(),
});
const posting = z.object({ allocations: z.array(z.object({ documentId: z.string(), amountMinor: z.number().int().positive() })).max(500).default([]) });
const reversal = z.object({ postingDate: z.iso.date(), reason: z.string().trim().min(3).max(500) });
export const paymentsRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();
paymentsRoutes.use("*",requireModuleEnabled("payroll-payments"));
paymentsRoutes.get("/manifest",requireScope("payments:read"),async c=>{const p=c.get("principal"),modules=await getEnabledModules(c.env.FINANCE_DB,p.organizationId);return c.json({data:{key:"payroll-payments",area:"payments",enabledModules:modules.map(m=>({key:m.key,name:m.name})),counterpartySources:modules.filter(m=>["contacts","school-management","human-resources"].includes(m.key)).map(m=>m.key)}})});

paymentsRoutes.get("/counterparties",requireScope("payments:read"),async c=>{
  const p=c.get("principal"),modules=await getEnabledModules(c.env.FINANCE_DB,p.organizationId),keys=new Set(modules.map(m=>m.key));
  const contacts=await c.env.FINANCE_DB.prepare("SELECT id,name,code,email,type FROM contacts WHERE organization_id=? AND active=1 AND archived_at IS NULL ORDER BY name").bind(p.organizationId).all<any>();
  const sources=new Map<string,Set<string>>();
  const add=(id:string,source:string)=>{const set=sources.get(id)||new Set<string>();set.add(source);sources.set(id,set)};
  for(const contact of contacts.results)add(contact.id,"contacts");
  if(keys.has("school-management")){
    const rows=await c.env.FINANCE_DB.prepare("SELECT contact_id AS contactId FROM school_guardians WHERE organization_id=? AND contact_id IS NOT NULL UNION SELECT contact_id FROM school_staff_profiles WHERE organization_id=? AND contact_id IS NOT NULL").bind(p.organizationId,p.organizationId).all<any>();
    for(const row of rows.results)add(row.contactId,"school-management");
  }
  if(keys.has("human-resources")){
    const rows=await c.env.FINANCE_DB.prepare("SELECT contact_id AS contactId FROM hr_employees WHERE organization_id=? AND contact_id IS NOT NULL").bind(p.organizationId).all<any>();
    for(const row of rows.results)add(row.contactId,"human-resources");
  }
  return c.json({data:contacts.results.map(contact=>({...contact,sourceModules:[...(sources.get(contact.id)||new Set(["contacts"]))]}))});
});

paymentsRoutes.get("/", requireScope("payments:read"), async (c) => {
  const p = c.get("principal"); const { limit, offset } = pagination(c);
  const result = await c.env.FINANCE_DB.prepare(`SELECT p.id,p.type,p.number,p.payment_date AS paymentDate,p.currency,
    p.amount_minor AS amountMinor,p.reference,p.status,c.name AS contact,p.journal_entry_id AS journalEntryId
    FROM payments p JOIN contacts c ON c.id=p.contact_id AND c.organization_id=p.organization_id
    WHERE p.organization_id=? ORDER BY p.payment_date DESC,p.number DESC LIMIT ? OFFSET ?`).bind(p.organizationId, limit, offset).all();
  return c.json({ data: result.results, pagination: { limit, offset } });
});
paymentsRoutes.post("/", requireScope("payments:write"), async (c) => {
  const key = c.req.header("Idempotency-Key");
  if (!key || key.length > 200) throw new AppError(422, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required");
  const parsed = input.safeParse(await c.req.json());
  if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid payment", parsed.error.flatten());
  const p = c.get("principal");
  return c.json({ data: await createPayment(c.env.FINANCE_DB, p.organizationId, p.userId, parsed.data, key) }, 201);
});
paymentsRoutes.post("/:id/post", requireScope("payments:write"), async (c) => {
  const parsed = posting.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid allocations", parsed.error.flatten());
  const p = c.get("principal");
  const result=await postPayment(c.env.FINANCE_DB, p.organizationId, p.userId, c.req.param("id"), parsed.data.allocations);
  c.executionCtx.waitUntil(publishWebhookEvent(c.env,p.organizationId,"payment.posted",result));
  return c.json({ data: result });
});
paymentsRoutes.post("/:id/reverse", requireScope("payments:write"), async (c) => {
  const parsed = reversal.safeParse(await c.req.json());
  if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "A posting date and reason are required", parsed.error.flatten());
  const p = c.get("principal");
  const result=await reversePayment(c.env.FINANCE_DB, p.organizationId, p.userId, c.req.param("id"), parsed.data.postingDate, parsed.data.reason);
  c.executionCtx.waitUntil(publishWebhookEvent(c.env,p.organizationId,"payment.reversed",result));
  return c.json({ data: result });
});
paymentsRoutes.post("/:id/allocations",requireScope("payments:write"),async c=>{const parsed=posting.safeParse(await c.req.json());if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid allocations",parsed.error.flatten());const p=c.get("principal");return c.json({data:await allocatePostedPayment(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"),parsed.data.allocations)})});
paymentsRoutes.delete("/:id", requireScope("payments:write"), async (c) => {
  const p=c.get("principal"); const id=c.req.param("id");
  const payment=await c.env.FINANCE_DB.prepare("SELECT status FROM payments WHERE id=? AND organization_id=?").bind(id,p.organizationId).first<{status:string}>();
  if(!payment)throw new AppError(404,"NOT_FOUND","Payment not found");
  if(payment.status!=="draft")throw new AppError(409,"IMMUTABLE_POSTED_TRANSACTION","Posted payments must be reversed, not deleted");
  await c.env.FINANCE_DB.batch([
    c.env.FINANCE_DB.prepare("DELETE FROM payments WHERE id=? AND organization_id=? AND status='draft'").bind(id,p.organizationId),
    auditStatement(c.env.FINANCE_DB,{organizationId:p.organizationId,actorId:p.userId,action:"payment.draft_deleted",entityType:"payment",entityId:id}),
  ]);
  return c.body(null,204);
});
