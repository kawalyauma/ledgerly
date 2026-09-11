export class AiScheduleService {
  constructor({ scheduler, audit }) { this.scheduler=scheduler; this.audit=audit; }

  async register({ context, scheduleId, name, agentId, instruction, cron, timezone="Africa/Kampala", priority=50, enabled=true }) {
    const id=scheduleId??`ai:${context.organizationId}:${agentId}:${Buffer.from(name).toString("base64url").slice(0,24)}`;
    const record=await this.scheduler.register({
      id,name,organizationId:context.organizationId,kind:"ai.task",
      cron,timezone,enabled,
      payload:{ aiScheduled:true, assignedAgent:agentId, instruction, priority },
    });
    await this.audit?.write?.({ organization_id:context.organizationId,actor_type:"human",actor_id:context.userId,action:"ai.schedule.registered",entity_type:"ai_schedule",entity_id:id,reason:instruction,metadata:{agent_id:agentId,cron,timezone} });
    return record;
  }

  async cancel({ context, scheduleId }) {
    const schedules=await this.scheduler.list({organizationId:context.organizationId,limit:500});
    if (!schedules.some((item)=>item.id===scheduleId)) throw new Error("AI schedule not found in organization");
    const result=await this.scheduler.cancel(scheduleId);
    await this.audit?.write?.({organization_id:context.organizationId,actor_type:"human",actor_id:context.userId,action:"ai.schedule.cancelled",entity_type:"ai_schedule",entity_id:scheduleId});
    return result;
  }
}
