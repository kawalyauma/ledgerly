import test from "node:test";
import assert from "node:assert/strict";
import { AiApprovalService } from "../src/ai/services.mjs";

function makeApprovalDatabase(initialStatus="approved",requestedApprover=null) {
  const state={approval_id:"approval-1",organization_id:"org-1",agent_id:"agent-1",requested_action:"send_notification",status:initialStatus,requested_approver:requestedApprover,executed_result:null};
  return {
    state,
    database:{
      async query(sql,params=[]) {
        if(sql.startsWith("UPDATE ledgerly_ai.approvals SET status=$1")) {
          const [status,userId,reason,,,requestedUser,wildcard]=params;
          if(state.status!=="pending")return {rows:[],rowCount:0};
          if(state.requested_approver&&state.requested_approver!==requestedUser&&!wildcard)return {rows:[],rowCount:0};
          state.status=status;state.decision_by=userId;state.decision_reason=reason;
          return {rows:[{...state}],rowCount:1};
        }
        if(sql.includes("SET status='executing'")) {
          if(state.status!=="approved")return {rows:[],rowCount:0};
          state.status="executing";
          return {rows:[{...state}],rowCount:1};
        }
        if(sql.includes("SET status='executed'")) {
          if(state.status!=="executing")return {rows:[],rowCount:0};
          state.status="executed";
          state.executed_result=JSON.parse(params[0]);
          return {rows:[{...state}],rowCount:1};
        }
        if(sql.includes("SET status='execution_failed'")) {
          if(state.status!=="executing")return {rows:[],rowCount:0};
          state.status="execution_failed";
          state.executed_result=JSON.parse(params[0]);
          return {rows:[{...state}],rowCount:1};
        }
        throw new Error(`unexpected SQL in approval test: ${sql}`);
      },
    },
  };
}

const context={organizationId:"org-1",userId:"approver-1",permissions:["ai:approve"]};

test("only one concurrent caller can claim an approved AI action",async()=>{
  const {database,state}=makeApprovalDatabase();
  const service=new AiApprovalService({database,audit:null});
  const first=await service.claimExecution({context,approvalId:"approval-1"});
  assert.equal(first.status,"executing");
  await assert.rejects(
    service.claimExecution({context,approvalId:"approval-1"}),
    (error)=>error?.code==="AI_APPROVAL_NOT_EXECUTABLE"&&error?.status===409,
  );
  assert.equal(state.status,"executing");
});

test("successful approved action execution can only complete from executing state",async()=>{
  const {database,state}=makeApprovalDatabase();
  const service=new AiApprovalService({database,audit:null});
  await service.claimExecution({context,approvalId:"approval-1"});
  const completed=await service.markExecuted({context,approvalId:"approval-1",result:{messageId:"msg-1"}});
  assert.equal(completed.status,"executed");
  assert.deepEqual(state.executed_result,{messageId:"msg-1"});
  await assert.rejects(service.markExecuted({context,approvalId:"approval-1",result:{messageId:"msg-2"}}));
});

test("failed approved action execution becomes terminal instead of being retried blindly",async()=>{
  const {database,state}=makeApprovalDatabase();
  const service=new AiApprovalService({database,audit:null});
  await service.claimExecution({context,approvalId:"approval-1"});
  const failed=await service.markExecutionFailed({context,approvalId:"approval-1",error:Object.assign(new Error("provider rejected request"),{code:"UPSTREAM_REJECTED"})});
  assert.equal(failed.status,"execution_failed");
  assert.equal(state.executed_result.code,"UPSTREAM_REJECTED");
  await assert.rejects(service.claimExecution({context,approvalId:"approval-1"}),(error)=>error?.code==="AI_APPROVAL_NOT_EXECUTABLE");
});

test("explicit requested approver cannot be bypassed by another ordinary approver",async()=>{
  const {database}=makeApprovalDatabase("pending","dos-1");
  const service=new AiApprovalService({database,audit:null});
  await assert.rejects(
    service.decide({context:{organizationId:"org-1",userId:"other-approver",permissions:["ai:approve"]},approvalId:"approval-1",approve:true,reason:"approve"}),
    (error)=>error?.code==="AI_APPROVAL_NOT_DECIDABLE",
  );
});

test("organization owner/admin wildcard may override an unavailable requested approver",async()=>{
  const {database,state}=makeApprovalDatabase("pending","dos-1");
  const service=new AiApprovalService({database,audit:null});
  const decided=await service.decide({context:{organizationId:"org-1",userId:"owner-1",permissions:["*"]},approvalId:"approval-1",approve:true,reason:"Emergency approval"});
  assert.equal(decided.status,"approved");
  assert.equal(state.decision_by,"owner-1");
});
