import { AUTONOMY_LEVELS, PROHIBITED_DIRECT_TOOLS } from "./constants.mjs";

export class AiPolicyError extends Error { constructor(code, message, details={}) { super(message); this.name="AiPolicyError"; this.code=code; this.details=details; } }

export function assertTenant(context, organizationId) {
  if (!context?.organizationId || context.organizationId !== organizationId) throw new AiPolicyError("AI_TENANT_SCOPE_DENIED", "AI operation is outside the authenticated organization scope");
}

export function evaluateToolPolicy({ agent, tool, context, input }) {
  if (!agent || agent.status === "disabled") throw new AiPolicyError("AI_AGENT_DISABLED", "AI agent is disabled");
  if (!context?.organizationId) throw new AiPolicyError("AI_AUTH_REQUIRED", "Authenticated organization context is required");
  const allowedTools = new Set(agent.allowedTools ?? []);
  if (!allowedTools.has(tool.name)) throw new AiPolicyError("AI_TOOL_NOT_ALLOWED", `Agent ${agent.name} is not allowed to use ${tool.name}`);
  const requiredPermissions = tool.permissions ?? [];
  const granted = new Set(context.permissions ?? []);
  for (const permission of requiredPermissions) if (!granted.has(permission) && !granted.has("*")) throw new AiPolicyError("AI_PERMISSION_DENIED", `Missing permission: ${permission}`);
  if (PROHIBITED_DIRECT_TOOLS.has(tool.name) && !tool.approvalRequired) throw new AiPolicyError("AI_PROHIBITED_DIRECT_ACTION", `${tool.name} cannot be executed without an approval policy`);
  if (tool.risk === "prohibited") throw new AiPolicyError("AI_ACTION_PROHIBITED", `${tool.name} is prohibited for AI execution`);
  const autonomy = Number(agent.autonomyLevel ?? AUTONOMY_LEVELS.ASSISTANT);
  if (tool.consequential && autonomy === AUTONOMY_LEVELS.ADVISER) {
    return { decision:"draft_only", risk:tool.risk ?? "medium", reason:"Adviser autonomy may only recommend and cannot request execution approval" };
  }
  if (tool.approvalRequired || tool.risk === "high" || (tool.consequential && autonomy < AUTONOMY_LEVELS.AUTONOMOUS)) {
    return { decision:"approval_required", risk:tool.risk ?? "medium", reason:"Consequential AI action requires human approval", input };
  }
  return { decision:"allow", risk:tool.risk ?? "low" };
}
