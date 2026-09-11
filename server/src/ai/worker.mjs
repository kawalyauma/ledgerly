import { DEFAULT_LIMITS } from "./constants.mjs";
import { aiAttribution } from "./provenance.mjs";

function safeJson(value) { try { return JSON.stringify(value); } catch { return "{}"; } }
function truncate(value, max) { const text=String(value??""); return text.length>max ? `${text.slice(0,max)}\n[truncated]` : text; }
function canonical(value){if(Array.isArray(value))return `[${value.map(canonical).join(",")}]`;if(value&&typeof value==="object"){return `{${Object.keys(value).sort().map((key)=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;}return JSON.stringify(value);}
function replayKey(name,input){return `${String(name)}:${canonical(input??{})}`;}

export class AiWorker {
  #running=0;
  #lastSuccessAt=null;
  #durations=[];
  constructor({ database, queue, agents, taskService, gateway, providerRegistry, providerConfig, knowledge=null, memory=null, audit, authorization=null, limits=DEFAULT_LIMITS, logger=console }) {
    this.database=database; this.queue=queue; this.agents=agents; this.taskService=taskService; this.gateway=gateway;
    this.providerRegistry=providerRegistry; this.providerConfig=providerConfig; this.knowledge=knowledge; this.memory=memory; this.audit=audit;
    this.authorization=authorization; this.limits={...DEFAULT_LIMITS,...limits}; this.logger=logger; this.stopped=true; this.timer=null;
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
      const outcome=await this.execute(item.job);
      await this.queue.ack(item.receipt);
      if(outcome?.text!=null)this.#lastSuccessAt=new Date().toISOString();
      return outcome?.skipped||outcome?.blocked?outcome:{completed:true,jobId:item.job.jobId,...outcome};
    } catch (error) {
      const taskId=item.job.payload?.taskId??item.job.jobId;
      if(error?.code==="AI_TASK_STATE_CONFLICT"){
        await this.queue.ack(item.receipt).catch(()=>undefined);
        return {skipped:true,reason:"task_state_changed",taskId};
      }
      const nonRetryable=["AI_TASK_NOT_FOUND","AI_AGENT_NOT_FOUND","AI_AGENT_DISABLED","AI_AGENT_PAUSED","AI_TOOL_NOT_ALLOWED","AI_PERMISSION_DENIED","AI_ACTION_PROHIBITED","AI_MODEL_NOT_CONFIGURED","AI_MODEL_NOT_INSTALLED","BACKGROUND_ACTOR_REVOKED","BACKGROUND_ACTOR_BLOCKED"].includes(error?.code);
      if (!item.job.payload?.aiScheduled) {
        await this.taskService.setStatus({organizationId:item.job.organizationId,taskId,status:nonRetryable?"failed":"queued",error:error instanceof Error?error.message:String(error),expectedStatuses:["queued","working"]}).catch(()=>undefined);
      }
      if (nonRetryable) await this.queue.deadLetter(item.receipt,{reason:error?.code??"policy_failure"});
      else await this.queue.retry(item.receipt,{reason:error instanceof Error?error.message:String(error)});
      this.logger.error(JSON.stringify({level:"error",component:"ai-worker",taskId,message:error instanceof Error?error.message:String(error),code:error?.code}));
      return {failed:true,retryable:!nonRetryable,error:error instanceof Error?error.message:String(error)};
    } finally {
      const duration=Date.now()-started; this.#durations.push(duration); if (this.#durations.length>100) this.#durations.shift(); this.#running--;
    }
  }

  async materializeScheduledTask(job) {
    const payload=job.payload;
    if (!payload.requestedBy) { const error=new Error("Scheduled AI task has no authorizing actor"); error.code="BACKGROUND_ACTOR_REVOKED"; throw error; }
    await this.#resolveAuthority(job.organizationId,payload.requestedBy);
    const agent=await this.agents.get({organizationId:job.organizationId},payload.assignedAgent);
    if(!agent){const error=new Error("Scheduled AI employee no longer exists");error.code="AI_AGENT_NOT_FOUND";throw error;}
    if(agent.status!=="active"){const error=new Error(`Scheduled AI employee is ${agent.status}`);error.code=agent.status==="disabled"?"AI_AGENT_DISABLED":"AI_AGENT_PAUSED";throw error;}
    const context={organizationId:job.organizationId,userId:payload.requestedBy,userName:payload.requestedBy};
    return this.taskService.create({
      context,
      assignedAgent:payload.assignedAgent,
      instruction:payload.instruction,
      priority:Number(payload.priority??50),
      inputReferences:[{type:"schedule",id:payload.scheduleId??null,scheduledFor:payload.scheduledFor??null}],
      idempotencyKey:`scheduled:${payload.scheduleId??"unknown"}:${payload.scheduledFor??job.createdAt}`,
    });
  }

  async #resolveAuthority(organizationId, actorId) {
    if (!this.authorization?.resolveCurrentActorAccess) return { userId:actorId, organizationId, effectiveScopes:["*"] };
    return this.authorization.resolveCurrentActorAccess({organizationId,actorId});
  }

  async #taskStatus(organizationId,taskId){const result=await this.database.query(`SELECT status FROM ledgerly_ai.tasks WHERE task_id=$1 AND organization_id=$2`,[taskId,organizationId]);return result.rows[0]?.status??null;}
  async #stillWorking(organizationId,taskId){return (await this.#taskStatus(organizationId,taskId))==="working";}

  async execute(job) {
    const org=job.organizationId;
    const taskId=job.payload?.taskId??job.jobId;
    let task=(await this.database.query(`SELECT * FROM ledgerly_ai.tasks WHERE task_id=$1 AND organization_id=$2`,[taskId,org])).rows[0];
    if (!task) { const error=new Error("AI task not found"); error.code="AI_TASK_NOT_FOUND"; throw error; }
    if(task.status!=="queued")return {skipped:true,reason:`task_${task.status}`,taskId};
    const agent=await this.agents.get({organizationId:org},task.assigned_agent);
    if (!agent) { const error=new Error("Assigned AI employee not found"); error.code="AI_AGENT_NOT_FOUND"; throw error; }
    if (agent.status==="paused") { await this.taskService.setStatus({organizationId:org,taskId,status:"blocked",agent,error:"AI employee is paused",expectedStatuses:["queued"]}); return {blocked:true,reason:"agent_paused",taskId}; }
    if (agent.status!=="active") { const error=new Error(`AI employee is ${agent.status}`); error.code="AI_AGENT_DISABLED"; throw error; }
    task=await this.taskService.claimQueued({organizationId:org,taskId,agent});
    if(!task)return {skipped:true,reason:"task_already_claimed",taskId};
    const authority=await this.#resolveAuthority(org,task.requested_by);
    const authorityScopes=authority.effectiveScopes??authority.scopes??[];
    const permissions=this.authorization?.intersectPermissions
      ? this.authorization.intersectPermissions(authorityScopes,agent.permissions??[])
      : agent.permissions??[];

    const provider=this.providerRegistry.create(agent.provider??this.providerConfig.provider??"ollama",{...this.providerConfig,model:agent.model??this.providerConfig.model});
    const health=await provider.health();
    if (!health.ok) { const error=new Error(health.error??`AI runtime unavailable: ${health.state}`); error.code=health.code??(health.modelInstalled===false?"AI_MODEL_NOT_INSTALLED":"AI_RUNTIME_OFFLINE"); throw error; }
    if(!await this.#stillWorking(org,taskId))return {skipped:true,reason:"task_cancelled_during_start",taskId};

    const attribution=aiAttribution({agent,taskId,reason:task.instruction});
    const context={organizationId:org,userId:task.requested_by,permissions,reason:task.instruction,authority,provenance:attribution};
    const memories=this.memory ? await this.memory.list({context:{organizationId:org},agentId:agent.agentId,type:"durable"}) : [];
    const sources=this.knowledge && (agent.knowledgeSources?.length) ? await this.knowledge.retrieve({context:{organizationId:org},query:task.instruction,sourceIds:agent.knowledgeSources,limit:8}) : [];
    const executedApprovals=(await this.database.query(`SELECT approval_id,requested_action,payload,executed_result FROM ledgerly_ai.approvals WHERE organization_id=$1 AND task_id=$2 AND status='executed' ORDER BY executed_at`,[org,taskId])).rows;
    const approvalReplay=new Map(executedApprovals.map((item)=>[replayKey(item.requested_action,item.payload),{approvalId:item.approval_id,result:item.executed_result?.output??item.executed_result}]));
    const messages=[
      {role:"system",content:truncate(`${agent.systemInstructions||defaultInstructions(agent)}\n\nSecurity: never request database credentials or unrestricted SQL. Use only provided Ledgerly tools.\nAI review is not official approval.`,this.limits.maxPromptChars)},
      {role:"system",content:truncate(`Durable structured memory: ${safeJson(memories.map((m)=>({key:m.key,value:m.value})))}`,8000)},
      {role:"system",content:truncate(`Permitted knowledge excerpts with source references: ${safeJson(sources.map((s)=>({source_id:s.source_id,chunk_id:s.chunk_id,content:s.content})))}`,16000)},
      ...(executedApprovals.length?[{role:"system",content:truncate(`These human-approved tool actions have already executed successfully. Do not execute them again; if the same tool and payload is requested, Ledgerly will replay the saved result: ${safeJson(executedApprovals.map((a)=>({approval_id:a.approval_id,tool:a.requested_action,payload:a.payload,result:a.executed_result?.output??a.executed_result})))}`,12000)}]:[]),
      {role:"user",content:truncate(task.instruction,this.limits.maxPromptChars)},
    ];
    const tools=this.gateway.describeForAgent({...agent,permissions}).map((tool)=>({type:"function",function:{name:tool.name,description:tool.description??tool.name,parameters:tool.parameters??{type:"object",additionalProperties:true}}}));
    let toolCalls=0;
    for (;;) {
      if(!await this.#stillWorking(org,taskId))return {skipped:true,reason:"task_cancelled",taskId};
      const result=await withDeadline(()=>provider.generate({messages,tools,maxTokens:Math.ceil(this.limits.maxOutputChars/4)}),this.limits.taskTimeoutMs);
      if(!await this.#stillWorking(org,taskId))return {skipped:true,reason:"task_cancelled",taskId};
      const message=result.message??{};
      const calls=Array.isArray(message.tool_calls)?message.tool_calls:[];
      if (!calls.length) {
        const text=truncate(message.content??"",this.limits.maxOutputChars);
        const refs=sources.map((s)=>({type:"knowledge",sourceId:s.source_id,chunkId:s.chunk_id}));
        await this.taskService.setStatus({organizationId:org,taskId,status:"completed",agent,outputReferences:[...refs,{type:"text",content:text,provider:result.provider,model:result.model}],expectedStatuses:["working"]});
        await this.audit?.write?.({organization_id:org,actor_type:"ai_agent",actor_id:agent.agentId,agent_id:agent.agentId,agent_name:agent.name,agent_role:agent.role,action:"ai.task.inference_completed",entity_type:"ai_task",entity_id:taskId,reason:task.instruction,metadata:{provider:result.provider,model:result.model,tool_calls:toolCalls,source_refs:refs,authorized_by:task.requested_by}});
        return {text,refs};
      }
      toolCalls+=calls.length;
      if (toolCalls>this.limits.maxToolCalls) { const error=new Error("AI tool-call limit exceeded"); error.code="AI_TOOL_LOOP_LIMIT"; throw error; }
      messages.push({role:"assistant",content:message.content??"",tool_calls:calls});
      for (const call of calls) {
        if(!await this.#stillWorking(org,taskId))return {skipped:true,reason:"task_cancelled",taskId};
        const name=call.function?.name; let input={};
        try { input=typeof call.function?.arguments==="string"?JSON.parse(call.function.arguments||"{}"):call.function?.arguments??{}; } catch { const error=new Error(`Invalid tool arguments from model for ${name}`); error.code="AI_TOOL_ARGUMENTS_INVALID"; throw error; }
        const effectiveAgent={...agent,permissions};
        const key=replayKey(name,input);
        let output;
        if(approvalReplay.has(key)){
          const replay=approvalReplay.get(key);
          output={status:"executed",output:replay.result,policy:{decision:"allow",approved:true,replayed:true},approval:{approval_id:replay.approvalId}};
          await this.audit?.write?.({organization_id:org,actor_type:"ai_agent",actor_id:agent.agentId,agent_id:agent.agentId,agent_name:agent.name,agent_role:agent.role,action:"ai.tool.replayed_after_approval",entity_type:"ai_tool",entity_id:name,reason:task.instruction,metadata:{task_id:taskId,approval_id:replay.approvalId}});
        } else {
          output=await this.gateway.invoke({agent:effectiveAgent,context,taskId,toolName:name,input});
        }
        messages.push({role:"tool",tool_name:name,content:truncate(safeJson(output),12000)});
        if (output.status==="waiting_for_approval") {
          await this.taskService.setStatus({organizationId:org,taskId,status:"waiting_for_approval",agent,outputReferences:[{type:"approval",id:output.approval?.approval_id??null}],expectedStatuses:["working"]});
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
