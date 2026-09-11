import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { chunkText, extractText, extractPdfLocally } from "../src/ai/knowledge-ingestion.mjs";
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

test("local PDF extraction has a hard timeout",async()=>{
  let killed=false;
  const spawnImpl=()=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin={on:()=>{},end:()=>{}};child.kill=()=>{killed=true;};return child;};
  await assert.rejects(()=>extractPdfLocally(Buffer.from("pdf"),{timeoutMs:5,spawnImpl}),(error)=>error.code==="AI_PDF_EXTRACTION_TIMEOUT");
  assert.equal(killed,true);
});

test("local PDF extraction rejects excessive extracted output",async()=>{
  const spawnImpl=()=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin={on:()=>{},end:()=>queueMicrotask(()=>child.stdout.emit("data",Buffer.alloc(20)))};child.kill=()=>{};return child;};
  await assert.rejects(()=>extractPdfLocally(Buffer.from("pdf"),{timeoutMs:100,maxOutputBytes:10,spawnImpl}),(error)=>error.code==="AI_PDF_EXTRACTION_OUTPUT_TOO_LARGE");
});

test("approved actions are blocked if current human permission was revoked",async()=>{
  const gateway=new AiToolGateway({audit:{write:async()=>{}}});
  gateway.register({name:"send_notification",permissions:["notifications:send"],risk:"medium",consequential:true,approvalRequired:true},async()=>({sent:true}));
  const approval={approval_id:"p1",organization_id:"org-a",agent_id:"a1",requested_action:"send_notification",payload:{channel:"whatsapp",to:"+256700000000",message:"hello"},status:"approved"};
  const agent={agentId:"a1",name:"Mirembe",role:"Secretary",status:"active",allowedTools:["send_notification"],permissions:["notifications:send"]};
  await assert.rejects(()=>gateway.executeApproved({approval,agent,context:{organizationId:"org-a",userId:"u1",permissions:[]}}),(error)=>error.code==="AI_PERMISSION_DENIED");
});
