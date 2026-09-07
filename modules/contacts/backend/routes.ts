import { Hono } from "hono";
import { z } from "zod";
import { moduleCatalog } from "../../catalog.generated";
import type { AppVariables, Env } from "../../../src/types";
import { AppError } from "../../../src/lib/errors";
import { createId } from "../../../src/lib/ids";
import { pagination } from "../../../src/lib/http";
import { requireScope } from "../../../src/lib/auth";
import { auditStatement } from "../../../src/services/audit";

const input = z.object({
  type: z.enum(["customer", "supplier", "employee", "other"]), code: z.string().max(30).optional(),
  name: z.string().trim().min(1).max(160), email: z.email().optional(), taxNumber: z.string().max(60).optional(),
  paymentTermsDays: z.number().int().min(0).max(365).default(0), customFields: z.record(z.string(), z.unknown()).default({}),
  creditLimitMinor: z.number().int().nonnegative().default(0), pricingTier: z.string().max(60).nullable().optional(), active: z.boolean().default(true),
});
const address = z.object({ type: z.enum(["billing", "shipping", "registered", "other"]), line1: z.string().min(1), line2: z.string().optional(), city: z.string().optional(), state: z.string().optional(), postalCode: z.string().optional(), country: z.string().length(2), isDefault: z.boolean().default(false) });

type CatalogModule = (typeof moduleCatalog)[number];
type Person = { id: string; entityId: string; sourceModule: string; group: string; name: string; email?: string | null; phone?: string | null; code?: string | null; active: boolean; contactId?: string | null; channels?: string[] };

async function enabledModules(db: D1Database, organizationId: string) {
  const overrides = await db.prepare("SELECT module_key AS moduleKey,enabled FROM organization_modules WHERE organization_id=?").bind(organizationId).all<{ moduleKey: string; enabled: number }>();
  const configured = new Map(overrides.results.map(row => [row.moduleKey, Boolean(row.enabled)]));
  return moduleCatalog.filter(module => module.active && (module.core || configured.get(module.key) === true));
}

function sourceDefinition(module: CatalogModule) {
  if (module.key === "ledgerly-core") return { moduleKey: module.key, name: module.name, groups: ["customer", "supplier", "employee", "other"], channels: [] as string[] };
  if (module.key === "communications") return { moduleKey: module.key, name: module.name, groups: ["sms_recipient"], channels: [...module.manifest.channels] };
  if (module.key === "school-management") return { moduleKey: module.key, name: module.name, groups: ["student", "guardian", "staff"], channels: [] as string[] };
  if (module.key === "tasks-work") return { moduleKey: module.key, name: module.name, groups: ["organization_user"], channels: [] as string[] };
  return null;
}

export const contactsRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

contactsRoutes.get("/capabilities", requireScope("contacts:read"), async c => {
  const p = c.get("principal"), enabled = await enabledModules(c.env.FINANCE_DB, p.organizationId);
  return c.json({ data: { enabledModules: enabled.map(module => ({ key: module.key, name: module.name, category: module.category })), sources: enabled.map(sourceDefinition).filter(Boolean) } });
});

contactsRoutes.get("/people", requireScope("contacts:read"), async c => {
  const p = c.get("principal"), enabled = await enabledModules(c.env.FINANCE_DB, p.organizationId), keys = new Set(enabled.map(module => module.key));
  const people: Person[] = [];
  if (keys.has("ledgerly-core")) {
    const rows = await c.env.FINANCE_DB.prepare(`SELECT c.id,c.type,c.code,c.name,c.email,c.active,
      (SELECT cp.phone FROM contact_people cp WHERE cp.organization_id=c.organization_id AND cp.contact_id=c.id ORDER BY cp.is_primary DESC,cp.created_at LIMIT 1) AS phone
      FROM contacts c WHERE c.organization_id=? AND c.archived_at IS NULL ORDER BY c.name`).bind(p.organizationId).all<any>();
    people.push(...rows.results.map(row => ({ id: `ledgerly-core:${row.id}`, entityId: row.id, contactId: row.id, sourceModule: "ledgerly-core", group: row.type, name: row.name, email: row.email, phone: row.phone, code: row.code, active: Boolean(row.active) })));
  }
  if (keys.has("school-management")) {
    const [students, guardians, staff] = await Promise.all([
      c.env.FINANCE_DB.prepare("SELECT id,contact_id AS contactId,admission_number AS code,TRIM(first_name||' '||COALESCE(middle_name||' ','')||last_name) AS name,email,phone,status FROM school_students WHERE organization_id=? AND deleted_at IS NULL ORDER BY last_name,first_name").bind(p.organizationId).all<any>(),
      c.env.FINANCE_DB.prepare("SELECT id,contact_id AS contactId,TRIM(first_name||' '||COALESCE(middle_name||' ','')||last_name) AS name,email,phone_primary AS phone,active FROM school_guardians WHERE organization_id=? ORDER BY last_name,first_name").bind(p.organizationId).all<any>(),
      c.env.FINANCE_DB.prepare("SELECT id,contact_id AS contactId,staff_number AS code,TRIM(first_name||' '||COALESCE(middle_name||' ','')||last_name) AS name,email,phone,employment_status AS status FROM school_staff_profiles WHERE organization_id=? AND deleted_at IS NULL ORDER BY last_name,first_name").bind(p.organizationId).all<any>(),
    ]);
    people.push(...students.results.map(row => ({ id: `school-management:student:${row.id}`, entityId: row.id, contactId: row.contactId, sourceModule: "school-management", group: "student", name: row.name, email: row.email, phone: row.phone, code: row.code, active: row.status === "active" })));
    people.push(...guardians.results.map(row => ({ id: `school-management:guardian:${row.id}`, entityId: row.id, contactId: row.contactId, sourceModule: "school-management", group: "guardian", name: row.name, email: row.email, phone: row.phone, active: Boolean(row.active) })));
    people.push(...staff.results.map(row => ({ id: `school-management:staff:${row.id}`, entityId: row.id, contactId: row.contactId, sourceModule: "school-management", group: "staff", name: row.name, email: row.email, phone: row.phone, code: row.code, active: row.status === "active" })));
  }
  if (keys.has("tasks-work")) {
    const rows = await c.env.FINANCE_DB.prepare(`SELECT u.id,u.display_name AS name,u.email,u.status,m.role AS code
      FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=? ORDER BY u.display_name`).bind(p.organizationId).all<any>();
    people.push(...rows.results.map(row => ({ id: `tasks-work:${row.id}`, entityId: row.id, sourceModule: "tasks-work", group: "organization_user", name: row.name, email: row.email, code: row.code, active: row.status === "active" })));
  }
  if (keys.has("communications")) {
    const snapshots = await c.env.FINANCE_DB.prepare(`SELECT recipient_type AS recipientType,recipient_id AS entityId,recipient_name AS name,phone,MAX(created_at) AS lastSeen
      FROM communication_recipients WHERE organization_id=? AND phone IS NOT NULL AND trim(phone)<>'' GROUP BY recipient_type,recipient_id,recipient_name,phone ORDER BY recipient_name`).bind(p.organizationId).all<any>();
    const known = new Set(people.map(person => `${person.name.toLowerCase()}|${person.phone || ""}`));
    for (const row of snapshots.results) if (!known.has(`${String(row.name).toLowerCase()}|${row.phone}`)) people.push({ id: `communications:${row.recipientType}:${row.entityId || row.phone}`, entityId: row.entityId || row.phone, sourceModule: "communications", group: "sms_recipient", name: row.name, phone: row.phone, active: true });
    const preferences = await c.env.FINANCE_DB.prepare("SELECT recipient_type AS recipientType,recipient_id AS recipientId,sms_enabled AS smsEnabled,whatsapp_enabled AS whatsappEnabled,do_not_contact AS doNotContact FROM communication_preferences WHERE organization_id=?").bind(p.organizationId).all<any>();
    const prefs = new Map(preferences.results.map(row => [`${row.recipientType}:${row.recipientId}`, row]));
    for (const person of people) {
      if (!person.phone) { person.channels = []; continue; }
      const pref = prefs.get(`${person.group}:${person.entityId}`) || prefs.get(`contact:${person.contactId}`);
      person.channels = pref?.doNotContact ? [] : [pref?.smsEnabled === 0 ? null : "sms", pref?.whatsappEnabled === 0 ? null : "whatsapp"].filter(Boolean) as string[];
    }
  }
  const source = c.req.query("source"), group = c.req.query("group"), channel = c.req.query("channel"), query = (c.req.query("search") || "").trim().toLowerCase();
  const filtered = people.filter(person => (!source || person.sourceModule === source) && (!group || person.group === group) && (!channel || person.channels?.includes(channel)) && (!query || `${person.name} ${person.email || ""} ${person.phone || ""} ${person.code || ""}`.toLowerCase().includes(query)));
  const { limit, offset } = pagination(c);
  return c.json({ data: filtered.slice(offset, offset + limit), pagination: { limit, offset, total: filtered.length } });
});

contactsRoutes.get("/", requireScope("contacts:read"), async c => { const p=c.get("principal"),{limit,offset}=pagination(c),type=c.req.query("type"),result=await c.env.FINANCE_DB.prepare(`SELECT id,type,code,name,email,tax_number AS taxNumber,payment_terms_days AS paymentTermsDays,active,credit_limit_minor AS creditLimitMinor,pricing_tier AS pricingTier,custom_fields AS customFields,created_at AS createdAt FROM contacts WHERE organization_id=? AND archived_at IS NULL ${type?"AND type=?":""} ORDER BY name LIMIT ? OFFSET ?`).bind(p.organizationId,...(type?[type]:[]),limit,offset).all<Record<string,unknown>>();return c.json({data:result.results.map(row=>({...row,customFields:JSON.parse(String(row.customFields))})),pagination:{limit,offset}}) });
contactsRoutes.post("/", requireScope("contacts:write"), async c => { const parsed=input.safeParse(await c.req.json());if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid contact",parsed.error.flatten());const p=c.get("principal"),id=createId("con"),v=parsed.data;await c.env.FINANCE_DB.batch([c.env.FINANCE_DB.prepare(`INSERT INTO contacts (id,organization_id,type,code,name,email,tax_number,payment_terms_days,custom_fields,credit_limit_minor,pricing_tier,active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,p.organizationId,v.type,v.code??null,v.name,v.email?.toLowerCase()??null,v.taxNumber??null,v.paymentTermsDays,JSON.stringify(v.customFields),v.creditLimitMinor,v.pricingTier??null,v.active),auditStatement(c.env.FINANCE_DB,{organizationId:p.organizationId,actorId:p.userId,action:"contact.created",entityType:"contact",entityId:id,after:v})]);return c.json({data:{id,...v}},201) });
contactsRoutes.put("/:id",requireScope("contacts:write"),async c=>{const s=input.safeParse(await c.req.json());if(!s.success)throw new AppError(422,"VALIDATION_ERROR","Invalid contact",s.error.flatten());const p=c.get("principal"),v=s.data,r=await c.env.FINANCE_DB.prepare(`UPDATE contacts SET type=?,code=?,name=?,email=?,tax_number=?,payment_terms_days=?,custom_fields=?,credit_limit_minor=?,pricing_tier=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND archived_at IS NULL`).bind(v.type,v.code??null,v.name,v.email?.toLowerCase()??null,v.taxNumber??null,v.paymentTermsDays,JSON.stringify(v.customFields),v.creditLimitMinor,v.pricingTier??null,v.active,c.req.param("id"),p.organizationId).run();if(!r.meta.changes)throw new AppError(404,"NOT_FOUND","Contact not found");return c.json({data:{id:c.req.param("id"),...v}})});
contactsRoutes.delete("/:id",requireScope("contacts:write"),async c=>{const p=c.get("principal"),id=c.req.param("id"),used=await c.env.FINANCE_DB.prepare("SELECT 1 FROM documents WHERE organization_id=? AND contact_id=? LIMIT 1").bind(p.organizationId,id).first();if(used)throw new AppError(409,"CONTACT_IN_USE","Contact has financial history; archive it instead");await c.env.FINANCE_DB.prepare("DELETE FROM contacts WHERE id=? AND organization_id=?").bind(id,p.organizationId).run();return c.body(null,204)});
contactsRoutes.post("/:id/archive",requireScope("contacts:write"),async c=>{const p=c.get("principal");await c.env.FINANCE_DB.prepare("UPDATE contacts SET active=0,archived_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(c.req.param("id"),p.organizationId).run();return c.json({data:{id:c.req.param("id"),status:"archived"}})});
contactsRoutes.post("/:id/merge",requireScope("contacts:write"),async c=>{const s=z.object({targetContactId:z.string()}).safeParse(await c.req.json()),p=c.get("principal"),source=c.req.param("id");if(!s.success||s.data.targetContactId===source)throw new AppError(422,"VALIDATION_ERROR","Invalid merge target");const target=s.data.targetContactId,found=await c.env.FINANCE_DB.prepare("SELECT COUNT(*) AS n FROM contacts WHERE organization_id=? AND id IN (?,?)").bind(p.organizationId,source,target).first<{n:number}>();if(Number(found?.n)!==2)throw new AppError(404,"NOT_FOUND","Contact not found");await c.env.FINANCE_DB.batch([c.env.FINANCE_DB.prepare("UPDATE documents SET contact_id=? WHERE organization_id=? AND contact_id=?").bind(target,p.organizationId,source),c.env.FINANCE_DB.prepare("UPDATE payments SET contact_id=? WHERE organization_id=? AND contact_id=?").bind(target,p.organizationId,source),c.env.FINANCE_DB.prepare("UPDATE journal_lines SET contact_id=? WHERE organization_id=? AND contact_id=?").bind(target,p.organizationId,source),c.env.FINANCE_DB.prepare("UPDATE contacts SET active=0,archived_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(source,p.organizationId)]);return c.json({data:{sourceContactId:source,targetContactId:target,status:"merged"}})});
contactsRoutes.get("/:id/addresses",requireScope("contacts:read"),async c=>{const p=c.get("principal"),r=await c.env.FINANCE_DB.prepare("SELECT id,type,line1,line2,city,state,postal_code AS postalCode,country,is_default AS isDefault FROM contact_addresses WHERE organization_id=? AND contact_id=?").bind(p.organizationId,c.req.param("id")).all();return c.json({data:r.results})});
contactsRoutes.post("/:id/addresses",requireScope("contacts:write"),async c=>{const s=address.safeParse(await c.req.json());if(!s.success)throw new AppError(422,"VALIDATION_ERROR","Invalid address",s.error.flatten());const p=c.get("principal"),id=createId("adr"),v=s.data;await c.env.FINANCE_DB.prepare("INSERT INTO contact_addresses(id,organization_id,contact_id,type,line1,line2,city,state,postal_code,country,is_default) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(id,p.organizationId,c.req.param("id"),v.type,v.line1,v.line2??null,v.city??null,v.state??null,v.postalCode??null,v.country,v.isDefault).run();return c.json({data:{id,...v}},201)});
contactsRoutes.post("/:id/people",requireScope("contacts:write"),async c=>{const s=z.object({name:z.string().min(1),email:z.email().optional(),phone:z.string().max(40).optional(),role:z.string().max(80).optional(),isPrimary:z.boolean().default(false)}).safeParse(await c.req.json());if(!s.success)throw new AppError(422,"VALIDATION_ERROR","Invalid contact person",s.error.flatten());const p=c.get("principal"),id=createId("cpr"),v=s.data;await c.env.FINANCE_DB.prepare("INSERT INTO contact_people(id,organization_id,contact_id,name,email,phone,role,is_primary) VALUES(?,?,?,?,?,?,?,?)").bind(id,p.organizationId,c.req.param("id"),v.name,v.email??null,v.phone??null,v.role??null,v.isPrimary).run();return c.json({data:{id,...v}},201)});
