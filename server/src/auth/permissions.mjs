export const ALL_SCOPES = Object.freeze([
  "accounts:read", "accounts:write", "journals:read", "journals:write", "reports:read", "reports:write",
  "contacts:read", "contacts:write", "products:read", "products:write", "documents:read", "documents:write",
  "payments:read", "payments:write", "payroll:read", "payroll:write", "periods:read", "periods:write",
  "admin:read", "admin:write", "communications:read", "communications:write", "school:read", "school:write",
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

export function hasScope(principal, scope) {
  if (!principal) return false;
  if (principal.role === "owner" || principal.role === "admin") return true;
  return Array.isArray(principal.scopes) && principal.scopes.includes(scope);
}
