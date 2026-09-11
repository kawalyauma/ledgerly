export class AiScheduleService {
  constructor({ scheduler, audit, agents=null }) { this.scheduler=scheduler; this.audit=audit; this.agents=agents; }

  async register({ context, scheduleId, name, agentId, instruction, cron, timezone="Africa/Kampala", priority=50, enabled=true }) {
    if (!context?.organizationId||!context?.userId) throw new Error("AI schedule requires an attributable organization requester");
    if(typeof name!=="string"||!name.trim())throw new TypeError("AI schedule name is required");
    if(typeof agentId!=="string"||!agentId.trim())throw new TypeError("AI schedule agentId is required");
    if(typeof instruction!=="string"||!instruction.trim())throw new TypeError("AI schedule instruction is required");
    const normalizedPriority=Number(priority);
    if(!Number.isInteger(normalizedPriority)||normalizedPriority<0||normalizedPriority>100)throw new TypeError("AI schedule priority must be an integer from 0 to 100");
    if(this.agents){
      const agent=await this.agents.get(context,agentId);
      if(!agent)throw new Error("AI schedule employee not found in organization");
      if(agent.status!=="active")throw new Error("AI schedule employee is disabled");
    }
    const id=scheduleId??`ai:${context.organizationId}:${agentId}:${Buffer.from(name.trim()).toString("base64url").slice(0,24)}`;
    const record=await this.scheduler.register({
      id,name:name.trim(),organizationId:context.organizationId,kind:"ai.task",
      cron,timezone,enabled,
      payload:{ aiScheduled:true, assignedAgent:agentId, instruction:instruction.trim(), priority:normalizedPriority, requestedBy:context.userId },
    });
    await this.audit?.write?.({ organization_id:context.organizationId,actor_type:"human",actor_id:context.userId,action:"ai.schedule.registered",entity_type:"ai_schedule",entity_id:id,reason:instruction,metadata:{agent_id:agentId,cron,timezone,requested_by:context.userId} });
    return record;
  }

  async cancel({ context, scheduleId }) {
    const schedules=await this.scheduler.list({organizationId:context.organizationId,limit:500});
    if (!schedules.some((item)=>item.id===scheduleId&&item.kind==="ai.task")) throw new Error("AI schedule not found in organization");
    const result=await this.scheduler.cancel(scheduleId);
    await this.audit?.write?.({organization_id:context.organizationId,actor_type:"human",actor_id:context.userId,action:"ai.schedule.cancelled",entity_type:"ai_schedule",entity_id:scheduleId});
    return result;
  }
}
