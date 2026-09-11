import test from "node:test";
import assert from "node:assert/strict";
import { AiTaskService } from "../src/ai/services.mjs";
import { AiWorker } from "../src/ai/worker.mjs";

test("executed approval requeues waiting task with a durable idempotency key",async()=>{
  const jobs=[];
  const database={query:async(sql)=>{
    if(String(sql).startsWith("UPDATE ledgerly_ai.tasks SET status='queued'"))return {rowCount:1,rows:[{task_id:"task-1",organization_id:"org-a",status:"queued"}]};
    return {rowCount:0,rows:[]};
  }};
  const tasks=new AiTaskService({database,queue:{enqueue:async(job)=>{jobs.push(job);return {queued:true};}},audit:{write:async()=>{}}});
  const resumed=await tasks.resumeAfterApproval({context:{organizationId:"org-a",userId:"approver-1"},taskId:"task-1",approvalId:"approval-1",result:{status:"executed",output:{sent:true}}});
  assert.equal(resumed.resumed,true);
  assert.equal(jobs.length,1);
  assert.equal(jobs[0].kind,"ai.task");
  assert.equal(jobs[0].organizationId,"org-a");
  assert.equal(jobs[0].payload.taskId,"task-1");
  assert.match(jobs[0].idempotencyKey,/approval:approval-1$/);
});

test("resumed worker replays already executed approval instead of invoking tool twice",async()=>{
  const statuses=[];let gatewayInvocations=0;let generation=0;let currentStatus="queued";
  const task={task_id:"task-1",organization_id:"org-a",assigned_agent:"agent-1",requested_by:"user-1",instruction:"Send the approved notice",status:"queued"};
  const approval={approval_id:"approval-1",requested_action:"send_notification",payload:{message:"Approved text"},executed_result:{status:"executed",output:{sent:true}}};
  const database={query:async(sql)=>{
    const text=String(sql);
    if(text.startsWith("SELECT status FROM ledgerly_ai.tasks"))return {rows:[{status:currentStatus}]};
    if(text.includes("FROM ledgerly_ai.tasks"))return {rows:[{...task,status:currentStatus}]};
    if(text.includes("FROM ledgerly_ai.approvals"))return {rows:[approval]};
    return {rows:[]};
  }};
  const provider={health:async()=>({ok:true}),generate:async()=>{generation++;if(generation===1)return {provider:"mock",model:"mock",message:{content:"",tool_calls:[{function:{name:"send_notification",arguments:JSON.stringify({message:"Approved text"})}}]}};return {provider:"mock",model:"mock",message:{content:"Notice sent",tool_calls:[]}};}};
  const worker=new AiWorker({
    database,queue:{},agents:{get:async()=>({agentId:"agent-1",name:"Mirembe",role:"Secretary",department:"Administration",status:"active",provider:"mock",permissions:["notifications:send"],allowedTools:["send_notification"],knowledgeSources:[]})},
    taskService:{claimQueued:async()=>{currentStatus="working";return {...task,status:"working"};},setStatus:async(input)=>{statuses.push(input);currentStatus=input.status;return input;}},
    gateway:{describeForAgent:()=>[{name:"send_notification"}],invoke:async()=>{gatewayInvocations++;return {status:"executed",output:{sent:true}};}},
    providerRegistry:{create:()=>provider},providerConfig:{provider:"mock"},audit:{write:async()=>{}},
    authorization:{resolveCurrentActorAccess:async()=>({effectiveScopes:["notifications:send"]}),intersectPermissions:(actor,agent)=>agent.filter((p)=>actor.includes(p))},
    limits:{maxConcurrentTasks:1,maxToolCalls:4,maxPromptChars:10000,maxOutputChars:10000,taskTimeoutMs:5000,maxRetries:1,maxHandoffs:1},logger:{error:()=>{}},
  });
  const result=await worker.execute({organizationId:"org-a",jobId:"task-1",payload:{taskId:"task-1",resumedFromApproval:"approval-1"}});
  assert.equal(result.text,"Notice sent");
  assert.equal(gatewayInvocations,0);
  assert.ok(statuses.some((item)=>item.status==="completed"&&item.expectedStatuses?.includes("working")));
});

test("worker skips a stale cancelled queue delivery before model inference",async()=>{
  let generated=false;
  const database={query:async(sql)=>String(sql).includes("FROM ledgerly_ai.tasks")?{rows:[{task_id:"task-1",organization_id:"org-a",assigned_agent:"agent-1",requested_by:"u1",instruction:"Do not run",status:"cancelled"}]}:{rows:[]}};
  const worker=new AiWorker({database,queue:{},agents:{get:async()=>{throw new Error("agent lookup should not happen")}},taskService:{},gateway:{},providerRegistry:{create:()=>({generate:async()=>{generated=true;}})},providerConfig:{},audit:{write:async()=>{}},limits:{maxConcurrentTasks:1,maxToolCalls:2,maxPromptChars:1000,maxOutputChars:1000,taskTimeoutMs:1000,maxRetries:1,maxHandoffs:1},logger:{error:()=>{}}});
  const result=await worker.execute({organizationId:"org-a",jobId:"task-1",payload:{taskId:"task-1"}});
  assert.equal(result.skipped,true);
  assert.equal(result.reason,"task_cancelled");
  assert.equal(generated,false);
});
