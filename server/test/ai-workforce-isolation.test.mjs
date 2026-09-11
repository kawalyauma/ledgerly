import test from "node:test";
import assert from "node:assert/strict";
import { JobQueueRouter } from "../src/ai/queue-router.mjs";
import { AiWorkforceStore } from "../src/ai/store.mjs";
import { AiKnowledgeService } from "../src/ai/knowledge-memory.mjs";

test("queue router sends AI jobs to dedicated queue and leaves other jobs alone",async()=>{
  const normal=[]; const ai=[];
  const defaultQueue={name:"default",enqueue:async(job)=>{normal.push(job);return {queued:true}},health:async()=>({ok:true})};
  const aiQueue={name:"ai-workforce",enqueue:async(job)=>{ai.push(job);return {queued:true}},health:async()=>({ok:true})};
  const router=new JobQueueRouter({defaultQueue,routes:{"ai.task":aiQueue}});
  await router.enqueue({jobId:"1",kind:"ai.task"});
  await router.enqueue({jobId:"2",kind:"notification.send"});
  assert.equal(ai.length,1); assert.equal(normal.length,1);
  assert.equal(ai[0].jobId,"1"); assert.equal(normal[0].jobId,"2");
});

test("AI schema degrades to full-text knowledge when pgvector is unavailable",async()=>{
  const sql=[];
  const database={query:async(statement)=>{
    sql.push(statement);
    if (String(statement).includes("CREATE EXTENSION")) throw new Error("extension vector is not available");
    return {rows:[],rowCount:0};
  }};
  const warnings=[];
  const store=new AiWorkforceStore({database,logger:{warn:(value)=>warnings.push(value)}});
  const caps=await store.ensureSchema();
  assert.equal(caps.vectorSearch,false);
  assert.equal(caps.fullTextSearch,true);
  assert.ok(sql.some((statement)=>String(statement).includes("embedding_json jsonb")));
  assert.ok(warnings.length>0);
});

test("RAG retrieval always scopes full-text search to the authenticated organization",async()=>{
  const calls=[];
  const database={query:async(sql,values)=>{calls.push({sql,values});return {rows:[]};}};
  const knowledge=new AiKnowledgeService({database,vectorEnabled:false});
  await knowledge.retrieve({context:{organizationId:"org-a"},query:"weather curriculum",limit:5});
  assert.equal(calls[0].values[0],"org-a");
  assert.match(calls[0].sql,/c\.organization_id=\$1/);
});
