import test from "node:test";
import assert from "node:assert/strict";
import { evaluateToolPolicy, AiPolicyError, assertTenant } from "../src/ai/policy.mjs";
import { aiAttribution, humanEditProvenance } from "../src/ai/provenance.mjs";
import { AiProviderRegistry } from "../src/ai/runtime-provider.mjs";
import { OllamaProvider } from "../src/ai/providers/ollama.mjs";
import { AiToolGateway, registerCoreTools } from "../src/ai/tool-gateway.mjs";

const agent={agentId:"agent-1",name:"Mirembe",role:"Secretary",status:"active",autonomyLevel:2,allowedTools:["safe_read","send_notification"]};
const context={organizationId:"org-a",permissions:["school:read","notifications:send"]};

test("tenant isolation rejects mismatched organization",()=>{
  assert.throws(()=>assertTenant(context,"org-b"),(error)=>error instanceof AiPolicyError && error.code==="AI_TENANT_SCOPE_DENIED");
});

test("agent cannot call a tool outside allowlist",()=>{
  assert.throws(()=>evaluateToolPolicy({agent,tool:{name:"reverse_journal",permissions:[],risk:"prohibited",consequential:true},context,input:{}}),(error)=>error.code==="AI_TOOL_NOT_ALLOWED");
});

test("paused employee is blocked at the policy boundary",()=>{
  const paused={...agent,status:"paused",allowedTools:["safe_read"]};
  assert.throws(()=>evaluateToolPolicy({agent:paused,tool:{name:"safe_read",permissions:[],risk:"low"},context,input:{}}),(error)=>error.code==="AI_AGENT_PAUSED");
});

test("consequential actions default to approval",()=>{
  const decision=evaluateToolPolicy({agent,tool:{name:"send_notification",permissions:["notifications:send"],risk:"medium",consequential:true,approvalRequired:true},context,input:{}});
  assert.equal(decision.decision,"approval_required");
});

test("core prohibited tools cannot be approved into execution",async()=>{
  const gateway=registerCoreTools(new AiToolGateway({audit:{write:async()=>{}}}),{});
  const restricted={agentId:"a1",name:"Restricted",role:"Test",status:"active",autonomyLevel:3,allowedTools:["post_payment"],permissions:["ai:restricted"]};
  await assert.rejects(()=>gateway.invoke({agent:restricted,context:{organizationId:"org-a",permissions:["ai:restricted"]},toolName:"post_payment",input:{}}),(error)=>error.code==="AI_ACTION_PROHIBITED");
  const definition=gateway.describeAll().find((tool)=>tool.name==="post_payment");
  assert.equal(definition.risk,"prohibited");
  assert.equal(definition.approvalRequired,false);
});

test("core tool definitions expose explicit model argument schemas",()=>{
  const gateway=registerCoreTools(new AiToolGateway({audit:{write:async()=>{}}}),{});
  const student=gateway.describeAll().find((tool)=>tool.name==="get_student");
  const notification=gateway.describeAll().find((tool)=>tool.name==="send_notification");
  assert.equal(student.parameters.type,"object");
  assert.deepEqual(student.parameters.required,["studentId"]);
  assert.deepEqual(notification.parameters.required,["channel","to","message"]);
  assert.equal(notification.parameters.additionalProperties,false);
});

test("tool arguments are validated server-side before policy or handlers",async()=>{
  let handled=false;
  const gateway=registerCoreTools(new AiToolGateway({audit:{write:async()=>{}}}),{sendNotification:async()=>{handled=true;return {sent:true};}});
  const notifier={agentId:"a1",name:"Mirembe",role:"Secretary",status:"active",autonomyLevel:3,allowedTools:["send_notification"],permissions:["notifications:send"]};
  await assert.rejects(()=>gateway.invoke({agent:notifier,context:{organizationId:"org-a",permissions:["notifications:send"]},toolName:"send_notification",input:{message:"Missing destination"}}),(error)=>error.code==="AI_TOOL_INPUT_INVALID");
  assert.equal(handled,false);
});

test("generic request_approval uses the durable approval gate rather than nesting approvals",async()=>{
  const requests=[];
  const gateway=registerCoreTools(new AiToolGateway({audit:{write:async()=>{}},approvalService:{request:async(input)=>{requests.push(input);return {approval_id:"p1",organization_id:input.organizationId,status:"pending"};}}}),{});
  const reviewer={agentId:"a1",name:"Kato",role:"Reviewer",status:"active",autonomyLevel:2,allowedTools:["request_approval"],permissions:["approvals:write"]};
  const input={action:"publish report",reason:"Human sign-off required",payload:{documentId:"d1"}};
  const result=await gateway.invoke({agent:reviewer,context:{organizationId:"org-a",permissions:["approvals:write"]},taskId:"t1",toolName:"request_approval",input});
  assert.equal(result.status,"waiting_for_approval");
  assert.equal(requests.length,1);
  assert.equal(requests[0].action,"request_approval");
  assert.deepEqual(requests[0].payload,input);
});

test("AI provenance survives later human edit",()=>{
  const original=aiAttribution({agent,taskId:"task-1",reason:"draft visitation notice",timestamp:"2026-09-11T00:00:00.000Z"});
  const edited=humanEditProvenance(original,{userId:"user-1",userName:"Kawalya",reason:"fixed date",timestamp:"2026-09-11T01:00:00.000Z"});
  assert.equal(edited.actor_type,"human");
  assert.equal(edited.original_ai.agent_id,"agent-1");
  assert.equal(edited.original_ai.task_id,"task-1");
});

test("provider registry is model/provider agnostic",()=>{
  const registry=new AiProviderRegistry().register("mock",(config)=>({config}));
  assert.deepEqual(registry.create("mock",{model:"x"}),{config:{model:"x"}});
});

test("Ollama health distinguishes unconfigured model",async()=>{
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({models:[{name:"qwen2.5:7b",size:1}]})});
  try {
    const provider=new OllamaProvider({model:null,timeoutMs:100});
    const health=await provider.health();
    assert.equal(health.ok,false);
    assert.equal(health.online,true);
    assert.equal(health.state,"model_unconfigured");
    assert.equal(health.code,"AI_MODEL_NOT_CONFIGURED");
    assert.deepEqual(health.models,["qwen2.5:7b"]);
  } finally { globalThis.fetch=oldFetch; }
});

test("Ollama health distinguishes missing model",async()=>{
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({models:[{name:"other:latest",size:1}]})});
  try {
    const provider=new OllamaProvider({model:"qwen2.5",timeoutMs:100});
    const health=await provider.health();
    assert.equal(health.online,true);
    assert.equal(health.modelInstalled,false);
    assert.equal(health.state,"model_missing");
    assert.equal(health.code,"AI_MODEL_NOT_INSTALLED");
  } finally { globalThis.fetch=oldFetch; }
});
