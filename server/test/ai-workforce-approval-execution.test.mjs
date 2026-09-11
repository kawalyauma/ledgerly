import test from "node:test";
import assert from "node:assert/strict";
import { AiApprovalService, AiTaskService } from "../src/ai/services.mjs";
import { AiToolGateway } from "../src/ai/tool-gateway.mjs";

test("approval execution is atomically claimed before side effects",async()=>{
  let state="approved";let storedResult=null;
  const database={query:async(sql,values)=>{const q=String(sql);if(q.startsWith("UPDATE ledgerly_ai.approvals SET status='executing'")){if(state!=="approved")return {rowCount:0,rows:[]};state="executing";return {rowCount:1,rows:[{approval_id:"p1",organization_id:"org-a",agent_id:"a1",requested_action:"send_notice",payload:{message:"Hi"},status:state}]};}if(q.startsWith("UPDATE ledgerly_ai.approvals SET status='executed'")){if(state!=="executing")return {rowCount:0,rows:[]};state="executed";storedResult=JSON.parse(values[0]);return {rowCount:1,rows:[{approval_id:"p1",organization_id:"org-a",status:state,executed_result:storedResult}]};}if(q.startsWith("UPDATE ledgerly_ai.approvals SET status='approved'")){if(state!=="executing")return {rowCount:0,rows:[]};state="approved";return {rowCount:1,rows:[{approval_id:"p1",status:state}]};}if(q.startsWith("SELECT * FROM ledgerly_ai.approvals"))return {rows:[{approval_id:"p1",organization_id:"org-a",status:state,executed_result:storedResult}]};return {rowCount:0,rows:[]};}};
  const service=new AiApprovalService({database,audit:{write:async()=>{}}});
  const context={organizationId:"org-a",userId:"u1"};
  const claimed=await service.claimExecution({context,approvalId:"p1"});
  assert.equal(claimed.status,"executing");
  await assert.rejects(()=>service.claimExecution({context,approvalId:"p1"}),(error)=>error.code==="AI_APPROVAL_STATE_CONFLICT");
  const executed=await service.markExecuted({context,approvalId:"p1",result:{sent:true}});
  assert.equal(executed.status,"executed");
  assert.deepEqual(executed.executed_result,{sent:true});
});

test("gateway claims approval so duplicate execution cannot reach handler twice",async()=>{
  let state="approved",runs=0;
  const approvalService={
    claimExecution:async()=>{if(state!=="approved"){const e=new Error("already claimed");e.code="AI_APPROVAL_STATE_CONFLICT";throw e;}state="executing";return {status:"executing"};},
    markExecuted:async()=>{state="executed";return {status:"executed"};},
    releaseExecution:async()=>{state="approved";return {status:"approved"};},
  };
  const gateway=new AiToolGateway({audit:{write:async()=>{}},approvalService});
  gateway.register({name:"send_notice",permissions:["notifications:send"],risk:"medium",consequential:true,approvalRequired:true,parameters:{type:"object",properties:{message:{type:"string"}},required:["message"],additionalProperties:false}},async()=>{runs++;return {sent:true};});
  const agent={agentId:"a1",name:"Mirembe",role:"Secretary",status:"active",autonomyLevel:3,allowedTools:["send_notice"],permissions:["notifications:send"]};
  const approval={approval_id:"p1",organization_id:"org-a",agent_id:"a1",task_id:"t1",requested_action:"send_notice",payload:{message:"Hi"},status:"approved"};
  const context={organizationId:"org-a",userId:"u1",permissions:["notifications:send"]};
  await gateway.executeApproved({approval,agent,context});
  assert.equal(runs,1);
  await assert.rejects(()=>gateway.executeApproved({approval,agent,context}),(error)=>error.code==="AI_APPROVAL_STATE_CONFLICT");
  assert.equal(runs,1);
});

test("executed approval does not resurrect a parent task cancelled during action",async()=>{
  const database={query:async(sql)=>{const q=String(sql);if(q.startsWith("UPDATE ledgerly_ai.tasks SET status='queued'"))return {rowCount:0,rows:[]};if(q.startsWith("SELECT * FROM ledgerly_ai.tasks"))return {rows:[{task_id:"t1",organization_id:"org-a",status:"cancelled"}]};return {rowCount:0,rows:[]};}};
  const tasks=new AiTaskService({database,queue:{enqueue:async()=>{throw new Error("must not enqueue cancelled task");}},audit:{write:async()=>{}}});
  const result=await tasks.resumeAfterApproval({context:{organizationId:"org-a",userId:"u1"},taskId:"t1",approvalId:"p1",result:{status:"executed"}});
  assert.equal(result.resumed,false);
  assert.equal(result.reason,"parent_cancelled");
});
