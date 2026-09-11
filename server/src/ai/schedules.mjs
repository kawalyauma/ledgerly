function invalid(message){const error=new Error(message);error.code="AI_SCHEDULE_INVALID";error.status=422;return error;}
function required(value,name,max=500){const text=String(value??"").trim();if(!text)throw invalid(`${name} is required`);if(text.length>max)throw invalid(`${name} exceeds ${max} characters`);return text;}
function priority(value){const n=Number(value??50);if(!Number.isInteger(n)||n<1||n>100)throw invalid("schedule priority must be an integer from 1 to 100");return n;}

export class AiScheduleService {
  constructor({ scheduler, audit }) { this.scheduler=scheduler; this.audit=audit; }

  async register({ context, scheduleId, name, agentId, instruction, cron, timezone="Africa/Kampala", priority:priorityValue=50, enabled=true }) {
    const org=required(context?.organizationId,"organizationId",200),actor=required(context?.userId,"userId",200),employee=required(agentId,"agentId",200),scheduleName=required(name,"schedule name",200),work=required(instruction,"instruction",48000),expression=required(cron,"cron",300),zone=required(timezone,"timezone",120),normalizedPriority=priority(priorityValue);
    const prefix=`ai:${org}:`;if(scheduleId!=null&&!String(scheduleId).startsWith(prefix))throw invalid("AI schedule id must remain inside the current organization namespace");
    const id=scheduleId??`${prefix}${employee}:${Buffer.from(scheduleName).toString("base64url").slice(0,24)}`;
    const record=await this.scheduler.register({
      id,name:scheduleName,organizationId:org,kind:"ai.task",
      cron:expression,timezone:zone,enabled:Boolean(enabled),
      payload:{ aiScheduled:true, assignedAgent:employee, instruction:work, priority:normalizedPriority, requestedBy:actor, scheduleId:id },
    });
    await this.audit?.write?.({ organization_id:org,actor_type:"human",actor_id:actor,action:"ai.schedule.registered",entity_type:"ai_schedule",entity_id:id,reason:work,metadata:{agent_id:employee,cron:expression,timezone:zone,requested_by:actor} });
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
