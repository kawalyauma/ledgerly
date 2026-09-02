import { Hono } from "hono";
import { z } from "zod";
import type { AppVariables, Env } from "../types";
import { AppError } from "../lib/errors";
import { createId } from "../lib/ids";
import { pagination } from "../lib/http";
import { auditStatement } from "../services/audit";
import { requireScope } from "../lib/auth";

const input = z.object({
  sku: z.string().trim().min(1).max(60), name: z.string().trim().min(1).max(160),
  type: z.enum(["inventory", "service", "non_inventory"]), incomeAccountId: z.string().optional(),
  expenseAccountId: z.string().optional(), inventoryAccountId: z.string().optional(),
  quantityOnHandMicros: z.number().int().default(0), averageCostMinor: z.number().int().nonnegative().default(0),
  reorderPointMicros: z.number().int().nonnegative().default(0),
});

export const productsRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

productsRoutes.get("/", requireScope("products:read"), async (c) => {
  const p=c.get("principal"); const {limit,offset}=pagination(c);
  const result=await c.env.FINANCE_DB.prepare(`SELECT id,sku,name,type,income_account_id AS incomeAccountId,expense_account_id AS expenseAccountId,
    inventory_account_id AS inventoryAccountId,quantity_on_hand_micros AS quantityOnHandMicros,average_cost_minor AS averageCostMinor,
    reorder_point_micros AS reorderPointMicros,active FROM products WHERE organization_id=? ORDER BY name LIMIT ? OFFSET ?`)
    .bind(p.organizationId,limit,offset).all();
  return c.json({data:result.results,pagination:{limit,offset}});
});

productsRoutes.post("/", requireScope("products:write"), async (c) => {
  const parsed=input.safeParse(await c.req.json());
  if(!parsed.success) throw new AppError(422,"VALIDATION_ERROR","Invalid product",parsed.error.flatten());
  const p=c.get("principal"); const id=createId("prd"); const v=parsed.data;
  const accountIds=[v.incomeAccountId,v.expenseAccountId,v.inventoryAccountId].filter((x):x is string=>Boolean(x));
  if(accountIds.length){
    const placeholders=accountIds.map(()=>"?").join(",");
    const found=await c.env.FINANCE_DB.prepare(`SELECT COUNT(*) AS count FROM accounts WHERE organization_id=? AND id IN (${placeholders})`).bind(p.organizationId,...accountIds).first<{count:number}>();
    if(Number(found?.count??0)!==new Set(accountIds).size) throw new AppError(422,"INVALID_ACCOUNT","All product accounts must belong to the organization");
  }
  await c.env.FINANCE_DB.batch([
    c.env.FINANCE_DB.prepare(`INSERT INTO products (id,organization_id,sku,name,type,income_account_id,expense_account_id,inventory_account_id,quantity_on_hand_micros,average_cost_minor,reorder_point_micros)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(id,p.organizationId,v.sku,v.name,v.type,v.incomeAccountId??null,v.expenseAccountId??null,v.inventoryAccountId??null,v.quantityOnHandMicros,v.averageCostMinor,v.reorderPointMicros),
    auditStatement(c.env.FINANCE_DB,{organizationId:p.organizationId,actorId:p.userId,action:"product.created",entityType:"product",entityId:id,after:v}),
  ]);
  return c.json({data:{id,...v}},201);
});
