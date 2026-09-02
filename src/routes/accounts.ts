import { Hono } from "hono";
import { z } from "zod";
import type { AppVariables, Env } from "../types";
import { createId } from "../lib/ids";
import { AppError } from "../lib/errors";
import { pagination } from "../lib/http";
import { requireScope } from "../lib/auth";
import { auditStatement } from "../services/audit";

const accountInput = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(160),
  type: z.enum(["asset", "liability", "equity", "revenue", "expense"]),
  subtype: z.string().trim().max(80).optional(),
  normalBalance: z.enum(["debit", "credit"]),
  currency: z.string().length(3).toUpperCase().optional(),
  allowPosting: z.boolean().default(true),
  parentAccountId: z.string().nullable().optional(),
  accountGroupId: z.string().nullable().optional(),
  active: z.boolean().default(true),
});

export const accountsRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

accountsRoutes.get("/", requireScope("accounts:read"), async (c) => {
  const p = c.get("principal");
  const { limit, offset } = pagination(c);
  const result = await c.env.FINANCE_DB.prepare(`SELECT id, code, name, type, subtype, normal_balance AS normalBalance,
    currency, allow_posting AS allowPosting, active,parent_account_id AS parentAccountId,account_group_id AS accountGroupId, created_at AS createdAt FROM accounts
    WHERE organization_id = ? ORDER BY code LIMIT ? OFFSET ?`).bind(p.organizationId, limit, offset).all();
  return c.json({ data: result.results, pagination: { limit, offset } });
});

accountsRoutes.post("/", requireScope("accounts:write"), async (c) => {
  const parsed = accountInput.safeParse(await c.req.json());
  if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid account", parsed.error.flatten());
  const p = c.get("principal");
  const id = createId("acc");
  const a = parsed.data;
  await c.env.FINANCE_DB.batch([
    c.env.FINANCE_DB.prepare(`INSERT INTO accounts
      (id, organization_id, code, name, type, subtype, normal_balance, currency, allow_posting,parent_account_id,account_group_id,active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?,?,?,?)`)
      .bind(id, p.organizationId, a.code, a.name, a.type, a.subtype ?? null, a.normalBalance, a.currency ?? null, a.allowPosting,a.parentAccountId??null,a.accountGroupId??null,a.active),
    auditStatement(c.env.FINANCE_DB, { organizationId: p.organizationId, actorId: p.userId, action: "account.created", entityType: "account", entityId: id, after: a }),
  ]);
  return c.json({ data: { id, ...a } }, 201);
});

accountsRoutes.put("/:id",requireScope("accounts:write"),async c=>{const s=accountInput.safeParse(await c.req.json());if(!s.success)throw new AppError(422,"VALIDATION_ERROR","Invalid account",s.error.flatten());const p=c.get("principal"),v=s.data,id=c.req.param("id");if(v.parentAccountId===id)throw new AppError(422,"INVALID_PARENT","An account cannot be its own parent");const r=await c.env.FINANCE_DB.prepare(`UPDATE accounts SET code=?,name=?,type=?,subtype=?,normal_balance=?,currency=?,allow_posting=?,parent_account_id=?,account_group_id=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`).bind(v.code,v.name,v.type,v.subtype??null,v.normalBalance,v.currency??null,v.allowPosting,v.parentAccountId??null,v.accountGroupId??null,v.active,id,p.organizationId).run();if(!r.meta.changes)throw new AppError(404,"NOT_FOUND","Account not found");return c.json({data:{id,...v}})});
accountsRoutes.patch("/:id/active",requireScope("accounts:write"),async c=>{const s=z.object({active:z.boolean()}).safeParse(await c.req.json());if(!s.success)throw new AppError(422,"VALIDATION_ERROR","Invalid status");const p=c.get("principal"),r=await c.env.FINANCE_DB.prepare("UPDATE accounts SET active=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(s.data.active,c.req.param("id"),p.organizationId).run();if(!r.meta.changes)throw new AppError(404,"NOT_FOUND","Account not found");return c.json({data:{id:c.req.param("id"),active:s.data.active}})});
accountsRoutes.delete("/:id",requireScope("accounts:write"),async c=>{const p=c.get("principal"),id=c.req.param("id");const used=await c.env.FINANCE_DB.prepare("SELECT 1 FROM journal_lines WHERE organization_id=? AND account_id=? LIMIT 1").bind(p.organizationId,id).first();if(used)throw new AppError(409,"ACCOUNT_IN_USE","An account with transactions can only be deactivated");await c.env.FINANCE_DB.prepare("DELETE FROM accounts WHERE id=? AND organization_id=?").bind(id,p.organizationId).run();return c.body(null,204)});
accountsRoutes.post("/:id/merge",requireScope("accounts:write"),async c=>{const s=z.object({targetAccountId:z.string()}).safeParse(await c.req.json());if(!s.success||s.data.targetAccountId===c.req.param("id"))throw new AppError(422,"VALIDATION_ERROR","Invalid merge target");const p=c.get("principal"),source=c.req.param("id"),target=s.data.targetAccountId;const rows=await c.env.FINANCE_DB.prepare("SELECT id,type FROM accounts WHERE organization_id=? AND id IN (?,?)").bind(p.organizationId,source,target).all<{id:string;type:string}>();if(rows.results.length!==2||rows.results[0]!.type!==rows.results[1]!.type)throw new AppError(422,"INCOMPATIBLE_ACCOUNTS","Accounts must exist and have the same type");await c.env.FINANCE_DB.batch([c.env.FINANCE_DB.prepare("UPDATE journal_lines SET account_id=? WHERE organization_id=? AND account_id=?").bind(target,p.organizationId,source),c.env.FINANCE_DB.prepare("UPDATE document_lines SET account_id=? WHERE organization_id=? AND account_id=?").bind(target,p.organizationId,source),c.env.FINANCE_DB.prepare("UPDATE accounts SET active=0,allow_posting=0,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(source,p.organizationId),auditStatement(c.env.FINANCE_DB,{organizationId:p.organizationId,actorId:p.userId,action:"account.merged",entityType:"account",entityId:source,after:{targetAccountId:target}})]);return c.json({data:{sourceAccountId:source,targetAccountId:target,status:"merged"}})});
accountsRoutes.post("/groups",requireScope("accounts:write"),async c=>{const s=z.object({code:z.string().min(1).max(30),name:z.string().min(1).max(160),type:z.enum(["asset","liability","equity","revenue","expense"]),parentGroupId:z.string().nullable().optional()}).safeParse(await c.req.json());if(!s.success)throw new AppError(422,"VALIDATION_ERROR","Invalid account group",s.error.flatten());const p=c.get("principal"),id=createId("acg");await c.env.FINANCE_DB.prepare("INSERT INTO account_groups(id,organization_id,code,name,type,parent_group_id) VALUES(?,?,?,?,?,?)").bind(id,p.organizationId,s.data.code,s.data.name,s.data.type,s.data.parentGroupId??null).run();return c.json({data:{id,...s.data}},201)});
accountsRoutes.get("/groups",requireScope("accounts:read"),async c=>{const p=c.get("principal"),r=await c.env.FINANCE_DB.prepare("SELECT id,code,name,type,parent_group_id AS parentGroupId,active FROM account_groups WHERE organization_id=? ORDER BY code").bind(p.organizationId).all();return c.json({data:r.results})});
accountsRoutes.put("/groups/:id",requireScope("accounts:write"),async c=>{const schema=z.object({code:z.string().min(1).max(30),name:z.string().min(1).max(160),type:z.enum(["asset","liability","equity","revenue","expense"]),parentGroupId:z.string().nullable().optional(),active:z.boolean()}),s=schema.safeParse(await c.req.json()),p=c.get("principal"),id=c.req.param("id");if(!s.success)throw new AppError(422,"VALIDATION_ERROR","Invalid account group",s.error.flatten());if(s.data.parentGroupId===id)throw new AppError(422,"INVALID_PARENT","A group cannot be its own parent");let parent=s.data.parentGroupId;while(parent){const x=await c.env.FINANCE_DB.prepare("SELECT parent_group_id AS parentId FROM account_groups WHERE id=? AND organization_id=?").bind(parent,p.organizationId).first<{parentId:string|null}>();if(!x)throw new AppError(422,"INVALID_PARENT","Parent group not found");if(x.parentId===id)throw new AppError(422,"INVALID_PARENT","Circular group hierarchy is not allowed");parent=x.parentId}await c.env.FINANCE_DB.prepare("UPDATE account_groups SET code=?,name=?,type=?,parent_group_id=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(s.data.code,s.data.name,s.data.type,s.data.parentGroupId??null,s.data.active,id,p.organizationId).run();return c.json({data:{id,...s.data}})});
accountsRoutes.delete("/groups/:id",requireScope("accounts:write"),async c=>{const p=c.get("principal"),id=c.req.param("id"),used=await c.env.FINANCE_DB.prepare("SELECT 1 FROM accounts WHERE organization_id=? AND account_group_id=? UNION SELECT 1 FROM account_groups WHERE organization_id=? AND parent_group_id=? LIMIT 1").bind(p.organizationId,id,p.organizationId,id).first();if(used)throw new AppError(409,"GROUP_IN_USE","Assigned or parent groups can only be deactivated");await c.env.FINANCE_DB.prepare("DELETE FROM account_groups WHERE id=? AND organization_id=?").bind(id,p.organizationId).run();return c.body(null,204)});
accountsRoutes.post("/opening-balances",requireScope("accounts:write"),async c=>{const s=z.object({postingDate:z.iso.date(),currency:z.string().length(3).toUpperCase(),reference:z.string().max(100).optional(),lines:z.array(z.object({accountId:z.string(),debitMinor:z.number().int().nonnegative().default(0),creditMinor:z.number().int().nonnegative().default(0)})).min(2)}).safeParse(await c.req.json());if(!s.success)throw new AppError(422,"VALIDATION_ERROR","Invalid opening balances",s.error.flatten());const debits=s.data.lines.reduce((n,l)=>n+l.debitMinor,0),credits=s.data.lines.reduce((n,l)=>n+l.creditMinor,0);if(debits!==credits)throw new AppError(422,"UNBALANCED_JOURNAL","Opening balances must balance",{debits,credits});const {createJournal,postJournal}=await import("../services/ledger");const p=c.get("principal"),j=await createJournal(c.env.FINANCE_DB,p.organizationId,p.userId,{transactionDate:s.data.postingDate,postingDate:s.data.postingDate,description:"Opening balances",reference:s.data.reference,currency:s.data.currency,sourceType:"opening_balance",lines:s.data.lines},`opening-balances:${c.req.header("Idempotency-Key")??s.data.postingDate}`);await postJournal(c.env.FINANCE_DB,p.organizationId,p.userId,j.id);return c.json({data:{journalEntryId:j.id,status:"posted"}},201)});
