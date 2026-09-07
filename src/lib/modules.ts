import type { MiddlewareHandler } from "hono";
import type { AppVariables, Env } from "../types";

export function requireModuleEnabled(moduleKey: string): MiddlewareHandler<{ Bindings: Env; Variables: AppVariables }> {
  return async (c, next) => {
    const principal = c.get("principal");
    const row = await c.env.FINANCE_DB.prepare(
      "SELECT enabled FROM organization_modules WHERE organization_id=? AND module_key=?"
    ).bind(principal.organizationId, moduleKey).first<{ enabled: number }>();
    if (!row?.enabled) {
      return c.json({ error: { code: "MODULE_DISABLED", message: `${moduleKey} module is not enabled for this organization` } }, 403);
    }
    await next();
  };
}
