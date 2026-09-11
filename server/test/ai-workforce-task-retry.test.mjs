import test from "node:test";
import assert from "node:assert/strict";
import { AiTaskService } from "../src/ai/services.mjs";
import { AiScheduleService } from "../src/ai/schedules.mjs";

test("blocked task can be retried with a durable unique queue key",async()=>{
  const jobs=[];let history=[];
  const tx={query:async(sql,values)=>{
    const text=String(sql);
    if(text.startsWith("SELECT * FROM ledgerly_ai.tasks"))return {rows:[{task_id:"task-1",organization_id:"org-a",status:"blocked",history}]};
    if(text.startsWith("UPDATE ledgerly_ai.tasks SET status='queued'")){history=[...history,{type:"manual_retry",retry_id:values[0]}];return {rowCount:1,rows:[{task_id:"task-1",organization_id:"org-a",status:"queued",history}]};}
    return {rows:[],rowCount:0};
  }};
  const database={transaction:async(work)=>work(tx)};
  const tasks=new AiTaskService({database,queue:{enqueue:async(job)=>{jobs.push(job);return {queued:true};}},audit:{write:async()=>{}}});
  const retried=await tasks.retry({context:{organizationId:"org-a",userId:"u1"},taskId:"task-1",reason:"Employee resumed"});
  assert.equal(retried.status,"queued");
  assert.equal(jobs.length,1);
  assert.match(jobs[0].idempotencyKey,/^ai:task-1:retry:/);
});

test("queued retry recovery republishes the same manual retry id",async()=>{
  const jobs=[];const history=[{type:"manual_retry",retry_id:"retry-123"}];
  const tx={query:async(sql)=>String(sql).startsWith("SELECT * FROM ledgerly_ai.tasks")?{rows:[{task_id:"task-1",organization_id:"org-a",status:"queued",history}]}:{rows:[],rowCount:0}};
  const tasks=new AiTaskService({database:{transaction:async(work)=>work(tx)},queue:{enqueue:async(job)=>{jobs.push(job);return {queued:true};}},audit:{write:async()=>{}}});
  const retried=await tasks.retry({context:{organizationId:"org-a",userId:"u1"},taskId:"task-1"});
  assert.equal(retried.retryRecovered,true);
  assert.match(jobs[0].idempotencyKey,/retry:retry-123$/);
});

test("AI schedule ids cannot escape the organization namespace",async()=>{
  let registered=false;
  const service=new AiScheduleService({scheduler:{register:async()=>{registered=true;return {};},list:async()=>[]},audit:{write:async()=>{}}});
  await assert.rejects(()=>service.register({context:{organizationId:"org-a",userId:"u1"},scheduleId:"ai:org-b:agent:nightly",name:"Nightly",agentId:"a1",instruction:"Prepare report",cron:"0 8 * * *"}),(error)=>error.code==="AI_SCHEDULE_INVALID");
  assert.equal(registered,false);
});

test("generated AI schedule id and payload remain tenant scoped",async()=>{
  let input;
  const service=new AiScheduleService({scheduler:{register:async(value)=>{input=value;return value;},list:async()=>[]},audit:{write:async()=>{}}});
  await service.register({context:{organizationId:"org-a",userId:"u1"},name:"Morning report",agentId:"a1",instruction:"Prepare report",cron:"0 8 * * *",priority:60});
  assert.match(input.id,/^ai:org-a:a1:/);
  assert.equal(input.organizationId,"org-a");
  assert.equal(input.payload.requestedBy,"u1");
  assert.equal(input.payload.priority,60);
});
