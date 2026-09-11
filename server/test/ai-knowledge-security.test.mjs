import test from "node:test";
import assert from "node:assert/strict";
import { AiKnowledgeService } from "../src/ai/knowledge-memory.mjs";
import { AiWorker } from "../src/ai/worker.mjs";

function fakeKnowledgeDb() {
  const calls=[];
  return {
    calls,
    async query(sql,params=[]) {
      calls.push({sql,params});
      if(sql.includes("INSERT INTO ledgerly_ai.knowledge_sources")) {
        return {rows:[{source_id:"source-1",organization_id:params[1],name:params[2],required_permissions:JSON.parse(params[6])}],rowCount:1};
      }
      if(sql.includes("FROM ledgerly_ai.knowledge_chunks")) return {rows:[],rowCount:0};
      if(sql.includes("SELECT * FROM ledgerly_ai.knowledge_sources")) return {rows:[],rowCount:0};
      return {rows:[],rowCount:0};
    },
  };
}

test("knowledge source classification cannot exceed the creator's live permissions", async () => {
  const database=fakeKnowledgeDb();
  const knowledge=new AiKnowledgeService({database,audit:null});
  const context={organizationId:"org-1",userId:"teacher-1",permissions:["ai:knowledge:write","ai:knowledge:read"]};

  await assert.rejects(
    knowledge.createSource({context,name:"Curriculum",sourceType:"curriculum",requiredPermissions:["academics:read"]}),
    (error)=>error?.code==="AI_KNOWLEDGE_PERMISSION_DENIED",
  );
  assert.equal(database.calls.length,0);
});

test("knowledge source persists its permission classification when creator is authorized", async () => {
  const database=fakeKnowledgeDb();
  const knowledge=new AiKnowledgeService({database,audit:null});
  const context={organizationId:"org-1",userId:"dos-1",permissions:["ai:knowledge:write","ai:knowledge:read","academics:read"]};

  const source=await knowledge.createSource({context,name:"Curriculum",sourceType:"curriculum",requiredPermissions:["academics:read"]});
  assert.deepEqual(source.required_permissions,["ai:knowledge:read","academics:read"]);
  const insert=database.calls.find((call)=>call.sql.includes("INSERT INTO ledgerly_ai.knowledge_sources"));
  assert.deepEqual(JSON.parse(insert.params[6]),["ai:knowledge:read","academics:read"]);
});

test("knowledge retrieval requires the explicit RAG read scope", async () => {
  const database=fakeKnowledgeDb();
  const knowledge=new AiKnowledgeService({database,audit:null});
  await assert.rejects(
    knowledge.retrieve({context:{organizationId:"org-1",userId:"user-1",permissions:["academics:read"]},query:"weather"}),
    (error)=>error?.code==="AI_KNOWLEDGE_PERMISSION_DENIED",
  );
  assert.equal(database.calls.length,0);
});

test("AI worker passes only delegated requester-agent permissions into RAG retrieval", async () => {
  const task={task_id:"task-1",organization_id:"org-1",assigned_agent:"agent-1",requested_by:"teacher-1",instruction:"prepare lesson",status:"queued"};
  const job={jobId:"task-1",kind:"ai.task",organizationId:"org-1",payload:{taskId:"task-1"}};
  const queue={take:async()=>({job,receipt:"r1"}),ack:async()=>{},retry:async()=>{},deadLetter:async()=>{}};
  let retrievalContext;
  const worker=new AiWorker({
    database:{query:async()=>({rows:[task]})},
    queue,
    agents:{get:async()=>({agentId:"agent-1",name:"Academic Assistant",role:"Academic Assistant",status:"active",provider:"ollama",permissions:["ai:knowledge:read","academics:read","finance:read"],allowedTools:[],knowledgeSources:["11111111-1111-1111-1111-111111111111"]})},
    taskService:{setStatus:async()=>task},
    gateway:{describeForAgent:()=>[],invoke:async()=>{throw new Error("not expected");}},
    providerRegistry:{create:()=>({health:async()=>({ok:true}),generate:async()=>({provider:"ollama",model:"local",message:{content:"done",tool_calls:[]}})})},
    providerConfig:{model:"local"},
    knowledge:{retrieve:async({context})=>{retrievalContext=context;return[];}},
    memory:null,
    authorization:{
      resolveCurrentActorAccess:async()=>({effectiveScopes:["ai:knowledge:read","academics:read","students:read"]}),
      intersectPermissions:(requester,agent)=>requester.filter((permission)=>agent.includes(permission)),
    },
    audit:null,
    limits:{taskTimeoutMs:1000,maxRetries:0,maxPromptChars:1000,maxOutputChars:1000,maxToolCalls:2,maxHandoffs:1,maxConcurrentTasks:1},
  });

  const result=await worker.runOnce();
  assert.equal(result.completed,true);
  assert.deepEqual(retrievalContext.permissions,["ai:knowledge:read","academics:read"]);
  assert.equal(retrievalContext.permissions.includes("finance:read"),false);
  assert.equal(retrievalContext.permissions.includes("students:read"),false);
});
