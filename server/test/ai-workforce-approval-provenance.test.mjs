import test from "node:test";
import assert from "node:assert/strict";
import { AiToolGateway } from "../src/ai/tool-gateway.mjs";
import { createFieldProvenance, updateFieldProvenance } from "../src/ai/provenance.mjs";

test("approved gateway execution reuses exact saved payload",async()=>{
  const calls=[];
  const gateway=new AiToolGateway({audit:{write:async()=>{}}});
  gateway.register({name:"send_notification",permissions:["notifications:send"],risk:"medium",consequential:true,approvalRequired:true},async({input,approved})=>{calls.push({input,approved});return {sent:true};});
  const agent={agentId:"a1",name:"Mirembe",role:"Secretary",allowedTools:["send_notification"],permissions:["notifications:send"]};
  const approval={approval_id:"p1",organization_id:"org-a",agent_id:"a1",task_id:"t1",requested_action:"send_notification",payload:{message:"Approved text"},status:"approved",reason:"Send notice"};
  const result=await gateway.executeApproved({approval,agent,context:{organizationId:"org-a",userId:"u1",permissions:["notifications:send"]}});
  assert.equal(result.status,"executed");
  assert.deepEqual(calls,[{input:{message:"Approved text"},approved:true}]);
});

test("field provenance preserves original AI attribution after human edit",()=>{
  const ai={actor_type:"ai_agent",agent_id:"a1",agent_name:"Nabirye",agent_role:"Academic Assistant",task_id:"t1",timestamp:"2026-09-11T00:00:00Z",reason:"lesson draft"};
  const before={objective:"Identify types of weather",activity:"Observe sky"};
  const fields=createFieldProvenance(before,ai);
  const human={actor_type:"human",actor_id:"u1",actor_name:"Kawalya",timestamp:"2026-09-11T01:00:00Z",reason:"teacher revision"};
  const updated=updateFieldProvenance({before,after:{...before,objective:"Describe weather conditions"},existing:fields,actor:human});
  assert.equal(updated["$.objective"].actor_type,"human");
  assert.equal(updated["$.objective"].original_ai.agent_id,"a1");
  assert.equal(updated["$.activity"].agent_id,"a1");
});
