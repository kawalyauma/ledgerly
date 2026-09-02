import type { Context } from "hono";

export function pagination(c: Context): { limit: number; offset: number } {
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50), 1), 200);
  const offset = Math.max(Number(c.req.query("offset") ?? 0), 0);
  return { limit, offset };
}

export function dateRange(c: Context): { from: string; to: string } {
  const now = new Date();
  const from = c.req.query("from") ?? `${now.getUTCFullYear()}-01-01`;
  const to = c.req.query("to") ?? now.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    throw new Error("Invalid report date range");
  }
  return { from, to };
}
