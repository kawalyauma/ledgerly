import test from "node:test";
import assert from "node:assert/strict";
import { AiToolGateway } from "../src/ai/tool-gateway.mjs";
import { AiDocumentEngine } from "../src/ai/document-engine.mjs";
import { createFieldProvenance, updateFieldProvenance } from "../src/ai/provenance.mjs";

test("approved gateway execution reuses exact saved payload",async()=>{
  const calls=[];
  const gateway=new AiToolGateway({audit:{write:async()=>{}}});
  gateway.register({name:"send_notification",permissions:["notifications:send"],risk:"medium",consequential:true,approvalRequired:true},async({input,approved})=>{calls.push({input,approved});return {sent:true};});
  const agent={agentId:"a1",name:"Mirembe",role:"Secretary",status:"active",autonomyLevel:2,allowedTools:["send_notification"],permissions:["notifications:send"]};
  const approval={approval_id:"p1",organization_id:"org-a",agent_id:"a1",task_id:"t1",requested_action:"send_notification",payload:{message:"Approved text"},status:"approved",reason:"Send notice"};
  const result=await gateway.executeApproved({approval,agent,context:{organizationId:"org-a",userId:"u1",permissions:["notifications:send"]}});
  assert.equal(result.status,"executed");
  assert.deepEqual(calls,[{input:{message:"Approved text"},approved:true}]);
});

test("approved action cannot execute after employee is paused",async()=>{
  const gateway=new AiToolGateway({audit:{write:async()=>{}}});
  gateway.register({name:"send_notification",permissions:["notifications:send"],risk:"medium",consequential:true,approvalRequired:true},async()=>({sent:true}));
  const agent={agentId:"a1",name:"Mirembe",role:"Secretary",status:"paused",autonomyLevel:2,allowedTools:["send_notification"],permissions:["notifications:send"]};
  const approval={approval_id:"p1",organization_id:"org-a",agent_id:"a1",task_id:"t1",requested_action:"send_notification",payload:{message:"Approved text"},status:"approved",reason:"Send notice"};
  await assert.rejects(()=>gateway.executeApproved({approval,agent,context:{organizationId:"org-a",userId:"u1",permissions:["notifications:send"]}}),(error)=>error.code==="AI_AGENT_PAUSED");
});

test("official document approval requires ai:approve and follows state transitions",async()=>{
  let current={document_id:"doc-1",organization_id:"org-a",status:"in_review",version:1,content:{title:"Draft"}};
  const tx={query:async(sql,values)=>{if(String(sql).startsWith("SELECT"))return {rows:[current],rowCount:1};if(String(sql).startsWith("UPDATE")){current={...current,status:values[0]};return {rows:[current],rowCount:1};}return {rows:[],rowCount:0};}};
  const database={transaction:async(fn)=>fn(tx),query:tx.query};
  const engine=new AiDocumentEngine({database,audit:{write:async()=>{}}});
  await assert.rejects(()=>engine.setStatus({context:{organizationId:"org-a",userId:"u1",permissions:["ai:write"]},documentId:"doc-1",status:"approved"}),(error)=>error.code==="AI_PERMISSION_DENIED");
  const approved=await engine.setStatus({context:{organizationId:"org-a",userId:"u2",permissions:["ai:approve"]},documentId:"doc-1",status:"approved"});
  assert.equal(approved.status,"approved");
  await assert.rejects(()=>engine.setStatus({context:{organizationId:"org-a",userId:"u2",permissions:["ai:approve"]},documentId:"doc-1",status:"draft"}),/invalid document transition approved -> draft/);
});

test("approved documents cannot be silently edited after approval",async()=>{
  const current={document_id:"doc-1",organization_id:"org-a",status:"approved",version:2,content:{title:"Approved"},ai_provenance:{}};
  const tx={query:async(sql)=>String(sql).startsWith("SELECT")?{rows:[current],rowCount:1}:{rows:[],rowCount:0}};
  const engine=new AiDocumentEngine({database:{transaction:async(fn)=>fn(tx)},audit:{write:async()=>{}}});
  await assert.rejects(()=>engine.reviseHuman({context:{organizationId:"org-a",userId:"u1"},documentId:"doc-1",content:{title:"Changed"}}),(error)=>error.status===409);
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
