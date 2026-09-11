import { evaluateToolPolicy } from "./policy.mjs";

function hasPermissions(grantedPermissions, requiredPermissions) {
  const granted = new Set(grantedPermissions ?? []);
  return (requiredPermissions ?? []).every((permission) => granted.has("*") || granted.has(permission));
}

export class AiToolGateway {
  constructor({ audit, approvalService = null }) {
    this.audit = audit;
    this.approvalService = approvalService;
    this.tools = new Map();
  }

  register(definition, handler) {
    if (!definition?.name || typeof handler !== "function") throw new TypeError("tool definition and handler are required");
    this.tools.set(definition.name, Object.freeze({ ...definition, handler }));
    return this;
  }

  describeForAgent(agent, effectivePermissions = agent?.permissions ?? []) {
    return [...this.tools.values()]
      .filter((tool) => (agent.allowedTools ?? []).includes(tool.name) && hasPermissions(effectivePermissions, tool.permissions))
      .map(({ handler, ...tool }) => tool);
  }

  async invoke({ agent, context, taskId = null, toolName, input = {} }) {
    const tool = this.tools.get(toolName);
    if (!tool) throw new Error(`Unknown AI tool: ${toolName}`);
    const policy = evaluateToolPolicy({ agent, tool, context, input });
    await this.audit?.write?.({
      organization_id: context.organizationId,
      actor_type: "ai_agent",
      actor_id: agent.agentId,
      agent_id: agent.agentId,
      agent_name: agent.name,
      agent_role: agent.role,
      action: "ai.tool.requested",
      entity_type: "ai_tool",
      entity_id: toolName,
      reason: context.reason ?? null,
      metadata: { task_id: taskId, requested_by: context.userId ?? null, policy, input: tool.auditInput === false ? undefined : input },
    });
    if (policy.decision === "approval_required") {
      if (!this.approvalService) return { status: "waiting_for_approval", policy };
      const approval = await this.approvalService.request({
        organizationId: context.organizationId,
        agent,
        taskId,
        action: toolName,
        reason: context.reason ?? policy.reason,
        payload: input,
        riskLevel: policy.risk,
        requestedApprover: tool.requestedApprover ?? null,
      });
      return { status: "waiting_for_approval", approval, policy };
    }
    if (policy.decision === "draft_only") return { status: "draft_only", policy };
    return this.#execute({ tool, agent, context, taskId, input, approved: false });
  }

  async executeApproved({ approval, agent, context }) {
    if (!approval || approval.organization_id !== context.organizationId) throw new Error("approval is outside organization scope");
    if (approval.status !== "approved") throw new Error("approval is not approved");
    if (approval.agent_id !== agent.agentId) throw new Error("approval agent mismatch");
    const tool = this.tools.get(approval.requested_action);
    if (!tool) throw new Error(`Unknown approved AI tool: ${approval.requested_action}`);
    if (!(agent.allowedTools ?? []).includes(tool.name)) throw new Error("agent no longer has approved tool access");
    if (agent.status === "disabled") throw new Error("agent is disabled");
    if (!hasPermissions(agent.permissions, tool.permissions)) throw new Error("agent no longer has required permission for approved tool");
    if (!hasPermissions(context.permissions, tool.permissions)) {
      const error = new Error("approved AI action exceeds current delegated authority");
      error.code = "AI_PERMISSION_DENIED";
      throw error;
    }
    return this.#execute({
      tool,
      agent,
      context: { ...context, reason: approval.reason },
      taskId: approval.task_id,
      input: approval.payload ?? {},
      approved: true,
      approvalId: approval.approval_id,
    });
  }

  async #execute({ tool, agent, context, taskId, input, approved, approvalId = null }) {
    const output = await tool.handler({ input, context, agent, taskId, approved, approvalId });
    await this.audit?.write?.({
      organization_id: context.organizationId,
      actor_type: "ai_agent",
      actor_id: agent.agentId,
      agent_id: agent.agentId,
      agent_name: agent.name,
      agent_role: agent.role,
      action: "ai.tool.executed",
      entity_type: "ai_tool",
      entity_id: tool.name,
      reason: context.reason ?? null,
      metadata: { task_id: taskId, requested_by: context.userId ?? null, risk: tool.risk ?? "low", approved, approval_id: approvalId },
    });
    return { status: "executed", output, policy: { decision: "allow", risk: tool.risk ?? "low", approved } };
  }
}

export function registerCoreTools(gateway, services = {}) {
  const read = (name, permissions, handler) => gateway.register({ name, permissions, risk: "low", consequential: false }, handler);
  const draft = (name, permissions, handler) => gateway.register({ name, permissions, risk: "low", consequential: false }, handler);
  read("search_students", ["students:read"], services.searchStudents ?? unavailable("search_students"));
  read("get_student", ["students:read"], services.getStudent ?? unavailable("get_student"));
  read("get_staff", ["staff:read"], services.getStaff ?? unavailable("get_staff"));
  read("get_school_profile", ["school:read"], services.getSchoolProfile ?? unavailable("get_school_profile"));
  read("get_academic_context", ["academics:read"], services.getAcademicContext ?? unavailable("get_academic_context"));
  read("get_lesson_plan", ["academics:read"], services.getLessonPlan ?? unavailable("get_lesson_plan"));
  draft("create_lesson_plan_draft", ["academics:write"], services.createLessonPlanDraft ?? unavailable("create_lesson_plan_draft"));
  draft("update_document_draft", ["documents:write"], services.updateDocumentDraft ?? unavailable("update_document_draft"));
  draft("record_academic_review", ["academics:read"], services.recordAcademicReview ?? unavailable("record_academic_review"));
  read("get_student_balance", ["fees:read"], services.getStudentBalance ?? unavailable("get_student_balance"));
  read("get_finance_summary", ["finance:read"], services.getFinanceSummary ?? unavailable("get_finance_summary"));
  draft("prepare_fee_reminder", ["fees:read"], services.prepareFeeReminder ?? unavailable("prepare_fee_reminder"));
  draft("create_task", ["tasks:write"], services.createTask ?? unavailable("create_task"));
  gateway.register({ name: "send_notification", permissions: ["notifications:send"], risk: "medium", consequential: true, approvalRequired: true }, services.sendNotification ?? unavailable("send_notification"));
  draft("generate_report", ["reports:read"], services.generateReport ?? unavailable("generate_report"));
  draft("request_approval", ["approvals:write"], services.requestApproval ?? unavailable("request_approval"));
  for (const name of ["delete_student", "alter_marks", "reverse_journal", "post_payroll", "post_payment", "alter_financial_record", "adjust_stock"]) {
    gateway.register({ name, permissions: ["ai:restricted"], risk: "high", consequential: true, approvalRequired: true }, services[name] ?? unavailable(name));
  }
  return gateway;
}

function unavailable(name) {
  return async () => { throw new Error(`Ledgerly business adapter for ${name} is not connected yet`); };
}
