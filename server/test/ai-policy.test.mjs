import test from "node:test";
import assert from "node:assert/strict";
import { evaluateToolPolicy } from "../src/ai/policy.mjs";

test("Level 1 Adviser remains recommendation-only for consequential tools",()=>{
  const agent={name:"Finance Adviser",status:"active",autonomyLevel:1,permissions:["notifications:send"],allowedTools:["send_notification"]};
  const tool={name:"send_notification",permissions:["notifications:send"],risk:"medium",consequential:true,approvalRequired:true};
  const result=evaluateToolPolicy({agent,tool,context:{organizationId:"org-1",permissions:["notifications:send"]},input:{message:"hello"}});
  assert.equal(result.decision,"draft_only");
});

test("Level 2 Assistant requires approval for consequential tools",()=>{
  const agent={name:"Secretary",status:"active",autonomyLevel:2,permissions:["notifications:send"],allowedTools:["send_notification"]};
  const tool={name:"send_notification",permissions:["notifications:send"],risk:"medium",consequential:true,approvalRequired:true};
  const result=evaluateToolPolicy({agent,tool,context:{organizationId:"org-1",permissions:["notifications:send"]},input:{message:"hello"}});
  assert.equal(result.decision,"approval_required");
});

test("Level 3 Autonomous still respects explicit approval-required tools",()=>{
  const agent={name:"Secretary",status:"active",autonomyLevel:3,permissions:["notifications:send"],allowedTools:["send_notification"]};
  const tool={name:"send_notification",permissions:["notifications:send"],risk:"medium",consequential:true,approvalRequired:true};
  const result=evaluateToolPolicy({agent,tool,context:{organizationId:"org-1",permissions:["notifications:send"]},input:{message:"hello"}});
  assert.equal(result.decision,"approval_required");
});
