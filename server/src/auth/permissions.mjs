export const ALL_SCOPES = Object.freeze([
  "accounts:read", "accounts:write", "journals:read", "journals:write", "reports:read", "reports:write",
  "contacts:read", "contacts:write", "products:read", "products:write", "documents:read", "documents:write",
  "payments:read", "payments:write", "payroll:read", "payroll:write", "periods:read", "periods:write",
  "admin:read", "admin:write", "communications:read", "communications:write", "school:read", "school:write",
  "students:read", "students:write", "staff:read", "staff:write", "academics:read", "academics:write",
  "fees:read", "fees:write", "finance:read", "finance:write", "inventory:read", "inventory:write",
  "tasks:read", "tasks:write", "approvals:read", "approvals:write", "notifications:send", "support:read", "support:write",
  "ai:read", "ai:write", "ai:approve", "ai:knowledge:read", "ai:knowledge:write",
]);

export function parseScopes(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string");
  if (typeof value !== "string" || value.trim() === "") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function effectiveScopes(principal) {
  if (!principal) return [];
  if (principal.role === "owner" || principal.role === "admin") return ["*"];
  return [...new Set(parseScopes(principal.scopes))];
}

export function hasScope(principal, scope) {
  if (!principal) return false;
  if (principal.role === "owner" || principal.role === "admin") return true;
  const scopes = effectiveScopes(principal);
  return scopes.includes("*") || scopes.includes(scope);
}
