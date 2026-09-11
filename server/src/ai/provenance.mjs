export function aiAttribution({ agent, taskId = null, reason = null, timestamp = new Date().toISOString() }) {
  if (!agent?.agentId || !agent?.name || !agent?.role) throw new TypeError("agent_id, agent_name and agent_role are required for AI attribution");
  return Object.freeze({ actor_type:"ai_agent", agent_id:agent.agentId, agent_name:agent.name, agent_role:agent.role, task_id:taskId, timestamp, reason });
}

export function mergeProvenance(existing = {}, contribution) {
  const original = existing.original_ai ?? (existing.actor_type === "ai_agent" ? existing : null);
  const history = Array.isArray(existing.history) ? [...existing.history] : [];
  history.push(contribution);
  return { ...contribution, original_ai:original ?? contribution, history };
}

export function humanEditProvenance(existing, { userId, userName, reason = null, timestamp = new Date().toISOString() }) {
  if (!existing?.original_ai && existing?.actor_type !== "ai_agent") return { actor_type:"human", actor_id:userId, actor_name:userName, timestamp, reason, history:[...(existing?.history ?? [])] };
  const original = existing.original_ai ?? existing;
  return { actor_type:"human", actor_id:userId, actor_name:userName, timestamp, reason, original_ai:original, history:[...(existing.history ?? []), { actor_type:"human", actor_id:userId, actor_name:userName, timestamp, reason }] };
}
