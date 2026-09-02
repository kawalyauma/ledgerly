import { Hono } from "hono";
import { z } from "zod";
import type { AppVariables, Env } from "../types";
import { createId } from "../lib/ids";
import { AppError } from "../lib/errors";

export const systemRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

systemRoutes.get("/health", async (c) => {
  const db = await c.env.FINANCE_DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
  return c.json({ status: db?.ok === 1 ? "ok" : "degraded", environment: c.env.ENVIRONMENT, timestamp: new Date().toISOString() });
});

const bootstrap = z.object({ organizationName: z.string().min(2).max(160), legalName: z.string().max(160).optional(), baseCurrency: z.string().length(3).toUpperCase().default("UGX"), ownerEmail: z.email(), ownerName: z.string().min(2).max(160) });

systemRoutes.post("/bootstrap", async (c) => {
  if (c.env.ENVIRONMENT !== "development") throw new AppError(404, "NOT_FOUND", "Not found");
  const parsed = bootstrap.safeParse(await c.req.json());
  if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid bootstrap request", parsed.error.flatten());
  const orgId = createId("org");
  const userId = createId("usr");
  const a = parsed.data;
  const defaultAccounts = [
    ["1000", "Cash and Bank", "asset", "cash", "debit"], ["1100", "Accounts Receivable", "asset", "receivable", "debit"],
    ["1200", "Inventory", "asset", "inventory", "debit"], ["2000", "Accounts Payable", "liability", "payable", "credit"],
    ["2100", "Tax Payable", "liability", "tax", "credit"], ["3000", "Owner's Equity", "equity", "equity", "credit"],
    ["4000", "Sales Revenue", "revenue", "sales", "credit"], ["5000", "Cost of Goods Sold", "expense", "cogs", "debit"],
    ["6000", "Operating Expenses", "expense", "operating", "debit"], ["6100", "Payroll Expense", "expense", "payroll", "debit"],
  ] as const;
  await c.env.FINANCE_DB.batch([
    c.env.FINANCE_DB.prepare("INSERT INTO organizations (id, name, legal_name, base_currency) VALUES (?, ?, ?, ?)").bind(orgId, a.organizationName, a.legalName ?? null, a.baseCurrency),
    c.env.FINANCE_DB.prepare("INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)").bind(userId, a.ownerEmail.toLowerCase(), a.ownerName),
    c.env.FINANCE_DB.prepare("INSERT INTO memberships (organization_id, user_id, role, scopes) VALUES (?, ?, 'owner', '[]')").bind(orgId, userId),
    ...defaultAccounts.map(([code, name, type, subtype, normal]) => c.env.FINANCE_DB.prepare(`INSERT INTO accounts
      (id, organization_id, code, name, type, subtype, normal_balance) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(createId("acc"), orgId, code, name, type, subtype, normal)),
  ]);
  return c.json({ data: { organizationId: orgId, userId, developmentHeaders: { "X-Organization-Id": orgId, "X-User-Id": userId } } }, 201);
});
