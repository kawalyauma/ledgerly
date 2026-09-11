import test from "node:test";
import assert from "node:assert/strict";
import { AiToolGateway } from "../src/ai/tool-gateway.mjs";
import { AiTaskService } from "../src/ai/services.mjs";

const agent={agentId:"finance-1",name:"Amina",role:"Finance Assistant",status:"active",autonomyLevel:1,permissions:["finance:read"],allowedTools:["get_finance_summary","post_payment"]};

test("Finance Assistant can read but cannot execute prohibited payment posting",async()=>{
  const audit={write:async()=>{}};
  const gateway=new AiToolGateway({audit});
  gateway.register({name:"get_finance_summary",permissions:["finance:read"],risk:"low"},async()=>({cash:100}));
  gateway.register({name:"post_payment",permissions:["finance:write"],risk:"prohibited",consequential:true,approvalRequired:true},async()=>({posted:true}));
  const read=await gateway.invoke({agent,context:{organizationId:"org-a",permissions:["finance:read"]},toolName:"get_finance_summary",input:{}});
  assert.equal(read.status,"executed");
  await assert.rejects(()=>gateway.invoke({agent,context:{organizationId:"org-a",permissions:["finance:read","finance:write"]},toolName:"post_payment",input:{amount:10}}),(error)=>error.code==="AI_ACTION_PROHIBITED");
});

test("task creation uses durable Ledgerly job envelope and idempotency",async()=>{
  const queries=[]; const jobs=[];
  const database={query:async(sql,values)=>{queries.push({sql,values});return {rowCount:1,rows:[{task_id:values[0],organization_id:values[1],assigned_agent:values[2]}]};}};
  const queue={enqueue:async(job)=>{jobs.push(job);return {queued:true};}};
  const tasks=new AiTaskService({database,queue,audit:{write:async()=>{}}});
  const created=await tasks.create({context:{organizationId:"org-a",userId:"user-1"},assignedAgent:"agent-1",instruction:"Draft a notice",idempotencyKey:"notice-1"});
  assert.equal(created.organization_id,"org-a");
  assert.equal(jobs.length,1);
  assert.equal(jobs[0].kind,"ai.task");
  assert.equal(jobs[0].organizationId,"org-a");
  assert.equal(jobs[0].payload.taskId,created.task_id);
  assert.match(jobs[0].idempotencyKey,/^ai:/);
});
