import { DEFAULT_LIMITS } from "./constants.mjs";

function safeJson(value) { try { return JSON.stringify(value); } catch { return "{}"; } }
function truncate(value, max) { const text=String(value??""); return text.length>max ? `${text.slice(0,max)}\n[truncated]` : text; }

const PERMANENT_AUTH_CODES = new Set([
  "AI_AGENT_DISABLED",
  "AI_TOOL_NOT_ALLOWED",
  "AI_PERMISSION_DENIED",
  "AI_ACTION_PROHIBITED",
  "BACKGROUND_ACTOR_REVOKED",
  "BACKGROUND_ACTOR_BLOCKED",
]);

export class AiWorker {
  #running=0;
  #lastSuccessAt=null;
  #durations=[];
  constructor({ database, queue, agents, taskService, gateway, providerRegistry, providerConfig, knowledge=null, memory=null, audit, authorization, limits=DEFAULT_LIMITS, logger=console }) {
    if (!authorization?.resolveCurrentActorAccess || !authorization?.intersectPermissions) {
      throw new TypeError("AiWorker requires live background authorization services");
    }
    this.database=database; this.queue=queue; this.agents=agents; this.taskService=taskService; this.gateway=gateway;
    this.providerRegistry=providerRegistry; this.providerConfig=providerConfig; this.knowledge=knowledge; this.memory=memory; this.audit=audit; this.authorization=authorization;
    this.limits={...DEFAULT_LIMITS,...limits}; this.logger=logger; this.stopped=true; this.timer=null;
  }

  status() {
    const avg=this.#durations.length ? Math.round(this.#durations.reduce((a,b)=>a+b,0)/this.#durations.length) : null;
    return { running:!this.stopped, activeWorkers:this.#running, maxConcurrentTasks:this.limits.maxConcurrentTasks, averageExecutionDurationMs:avg, lastSuccessfulTask:this.#lastSuccessAt };
  }

  async runOnce() {
    if (this.#running>=this.limits.maxConcurrentTasks) return {skipped:true,reason:"concurrency_limit"};
    const item=await this.queue.take();
    if (!item) return {idle:true};
    if (item.job.kind!=="ai.task") { await this.queue.retry(item.receipt,{reason:"not_ai_task"}); return {skipped:true,reason:"not_ai_task"}; }
    this.#running++;
    const started=Date.now();
    try {
      if (item.job.payload?.aiScheduled && !item.job.payload?.taskId) {
        const scheduled=await this.materializeScheduledTask(item.job);
        await this.queue.ack(item.receipt);
        return {scheduled:true,taskId:scheduled.task_id};
      }
      await this.execute(item.job);
      await this.queue.ack(item.receipt);
      this.#lastSuccessAt=new Date().toISOString();
      return {completed:true,jobId:item.job.jobId};
    } catch (error) {
      const taskId=item.job.payload?.taskId??item.job.jobId;
      const retryable=!PERMANENT_AUTH_CODES.has(error?.code);
      if (!item.job.payload?.aiScheduled) {
        await this.taskService.setStatus({organizationId:item.job.organizationId,taskId,status:retryable?"queued":"failed",error:error instanceof Error?error.message:String(error)}).catch(()=>undefined);
      }
      if (retryable) await this.queue.retry(item.receipt,{reason:error instanceof Error?error.message:String(error)});
      else await this.queue.deadLetter(item.receipt,{reason:error?.code??"policy_failure"});
      this.logger.error(JSON.stringify({level:"error",component:"ai-worker",taskId,message:error instanceof Error?error.message:String(error),code:error?.code}));
      return {failed:true,retryable,error:error instanceof Error?error.message:String(error)};
    } finally {
      const duration=Date.now()-started; this.#durations.push(duration); if (this.#durations.length>100) this.#durations.shift(); this.#running--;
    }
  }

  async materializeScheduledTask(job) {
    const payload=job.payload;
    if (!payload.requestedBy) {
      const error=new Error("Scheduled AI task is missing its original requester");
      error.code="BACKGROUND_ACTOR_REVOKED";
      throw error;
    }
    await this.authorization.resolveCurrentActorAccess({organizationId:job.organizationId,actorId:payload.requestedBy});
    const context={organizationId:job.organizationId,userId:payload.requestedBy,userName:"Scheduled requester"};
    return this.taskService.create({
      context,
      assignedAgent:payload.assignedAgent,
      instruction:payload.instruction,
      priority:Number(payload.priority??50),
      inputReferences:[{type:"schedule",id:payload.scheduleId??null,scheduledFor:payload.scheduledFor??null}],
      idempotencyKey:`scheduled:${payload.scheduleId??"unknown"}:${payload.scheduledFor??job.createdAt}`,
    });
  }

  async execute(job) {
    const org=job.organizationId;
    const taskId=job.payload?.taskId??job.jobId;
    const task=(await this.database.query(`SELECT * FROM ledgerly_ai.tasks WHERE task_id=$1 AND organization_id=$2`,[taskId,org])).rows[0];
    if (!task) throw new Error("AI task not found");
    if (!task.requested_by) {
      const error=new Error("AI task has no attributable requester");
      error.code="BACKGROUND_ACTOR_REVOKED";
      throw error;
    }
    const requester=await this.authorization.resolveCurrentActorAccess({organizationId:org,actorId:task.requested_by});
    const agent=await this.agents.get({organizationId:org},task.assigned_agent);
    if (!agent) throw new Error("Assigned AI agent not found");
    if (agent.status==="disabled") { const error=new Error("AI agent is disabled"); error.code="AI_AGENT_DISABLED"; throw error; }
    const effectivePermissions=this.authorization.intersectPermissions(requester.effectiveScopes,agent.permissions??[]);
    await this.taskService.setStatus({organizationId:org,taskId,status:"working",agent});

    const provider=this.providerRegistry.create(agent.provider??"ollama",{...this.providerConfig,model:agent.model??this.providerConfig.model});
    const health=await provider.health();
    if (!health.ok) { const error=new Error(health.error??`AI runtime unavailable: ${health.state}`); error.code=health.code??(health.modelInstalled===false?"AI_MODEL_NOT_INSTALLED":"AI_RUNTIME_OFFLINE"); throw error; }

    const context={organizationId:org,userId:task.requested_by,permissions:effectivePermissions,reason:task.instruction};
    const memories=this.memory ? await this.memory.list({context:{organizationId:org},agentId:agent.agentId,type:"durable"}) : [];
    const sources=this.knowledge && (agent.knowledgeSources?.length) ? await this.knowledge.retrieve({context:{organizationId:org},query:task.instruction,sourceIds:agent.knowledgeSources,limit:8}) : [];
    const messages=[
      {role:"system",content:truncate(`${agent.systemInstructions||defaultInstructions(agent)}\n\nSecurity: never request database credentials or unrestricted SQL. Use only provided Ledgerly tools. Your effective tool authority is the intersection of the requester's current permissions and your own assigned permissions. AI review is not official approval.`,this.limits.maxPromptChars)},
      {role:"system",content:truncate(`Durable structured memory: ${safeJson(memories.map((m)=>({key:m.key,value:m.value})))}`,8000)},
      {role:"system",content:truncate(`Permitted knowledge excerpts with source references: ${safeJson(sources.map((s)=>({source_id:s.source_id,chunk_id:s.chunk_id,content:s.content})))}`,16000)},
      {role:"user",content:truncate(task.instruction,this.limits.maxPromptChars)},
    ];
    const tools=this.gateway.describeForAgent(agent,effectivePermissions).map((tool)=>({type:"function",function:{name:tool.name,description:tool.description??tool.name,parameters:tool.parameters??{type:"object",additionalProperties:true}}}));
    let toolCalls=0;
    for (;;) {
      const result=await withDeadline(()=>provider.generate({messages,tools,maxTokens:Math.ceil(this.limits.maxOutputChars/4)}),this.limits.taskTimeoutMs);
      const message=result.message??{};
      const calls=Array.isArray(message.tool_calls)?message.tool_calls:[];
      if (!calls.length) {
        const text=truncate(message.content??"",this.limits.maxOutputChars);
        const refs=sources.map((s)=>({type:"knowledge",sourceId:s.source_id,chunkId:s.chunk_id}));
        await this.taskService.setStatus({organizationId:org,taskId,status:"completed",agent,outputReferences:[...refs,{type:"text",content:text,provider:result.provider,model:result.model}]});
        await this.audit?.write?.({organization_id:org,actor_type:"ai_agent",actor_id:agent.agentId,agent_id:agent.agentId,agent_name:agent.name,agent_role:agent.role,action:"ai.task.inference_completed",entity_type:"ai_task",entity_id:taskId,reason:task.instruction,metadata:{provider:result.provider,model:result.model,tool_calls:toolCalls,source_refs:refs,requested_by:task.requested_by}});
        return {text,refs};
      }
      toolCalls+=calls.length;
      if (toolCalls>this.limits.maxToolCalls) { const error=new Error("AI tool-call limit exceeded"); error.code="AI_TOOL_LOOP_LIMIT"; throw error; }
      messages.push({role:"assistant",content:message.content??"",tool_calls:calls});
      for (const call of calls) {
        const name=call.function?.name; let input={};
        try { input=typeof call.function?.arguments==="string"?JSON.parse(call.function.arguments||"{}"):call.function?.arguments??{}; } catch { throw new Error(`Invalid tool arguments from model for ${name}`); }
        const output=await this.gateway.invoke({agent,context,taskId,toolName:name,input});
        messages.push({role:"tool",tool_name:name,content:truncate(safeJson(output),12000)});
        if (output.status==="waiting_for_approval") {
          await this.taskService.setStatus({organizationId:org,taskId,status:"waiting_for_approval",agent,outputReferences:[{type:"approval",id:output.approval?.approval_id??null}]});
          return output;
        }
      }
    }
  }

  start(intervalMs=500) {
    if (!this.stopped) return; this.stopped=false;
    const tick=()=>{ if (this.stopped) return; const launches=Math.max(1,this.limits.maxConcurrentTasks-this.#running); for(let i=0;i<launches;i++) void this.runOnce(); };
    tick(); this.timer=setInterval(tick,intervalMs); this.timer.unref?.();
  }
  async stop() { this.stopped=true; if(this.timer) clearInterval(this.timer); this.timer=null; while(this.#running) await new Promise((r)=>setTimeout(r,20)); }
}

function defaultInstructions(agent) { return `You are ${agent.name}, Ledgerly's ${agent.role} in ${agent.department??"the organization"}. Be precise, preserve tenant boundaries, use tools only when necessary, and state when human approval is required.`; }
function withDeadline(work,ms) {
  let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{const e=new Error("AI task timed out");e.code="AI_TASK_TIMEOUT";reject(e);},ms);});
  return Promise.race([work(),timeout]).finally(()=>clearTimeout(timer));
}
