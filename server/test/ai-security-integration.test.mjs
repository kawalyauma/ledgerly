import test from "node:test";
import assert from "node:assert/strict";
import { AiToolGateway } from "../src/ai/tool-gateway.mjs";
import { AiTaskService } from "../src/ai/services.mjs";
import { AiScheduleService } from "../src/ai/schedules.mjs";
import { AiWorker } from "../src/ai/worker.mjs";
import { AiKnowledgeIngestionService } from "../src/ai/knowledge-ingestion.mjs";

test("AI tool visibility and execution are bounded by delegated permissions", async () => {
  const gateway=new AiToolGateway({audit:null});
  let calls=0;
  gateway.register({name:"finance_read",permissions:["finance:read"],risk:"low",consequential:false},async()=>{calls++;return {ok:true};});
  const agent={agentId:"agent-1",name:"Finance",role:"Finance Assistant",status:"active",permissions:["finance:read"],allowedTools:["finance_read"],autonomyLevel:2};

  assert.deepEqual(gateway.describeForAgent(agent,["school:read"]),[]);
  assert.equal(gateway.describeForAgent(agent,["finance:read"]).length,1);
  await assert.rejects(
    gateway.invoke({agent,context:{organizationId:"org-1",userId:"user-1",permissions:["school:read"]},toolName:"finance_read"}),
    (error)=>error?.code==="AI_PERMISSION_DENIED",
  );
  assert.equal(calls,0);
});

test("approved actions still require current delegated tool authority after atomic claim", async () => {
  const gateway=new AiToolGateway({audit:null});
  gateway.register({name:"post_sensitive",permissions:["finance:write"],risk:"high",consequential:true,approvalRequired:true},async()=>({posted:true}));
  const agent={agentId:"agent-1",name:"Finance",role:"Finance Assistant",status:"active",permissions:["finance:write"],allowedTools:["post_sensitive"]};
  const approval={approval_id:"approval-1",organization_id:"org-1",agent_id:"agent-1",requested_action:"post_sensitive",status:"executing",payload:{amount:1},task_id:"task-1"};

  await assert.rejects(
    gateway.executeApproved({approval,agent,context:{organizationId:"org-1",userId:"approver",permissions:["ai:approve"]}}),
    (error)=>error?.code==="AI_PERMISSION_DENIED",
  );
});

test("agent handoff preserves the original human or API-key requester", async () => {
  const service=new AiTaskService({database:{query:async()=>({rows:[],rowCount:0})},queue:{enqueue:async()=>{}},audit:null});
  let captured;
  service.create=async(input)=>{captured=input;return {task_id:"child"};};
  await service.handoff({
    context:{organizationId:"org-1",userId:"current-user"},
    task:{task_id:"parent",requested_by:"original-requester",priority:50,output_references:[],handoff_depth:0},
    fromAgent:{agentId:"agent-a",name:"A",role:"Assistant"},
    toAgent:"agent-b",
    instruction:"continue",
  });
  assert.equal(captured.context.userId,"original-requester");
  assert.equal(captured.parentTaskId,"parent");
});

test("scheduled AI work stores the original requester in its durable payload", async () => {
  let registered;
  const schedules=new AiScheduleService({
    scheduler:{register:async(input)=>{registered=input;return input;},list:async()=>[],cancel:async()=>true},
    audit:null,
  });
  await schedules.register({context:{organizationId:"org-1",userId:"user-7"},name:"Morning brief",agentId:"agent-1",instruction:"prepare brief",cron:"0 8 * * *"});
  assert.equal(registered.payload.requestedBy,"user-7");
});

test("AI worker re-resolves requester and intersects requester and agent authority", async () => {
  const task={task_id:"task-1",organization_id:"org-1",assigned_agent:"agent-1",requested_by:"user-1",instruction:"summarize",status:"queued"};
  const job={jobId:"task-1",kind:"ai.task",organizationId:"org-1",payload:{taskId:"task-1"}};
  const queue={take:async()=>({job,receipt:"r1"}),ack:async()=>{},retry:async()=>{},deadLetter:async()=>{}};
  const statuses=[];
  let describedPermissions;
  const worker=new AiWorker({
    database:{query:async()=>({rows:[task]})},
    queue,
    agents:{get:async()=>({agentId:"agent-1",name:"Agent",role:"Assistant",status:"active",provider:"ollama",permissions:["finance:read","school:read"],allowedTools:[],knowledgeSources:[]})},
    taskService:{setStatus:async(input)=>{statuses.push(input.status);return task;}},
    gateway:{describeForAgent:(_agent,permissions)=>{describedPermissions=permissions;return [];},invoke:async()=>{throw new Error("not expected");}},
    providerRegistry:{create:()=>({health:async()=>({ok:true}),generate:async()=>({provider:"ollama",model:"local",message:{content:"done",tool_calls:[]}})})},
    providerConfig:{model:"local"},
    authorization:{
      resolveCurrentActorAccess:async({actorId})=>{assert.equal(actorId,"user-1");return {effectiveScopes:["school:read","students:read"]};},
      intersectPermissions:(requester,agent)=>requester.filter((permission)=>agent.includes(permission)),
    },
    audit:null,
    limits:{taskTimeoutMs:1000,maxRetries:0,maxPromptChars:1000,maxOutputChars:1000,maxToolCalls:2,maxHandoffs:1,maxConcurrentTasks:1},
  });
  const result=await worker.runOnce();
  assert.equal(result.completed,true);
  assert.deepEqual(describedPermissions,["school:read"]);
  assert.deepEqual(statuses,["working","completed"]);
});

test("AI knowledge ingestion can only read through the organization storage view and inherits source-domain permissions", async () => {
  let requestedOrganization;
  let sourceInput;
  const storage={
    head:async(key)=>{assert.equal(key,"academics/book.txt");return {size:11,metadata:{contentType:"text/plain"}};},
    get:async(key)=>{assert.equal(key,"academics/book.txt");return Buffer.from("hello world");},
  };
  const knowledge={
    createSource:async(input)=>{sourceInput=input;return {source_id:"source-1",...input};},
    indexChunks:async({chunks})=>({indexed:chunks.length}),
  };
  const ingestion=new AiKnowledgeIngestionService({
    knowledge,
    storageForOrganization:(organizationId)=>{requestedOrganization=organizationId;return storage;},
    audit:null,
  });
  const result=await ingestion.ingestStored({context:{organizationId:"org-1",userId:"user-1",permissions:["ai:knowledge:write","ai:knowledge:read","academics:read"]},name:"Book",storageRef:"academics/book.txt"});
  assert.equal(requestedOrganization,"org-1");
  assert.equal(result.chunks,1);
  assert.equal(result.source.metadata.tenantScoped,true);
  assert.deepEqual(sourceInput.requiredPermissions,["academics:read"]);
});
