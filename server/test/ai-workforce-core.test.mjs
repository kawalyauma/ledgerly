import test from "node:test";
import assert from "node:assert/strict";
import { evaluateToolPolicy, AiPolicyError, assertTenant } from "../src/ai/policy.mjs";
import { aiAttribution, humanEditProvenance } from "../src/ai/provenance.mjs";
import { AiProviderRegistry } from "../src/ai/runtime-provider.mjs";
import { OllamaProvider } from "../src/ai/providers/ollama.mjs";

const agent={agentId:"agent-1",name:"Mirembe",role:"Secretary",status:"active",autonomyLevel:2,allowedTools:["safe_read","send_notification"]};
const context={organizationId:"org-a",permissions:["school:read","notifications:send"]};

test("tenant isolation rejects mismatched organization",()=>{
  assert.throws(()=>assertTenant(context,"org-b"),(error)=>error instanceof AiPolicyError && error.code==="AI_TENANT_SCOPE_DENIED");
});

test("agent cannot call a tool outside allowlist",()=>{
  assert.throws(()=>evaluateToolPolicy({agent,tool:{name:"reverse_journal",permissions:[],risk:"high",consequential:true,approvalRequired:true},context,input:{}}),(error)=>error.code==="AI_TOOL_NOT_ALLOWED");
});

test("consequential actions default to approval",()=>{
  const decision=evaluateToolPolicy({agent,tool:{name:"send_notification",permissions:["notifications:send"],risk:"medium",consequential:true,approvalRequired:true},context,input:{}});
  assert.equal(decision.decision,"approval_required");
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

test("Ollama health distinguishes missing model",async()=>{
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({models:[{name:"other:latest",size:1}]})});
  try {
    const provider=new OllamaProvider({model:"qwen2.5",timeoutMs:100});
    const health=await provider.health();
    assert.equal(health.online,true);
    assert.equal(health.modelInstalled,false);
    assert.equal(health.state,"model_missing");
  } finally { globalThis.fetch=oldFetch; }
});
