import type { MiddlewareHandler } from "hono";
import { jwtVerify } from "jose";
import { AppError } from "./errors";
import type { AppVariables, AuthPrincipal, Env } from "../types";
import { sha256 } from "./crypto";

const allScopes = ["accounts:read", "accounts:write", "journals:read", "journals:write", "reports:read", "reports:write",
  "contacts:read", "contacts:write", "products:read", "products:write", "documents:read", "documents:write", "payments:read", "payments:write",
  "payroll:read", "payroll:write", "periods:read", "periods:write", "admin:read", "admin:write"];
// Owner/admin roles bypass explicit scopes; integration and staff tokens must opt into each domain.

export const requireAuth: MiddlewareHandler<{ Bindings: Env; Variables: AppVariables }> = async (c, next) => {
  if (c.env.ENVIRONMENT === "development") {
    const organizationId = c.req.header("X-Organization-Id");
    const userId = c.req.header("X-User-Id");
    if (organizationId && userId) {
      c.set("principal", { organizationId, userId, role: "owner", scopes: allScopes });
      await next();
      return;
    }
  }

  const apiKey=c.req.header("X-API-Key");
  if(apiKey){const hash=await sha256(apiKey);const key=await c.env.FINANCE_DB.prepare("SELECT id,organization_id AS organizationId,scopes FROM api_keys WHERE key_hash=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP)").bind(hash).first<{id:string;organizationId:string;scopes:string}>();if(!key)throw new AppError(401,"INVALID_API_KEY","API key is invalid or expired");c.set("principal",{userId:`apikey:${key.id}`,organizationId:key.organizationId,role:"integration",scopes:JSON.parse(key.scopes)});c.executionCtx.waitUntil(c.env.FINANCE_DB.prepare("UPDATE api_keys SET last_used_at=CURRENT_TIMESTAMP WHERE id=?").bind(key.id).run());await next();return}

  const authorization = c.req.header("Authorization");
  if (!authorization?.startsWith("Bearer ")) throw new AppError(401, "UNAUTHENTICATED", "Bearer token required");
  const secret = new TextEncoder().encode(c.env.JWT_SECRET);
  let payload;
  try {
    ({ payload } = await jwtVerify(authorization.slice(7), secret, {
      issuer: c.env.JWT_ISSUER,
      audience: c.env.JWT_AUDIENCE,
      algorithms: ["HS256"],
    }));
  } catch {
    throw new AppError(401, "INVALID_TOKEN", "Access token is invalid or expired");
  }
  if (!payload.sub || typeof payload.org !== "string" || typeof payload.role !== "string") {
    throw new AppError(401, "INVALID_TOKEN", "Token is missing required claims");
  }
  const principal: AuthPrincipal = {
    userId: payload.sub,
    organizationId: payload.org,
    role: payload.role as AuthPrincipal["role"],
    scopes: Array.isArray(payload.scopes) ? payload.scopes.filter((v:unknown): v is string => typeof v === "string") : [],
  };
  c.set("principal", principal);
  await next();
};

export function requireScope(scope: string): MiddlewareHandler<{ Bindings: Env; Variables: AppVariables }> {
  return async (c, next) => {
    const principal = c.get("principal");
    if (principal.role !== "owner" && principal.role !== "admin" && !principal.scopes.includes(scope)) {
      throw new AppError(403, "FORBIDDEN", `Missing required scope: ${scope}`);
    }
    await next();
  };
}
