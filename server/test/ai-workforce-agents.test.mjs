import test from "node:test";
import assert from "node:assert/strict";
import { AiAgentService } from "../src/ai/agents.mjs";

test("AI employee validation rejects invalid autonomy before database write",async()=>{
  let wrote=false;
  const agents=new AiAgentService({database:{query:async()=>{wrote=true;return {rows:[]};}},audit:{write:async()=>{}}});
  await assert.rejects(()=>agents.create({organizationId:"org-a",userId:"u1"},{name:"Bad",role:"Tester",autonomyLevel:4}),(error)=>error.code==="AI_AGENT_INVALID"&&error.status===422);
  assert.equal(wrote,false);
});

test("AI employee creation normalizes status and deduplicates permission/tool lists",async()=>{
  let values;
  const database={query:async(_sql,input)=>{values=input;return {rows:[{agent_id:input[0],organization_id:input[1],name:input[2],avatar:input[3],role:input[4],department:input[5],description:input[6],system_instructions:input[7],provider:input[8],model:input[9],status:input[10],permissions:JSON.parse(input[11]),allowed_tools:JSON.parse(input[12]),autonomy_level:input[13],knowledge_sources:JSON.parse(input[14]),working_schedule:JSON.parse(input[15]),approval_rules:JSON.parse(input[16])}]};}};
  const agents=new AiAgentService({database,audit:{write:async()=>{}}});
  const created=await agents.create({organizationId:"org-a",userId:"u1"},{name:" Mirembe ",role:" Secretary ",status:"paused",permissions:["school:read","school:read"],allowedTools:["get_school_profile","get_school_profile"]});
  assert.equal(created.organizationId,"org-a");
  assert.equal(created.name,"Mirembe");
  assert.equal(created.status,"paused");
  assert.deepEqual(created.permissions,["school:read"]);
  assert.deepEqual(created.allowedTools,["get_school_profile"]);
  assert.equal(values[1],"org-a");
});
