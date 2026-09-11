import test from "node:test";
import assert from "node:assert/strict";
import { chunkText, extractText } from "../src/ai/knowledge-ingestion.mjs";
import { AiToolGateway } from "../src/ai/tool-gateway.mjs";

test("knowledge chunking is bounded and overlapping without remote services",()=>{
  const text=Array.from({length:30},(_,i)=>`Paragraph ${i} ${"weather ".repeat(60)}`).join("\n\n");
  const chunks=chunkText(text,{chunkChars:700,overlapChars:80});
  assert.ok(chunks.length>1);
  assert.ok(chunks.every((chunk)=>chunk.length<=850));
});

test("plain local knowledge extraction preserves source text",async()=>{
  const text=await extractText({bytes:Buffer.from("Local curriculum content"),contentType:"text/plain",storageRef:"curriculum.txt"});
  assert.equal(text,"Local curriculum content");
});

test("approved actions are blocked if employee permission was revoked",async()=>{
  const gateway=new AiToolGateway({audit:{write:async()=>{}}});
  gateway.register({name:"send_notification",permissions:["notifications:send"],risk:"medium",consequential:true,approvalRequired:true},async()=>({sent:true}));
  const approval={approval_id:"p1",organization_id:"org-a",agent_id:"a1",requested_action:"send_notification",payload:{message:"hello"},status:"approved"};
  const agent={agentId:"a1",name:"Mirembe",role:"Secretary",status:"active",allowedTools:["send_notification"],permissions:[]};
  await assert.rejects(()=>gateway.executeApproved({approval,agent,context:{organizationId:"org-a",userId:"u1"}}),/no longer has required permission/);
});
