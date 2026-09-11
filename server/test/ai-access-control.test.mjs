import test from "node:test";
import assert from "node:assert/strict";
import { AiAgentService } from "../src/ai/agents.mjs";
import { AiTaskService } from "../src/ai/services.mjs";
import { AiScheduleService } from "../src/ai/schedules.mjs";
import aiRoute from "../src/http/routes/ai.route.mjs";
import { handleAiTaskRequest } from "../src/ai/task-http.mjs";

function deniedScopeError(scope){const error=new Error(`Missing required scope: ${scope}`);error.status=403;error.code="FORBIDDEN";return error;}
function authRuntime(scopes){
  return {
    auth:{
      authenticateRequest:async()=>({organizationId:"org-1",userId:"user-1",role:"member",scopes}),
      requireScope(principal,scope){if(!(principal.scopes??[]).includes("*")&&!(principal.scopes??[]).includes(scope))throw deniedScopeError(scope);return principal;},
    },
    authorization:{resolveCurrentActorAccess:async()=>({role:"member",effectiveScopes:scopes})},
  };
}

test("ordinary ai:write users cannot create privileged shared employees",async()=>{
  let writes=0;
  const service=new AiAgentService({database:{query:async()=>{writes++;return{rows:[],rowCount:0};}},audit:null});
  await assert.rejects(
    service.create({organizationId:"org-1",userId:"user-1",permissions:["ai:write","finance:read"]},{name:"Finance",role:"Finance Assistant",permissions:["finance:read"]}),
    (error)=>error?.code==="AI_AGENT_CONFIGURATION_DENIED"&&error?.details?.missingPermissions?.includes("ai:approve"),
  );
  assert.equal(writes,0);
});

test("AI approvers cannot grant an employee permissions they do not hold",async()=>{
  let writes=0;
  const service=new AiAgentService({database:{query:async()=>{writes++;return{rows:[],rowCount:0};}},audit:null});
  await assert.rejects(
    service.create({organizationId:"org-1",userId:"manager-1",permissions:["ai:approve","ai:write","school:read"]},{name:"Finance",role:"Finance Assistant",permissions:["finance:read"]}),
    (error)=>error?.code==="AI_AGENT_CONFIGURATION_DENIED"&&error?.details?.missingPermissions?.includes("finance:read"),
  );
  assert.equal(writes,0);
});

test("AI approver can emergency-disable a more privileged employee without inheriting its privileges",async()=>{
  const rows={agent_id:"agent-1",organization_id:"org-1",name:"Finance",role:"Finance Assistant",status:"active",permissions:["finance:write"],allowed_tools:[],autonomy_level:2,knowledge_sources:[]};
  const database={async query(sql){
    if(sql.startsWith("SELECT * FROM ledgerly_ai.agents"))return{rows:[rows],rowCount:1};
    if(sql.startsWith("UPDATE ledgerly_ai.agents SET status='disabled'"))return{rows:[{...rows,status:"disabled"}],rowCount:1};
    throw new Error(`unexpected SQL: ${sql}`);
  }};
  const service=new AiAgentService({database,audit:null});
  const disabled=await service.disable({organizationId:"org-1",userId:"manager-1",permissions:["ai:approve"]},"agent-1","Emergency stop");
  assert.equal(disabled.status,"disabled");
});

test("AI task HTTP access is requester-scoped unless caller is an approver",async()=>{
  const runtime={
    ...authRuntime(["ai:read"]),
    ai:{},
    services:{database:{query:async()=>({rows:[{task_id:"task-2",organization_id:"org-1",requested_by:"other-user"}],rowCount:1})}},
  };
  await assert.rejects(
    handleAiTaskRequest({request:{method:"GET",headers:{}},url:new URL("http://localhost/selfhost/ai/tasks/task-2"),runtime}),
    (error)=>error?.code==="AI_TASK_ACCESS_DENIED",
  );
});

test("document APIs require document permissions in addition to AI permissions",async()=>{
  const runtime={
    ...authRuntime(["ai:read"]),
    extensions:{ai:{}},
  };
  await assert.rejects(
    aiRoute.handle({request:{method:"GET",headers:{}},url:new URL("http://localhost/selfhost/ai/documents/doc-1"),runtime}),
    (error)=>error?.code==="FORBIDDEN"&&String(error.message).includes("documents:read"),
  );
});

test("approval APIs use ai:approve directly without requiring generic ai:write",async()=>{
  const runtime={
    ...authRuntime(["ai:approve"]),
    extensions:{ai:{}},
    services:{database:{query:async(sql)=>{assert.match(sql,/ledgerly_ai\.approvals/);return{rows:[],rowCount:0};}}},
  };
  const response=await aiRoute.handle({request:{method:"GET",headers:{}},url:new URL("http://localhost/selfhost/ai/approvals"),runtime});
  assert.equal(response.status,200);
  assert.deepEqual(response.body.items,[]);
});

test("recurring AI schedule visibility requires approver authority",async()=>{
  const runtime={...authRuntime(["ai:read"]),extensions:{ai:{}}};
  await assert.rejects(
    aiRoute.handle({request:{method:"GET",headers:{}},url:new URL("http://localhost/selfhost/ai/schedules"),runtime}),
    (error)=>error?.code==="FORBIDDEN"&&String(error.message).includes("ai:approve"),
  );
});

test("recurring schedules reject disabled employee targets before registration",async()=>{
  let registered=false;
  const schedules=new AiScheduleService({
    scheduler:{register:async()=>{registered=true;return{};},list:async()=>[],cancel:async()=>true},
    audit:null,
    agents:{get:async()=>({agentId:"agent-1",status:"disabled"})},
  });
  await assert.rejects(
    schedules.register({context:{organizationId:"org-1",userId:"admin-1"},name:"Daily",agentId:"agent-1",instruction:"Run",cron:"0 8 * * *"}),
    /disabled/,
  );
  assert.equal(registered,false);
});

test("agent handoff depth limit cannot be bypassed by another delegation",async()=>{
  const service=new AiTaskService({database:{query:async()=>({rows:[],rowCount:0})},queue:{enqueue:async()=>{}},audit:null,limits:{maxPromptChars:1000,maxHandoffs:3}});
  await assert.rejects(
    service.handoff({context:{organizationId:"org-1",userId:"original"},task:{task_id:"parent",requested_by:"original",priority:50,output_references:[],handoff_depth:3},fromAgent:{agentId:"a",name:"A",role:"Assistant"},toAgent:"b",instruction:"continue"}),
    /handoff depth limit/,
  );
});
