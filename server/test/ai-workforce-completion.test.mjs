import test from "node:test";
import assert from "node:assert/strict";
import { AiWorker } from "../src/ai/worker.mjs";
import { AiTaskService } from "../src/ai/services.mjs";

test("scheduled occurrence for a paused employee dead-letters without creating a task",async()=>{
  const dead=[],retried=[];let created=0;
  const queue={
    take:async()=>({receipt:"receipt-1",job:{jobId:"schedule-job",kind:"ai.task",organizationId:"org-a",createdAt:new Date().toISOString(),payload:{aiScheduled:true,assignedAgent:"agent-1",requestedBy:"user-1",instruction:"Run daily review",scheduleId:"sched-1",scheduledFor:"2026-09-11T07:00:00.000Z"}}}),
    ack:async()=>true,
    retry:async(receipt,meta)=>{retried.push({receipt,meta})},
    deadLetter:async(receipt,meta)=>{dead.push({receipt,meta})},
  };
  const worker=new AiWorker({
    database:{query:async()=>({rows:[]})},queue,
    agents:{get:async()=>({agentId:"agent-1",name:"Mirembe",role:"Secretary",status:"paused"})},
    taskService:{create:async()=>{created++;return {task_id:"should-not-exist"}},setStatus:async()=>{}},
    gateway:{},providerRegistry:{},providerConfig:{},audit:{write:async()=>{}},
    authorization:{resolveCurrentActorAccess:async()=>({userId:"user-1",organizationId:"org-a",effectiveScopes:["ai:write"]})},
    limits:{maxConcurrentTasks:1,maxToolCalls:2,maxPromptChars:1000,maxOutputChars:1000,taskTimeoutMs:1000,maxRetries:1,maxHandoffs:1},logger:{error:()=>{}},
  });
  const result=await worker.runOnce();
  assert.equal(result.failed,true);
  assert.equal(result.retryable,false);
  assert.equal(created,0);
  assert.equal(retried.length,0);
  assert.equal(dead.length,1);
  assert.equal(dead[0].meta.reason,"AI_AGENT_PAUSED");
});

test("AI handoff preserves original human authority and parent lineage",async()=>{
  const queries=[],jobs=[],audits=[];
  const database={query:async(sql,values)=>{
    queries.push({sql:String(sql),values});
    if(String(sql).startsWith("INSERT INTO ledgerly_ai.tasks"))return {rowCount:1,rows:[{task_id:values[0],organization_id:values[1],assigned_agent:values[2],requested_by:values[3],status:"queued",parent_task_id:values[9],handoff_depth:values[10]}]};
    return {rowCount:0,rows:[]};
  }};
  const tasks=new AiTaskService({database,queue:{enqueue:async(job)=>{jobs.push(job);return {queued:true}}},audit:{write:async(entry)=>audits.push(entry)},limits:{maxPromptChars:5000,maxHandoffs:3}});
  const parent={task_id:"11111111-1111-4111-8111-111111111111",requested_by:"human-owner",priority:40,output_references:[{type:"text",content:"draft"}],handoff_depth:1};
  const child=await tasks.handoff({context:{organizationId:"org-a",userId:"temporary-user"},task:parent,fromAgent:{agentId:"academic-1",name:"Nabirye",role:"Academic Assistant"},toAgent:"reviewer-1",instruction:"Review this lesson plan"});
  const insert=queries.find((item)=>item.sql.startsWith("INSERT INTO ledgerly_ai.tasks"));
  assert.ok(insert);
  assert.equal(insert.values[3],"human-owner");
  assert.equal(insert.values[9],parent.task_id);
  assert.equal(insert.values[10],2);
  assert.equal(child.parent_task_id,parent.task_id);
  assert.equal(jobs.length,1);
  assert.ok(audits.some((entry)=>entry.action==="ai.task.handoff"&&entry.metadata?.child_task_id===child.task_id));
});
