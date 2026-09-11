import test from "node:test";
import assert from "node:assert/strict";
import { AiToolGateway } from "../src/ai/tool-gateway.mjs";
import { AiApprovalService, AiTaskService } from "../src/ai/services.mjs";
import { AiAcademicService } from "../src/ai/academic-service.mjs";

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
  const database={query:async(sql,values)=>{queries.push({sql,values});return {rowCount:1,rows:[{task_id:values[0],organization_id:values[1],assigned_agent:values[2],status:"queued"}]};}};
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

test("queued task claim is atomic and does not claim stale states",async()=>{
  const calls=[];
  const database={query:async(sql,values)=>{calls.push({sql,values});return String(sql).includes("status='queued'")?{rowCount:1,rows:[{task_id:"task-1",status:"working",attempts:1}]}:{rowCount:0,rows:[]};}};
  const tasks=new AiTaskService({database,queue:{enqueue:async()=>({})},audit:{write:async()=>{}}});
  const claimed=await tasks.claimQueued({organizationId:"org-a",taskId:"task-1",agent:{agentId:"a1",name:"Agent",role:"Role"}});
  assert.equal(claimed.status,"working");
  assert.match(calls[0].sql,/WHERE task_id=\$1 AND organization_id=\$2 AND status='queued'/);
});

test("task cancellation atomically cancels pending approvals",async()=>{
  const calls=[];
  const tx={query:async(sql,values)=>{calls.push({sql,values});if(String(sql).startsWith("UPDATE ledgerly_ai.tasks SET status='cancelled'"))return {rowCount:1,rows:[{task_id:"task-1",status:"cancelled"}]};return {rowCount:1,rows:[]};}};
  const database={transaction:async(work)=>work(tx),query:async()=>({rows:[]})};
  const tasks=new AiTaskService({database,queue:{enqueue:async()=>({})},audit:{write:async()=>{}}});
  const cancelled=await tasks.cancel({context:{organizationId:"org-a",userId:"user-1"},taskId:"task-1",reason:"No longer needed"});
  assert.equal(cancelled.status,"cancelled");
  assert.ok(calls.some(({sql})=>String(sql).includes("UPDATE ledgerly_ai.approvals SET status='cancelled'")));
});

test("approval request locks the working task before creating consequential approval",async()=>{
  const calls=[];
  const tx={query:async(sql,values)=>{calls.push({sql,values});if(String(sql).startsWith("SELECT status FROM ledgerly_ai.tasks"))return {rows:[{status:"working"}]};return {rowCount:1,rows:[{approval_id:"approval-1",organization_id:"org-a"}]};}};
  const database={transaction:async(work)=>work(tx)};
  const approvals=new AiApprovalService({database,audit:{write:async()=>{}}});
  const created=await approvals.request({organizationId:"org-a",agent:{agentId:"a1",name:"Mirembe",role:"Secretary"},taskId:"task-1",action:"send_notification",payload:{message:"Hi"}});
  assert.equal(created.approval_id,"approval-1");
  assert.match(calls[0].sql,/FOR UPDATE/);
});

test("academic HTTP contract delegates requestDraft and requestReview to durable tasks",async()=>{
  const created=[];
  const tasks={create:async(input)=>{created.push(input);return {task_id:`t-${created.length}`};}};
  const database={query:async()=>({rows:[{document_id:"doc-1",status:"draft",type:"lesson_plan"}]})};
  const academic=new AiAcademicService({database,tasks,documents:{},audit:{write:async()=>{}}});
  const context={organizationId:"org-a",userId:"user-1"};
  const draft=await academic.requestDraft({context,agentId:"academic-1",instruction:"Draft P3 weather lesson",academicContext:{lessonPlanId:"lp-1"}});
  const review=await academic.requestReview({context,reviewerAgentId:"reviewer-1",documentId:"doc-1"});
  assert.equal(draft.task_id,"t-1");
  assert.equal(review.task_id,"t-2");
  assert.equal(created[0].assignedAgent,"academic-1");
  assert.equal(created[1].assignedAgent,"reviewer-1");
  assert.equal(created[1].inputReferences[0].id,"doc-1");
});
