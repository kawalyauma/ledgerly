import { AUTONOMY_LEVELS, PROHIBITED_DIRECT_TOOLS } from "./constants.mjs";

export class AiPolicyError extends Error { constructor(code, message, details={}) { super(message); this.name="AiPolicyError"; this.code=code; this.details=details; } }

export function assertTenant(context, organizationId) {
  if (!context?.organizationId || context.organizationId !== organizationId) throw new AiPolicyError("AI_TENANT_SCOPE_DENIED", "AI operation is outside the authenticated organization scope");
}

export function evaluateToolPolicy({ agent, tool, context, input }) {
  if (!agent) throw new AiPolicyError("AI_AGENT_NOT_FOUND", "AI employee is required");
  if (agent.status === "paused") throw new AiPolicyError("AI_AGENT_PAUSED", "AI employee is paused");
  if (agent.status !== "active") throw new AiPolicyError("AI_AGENT_DISABLED", "AI employee is disabled");
  if (!context?.organizationId) throw new AiPolicyError("AI_AUTH_REQUIRED", "Authenticated organization context is required");
  const allowedTools = new Set(agent.allowedTools ?? []);
  if (!allowedTools.has(tool.name)) throw new AiPolicyError("AI_TOOL_NOT_ALLOWED", `Agent ${agent.name} is not allowed to use ${tool.name}`);
  const requiredPermissions = tool.permissions ?? [];
  const granted = new Set(context.permissions ?? []);
  for (const permission of requiredPermissions) if (!granted.has(permission) && !granted.has("*")) throw new AiPolicyError("AI_PERMISSION_DENIED", `Missing permission: ${permission}`);
  if (PROHIBITED_DIRECT_TOOLS.has(tool.name) || tool.risk === "prohibited") throw new AiPolicyError("AI_ACTION_PROHIBITED", `${tool.name} is prohibited for AI execution`);
  const autonomy = Number(agent.autonomyLevel ?? AUTONOMY_LEVELS.ASSISTANT);
  if (tool.approvalRequired || tool.risk === "high" || (tool.consequential && autonomy < AUTONOMY_LEVELS.AUTONOMOUS)) {
    return { decision:"approval_required", risk:tool.risk ?? "medium", reason:"Consequential AI action requires human approval", input };
  }
  return { decision:"allow", risk:tool.risk ?? "low" };
}
