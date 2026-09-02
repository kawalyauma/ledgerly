import { Hono } from "hono";
import { z } from "zod";
import type { AppVariables, Env } from "../types";
import { AppError } from "../lib/errors";
import { createId } from "../lib/ids";
import { pagination } from "../lib/http";
import { auditStatement } from "../services/audit";
import { requireScope } from "../lib/auth";

const input = z.object({
  type: z.enum(["customer", "supplier", "employee", "other"]), code: z.string().max(30).optional(),
  name: z.string().trim().min(1).max(160), email: z.email().optional(), taxNumber: z.string().max(60).optional(),
  paymentTermsDays: z.number().int().min(0).max(365).default(0), customFields: z.record(z.string(), z.unknown()).default({}),
  creditLimitMinor:z.number().int().nonnegative().default(0),pricingTier:z.string().max(60).nullable().optional(),active:z.boolean().default(true),
});

export const contactsRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

contactsRoutes.get("/", requireScope("contacts:read"), async (c) => {
  const p = c.get("principal");
  const { limit, offset } = pagination(c);
  const type = c.req.query("type");
  const result = await c.env.FINANCE_DB.prepare(`SELECT id,type,code,name,email,tax_number AS taxNumber,payment_terms_days AS paymentTermsDays,
    active,credit_limit_minor AS creditLimitMinor,pricing_tier AS pricingTier,custom_fields AS customFields,created_at AS createdAt FROM contacts WHERE organization_id=? AND archived_at IS NULL ${type ? "AND type=?" : ""} ORDER BY name LIMIT ? OFFSET ?`)
    .bind(p.organizationId, ...(type ? [type] : []), limit, offset).all<Record<string, unknown>>();
  return c.json({ data: result.results.map((row) => ({ ...row, customFields: JSON.parse(String(row.customFields)) })), pagination: { limit, offset } });
});

contactsRoutes.post("/", requireScope("contacts:write"), async (c) => {
  const parsed = input.safeParse(await c.req.json());
  if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid contact", parsed.error.flatten());
  const p = c.get("principal");
  const id = createId("con");
  const value = parsed.data;
  await c.env.FINANCE_DB.batch([
    c.env.FINANCE_DB.prepare(`INSERT INTO contacts (id,organization_id,type,code,name,email,tax_number,payment_terms_days,custom_fields,credit_limit_minor,pricing_tier,active)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,p.organizationId,value.type,value.code??null,value.name,value.email?.toLowerCase()??null,value.taxNumber??null,value.paymentTermsDays,JSON.stringify(value.customFields),value.creditLimitMinor,value.pricingTier??null,value.active),
    auditStatement(c.env.FINANCE_DB,{organizationId:p.organizationId,actorId:p.userId,action:"contact.created",entityType:"contact",entityId:id,after:value}),
  ]);
  return c.json({ data: { id, ...value } }, 201);
});
contactsRoutes.put("/:id",requireScope("contacts:write"),async c=>{const s=input.safeParse(await c.req.json());if(!s.success)throw new AppError(422,"VALIDATION_ERROR","Invalid contact",s.error.flatten());const p=c.get("principal"),v=s.data,r=await c.env.FINANCE_DB.prepare(`UPDATE contacts SET type=?,code=?,name=?,email=?,tax_number=?,payment_terms_days=?,custom_fields=?,credit_limit_minor=?,pricing_tier=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND archived_at IS NULL`).bind(v.type,v.code??null,v.name,v.email?.toLowerCase()??null,v.taxNumber??null,v.paymentTermsDays,JSON.stringify(v.customFields),v.creditLimitMinor,v.pricingTier??null,v.active,c.req.param("id"),p.organizationId).run();if(!r.meta.changes)throw new AppError(404,"NOT_FOUND","Contact not found");return c.json({data:{id:c.req.param("id"),...v}})});
contactsRoutes.delete("/:id",requireScope("contacts:write"),async c=>{const p=c.get("principal"),id=c.req.param("id");const used=await c.env.FINANCE_DB.prepare("SELECT 1 FROM documents WHERE organization_id=? AND contact_id=? LIMIT 1").bind(p.organizationId,id).first();if(used)throw new AppError(409,"CONTACT_IN_USE","Contact has financial history; archive it instead");await c.env.FINANCE_DB.prepare("DELETE FROM contacts WHERE id=? AND organization_id=?").bind(id,p.organizationId).run();return c.body(null,204)});
contactsRoutes.post("/:id/archive",requireScope("contacts:write"),async c=>{const p=c.get("principal");await c.env.FINANCE_DB.prepare("UPDATE contacts SET active=0,archived_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(c.req.param("id"),p.organizationId).run();return c.json({data:{id:c.req.param("id"),status:"archived"}})});
contactsRoutes.post("/:id/merge",requireScope("contacts:write"),async c=>{const s=z.object({targetContactId:z.string()}).safeParse(await c.req.json()),p=c.get("principal"),source=c.req.param("id");if(!s.success||s.data.targetContactId===source)throw new AppError(422,"VALIDATION_ERROR","Invalid merge target");const target=s.data.targetContactId;const found=await c.env.FINANCE_DB.prepare("SELECT COUNT(*) AS n FROM contacts WHERE organization_id=? AND id IN (?,?)").bind(p.organizationId,source,target).first<{n:number}>();if(Number(found?.n)!==2)throw new AppError(404,"NOT_FOUND","Contact not found");await c.env.FINANCE_DB.batch([c.env.FINANCE_DB.prepare("UPDATE documents SET contact_id=? WHERE organization_id=? AND contact_id=?").bind(target,p.organizationId,source),c.env.FINANCE_DB.prepare("UPDATE payments SET contact_id=? WHERE organization_id=? AND contact_id=?").bind(target,p.organizationId,source),c.env.FINANCE_DB.prepare("UPDATE journal_lines SET contact_id=? WHERE organization_id=? AND contact_id=?").bind(target,p.organizationId,source),c.env.FINANCE_DB.prepare("UPDATE contacts SET active=0,archived_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(source,p.organizationId)]);return c.json({data:{sourceContactId:source,targetContactId:target,status:"merged"}})});
const address=z.object({type:z.enum(["billing","shipping","registered","other"]),line1:z.string().min(1),line2:z.string().optional(),city:z.string().optional(),state:z.string().optional(),postalCode:z.string().optional(),country:z.string().length(2),isDefault:z.boolean().default(false)});
contactsRoutes.get("/:id/addresses",requireScope("contacts:read"),async c=>{const p=c.get("principal"),r=await c.env.FINANCE_DB.prepare("SELECT id,type,line1,line2,city,state,postal_code AS postalCode,country,is_default AS isDefault FROM contact_addresses WHERE organization_id=? AND contact_id=?").bind(p.organizationId,c.req.param("id")).all();return c.json({data:r.results})});
contactsRoutes.post("/:id/addresses",requireScope("contacts:write"),async c=>{const s=address.safeParse(await c.req.json());if(!s.success)throw new AppError(422,"VALIDATION_ERROR","Invalid address",s.error.flatten());const p=c.get("principal"),id=createId("adr"),v=s.data;await c.env.FINANCE_DB.prepare("INSERT INTO contact_addresses(id,organization_id,contact_id,type,line1,line2,city,state,postal_code,country,is_default) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(id,p.organizationId,c.req.param("id"),v.type,v.line1,v.line2??null,v.city??null,v.state??null,v.postalCode??null,v.country,v.isDefault).run();return c.json({data:{id,...v}},201)});
contactsRoutes.post("/:id/people",requireScope("contacts:write"),async c=>{const s=z.object({name:z.string().min(1),email:z.email().optional(),phone:z.string().max(40).optional(),role:z.string().max(80).optional(),isPrimary:z.boolean().default(false)}).safeParse(await c.req.json());if(!s.success)throw new AppError(422,"VALIDATION_ERROR","Invalid contact person",s.error.flatten());const p=c.get("principal"),id=createId("cpr"),v=s.data;await c.env.FINANCE_DB.prepare("INSERT INTO contact_people(id,organization_id,contact_id,name,email,phone,role,is_primary) VALUES(?,?,?,?,?,?,?,?)").bind(id,p.organizationId,c.req.param("id"),v.name,v.email??null,v.phone??null,v.role??null,v.isPrimary).run();return c.json({data:{id,...v}},201)});
