import test from "node:test";
import assert from "node:assert/strict";
import { createLedgerlyBusinessTools } from "../src/ai/business-tools.mjs";
import { AiToolGateway } from "../src/ai/tool-gateway.mjs";

test("student search is parameterized and tenant scoped",async()=>{
 const calls=[];
 const database={query:async(sql,values)=>{calls.push({sql,values});if(String(sql).startsWith("SELECT to_regclass"))return {rows:[{relation:"school_students"}]};return {rows:[]};}};
 const tools=createLedgerlyBusinessTools({database});
 await tools.searchStudents({input:{query:"A%_"},context:{organizationId:"org-a"}});
 const query=calls.at(-1);
 assert.equal(query.values[0],"org-a");
 assert.match(query.sql,/organization_id=\$1/);
 assert.equal(query.values[1],"A%_");
 assert.equal(query.values[2],"%A\\%\\_%");
});

test("finance summary reads posted journals only and remains tenant scoped",async()=>{
 const calls=[];
 const database={query:async(sql,values)=>{calls.push({sql,values});if(String(sql).startsWith("SELECT to_regclass"))return {rows:[{relation:"journal_entries"}]};return {rows:[{debit_minor:100,credit_minor:100,posted_journals:1}]};}};
 const tools=createLedgerlyBusinessTools({database});
 const out=await tools.getFinanceSummary({input:{from:"2026-01-01",to:"2026-12-31"},context:{organizationId:"org-fin"}});
 assert.equal(out.posted_journals,1);
 const query=calls.at(-1);
 assert.equal(query.values[0],"org-fin");
 assert.match(query.sql,/je\.status='posted'/);
 assert.match(query.sql,/JOIN journal_lines/);
});

test("domain adapters fail closed while a self-hosted table is not migrated",async()=>{
 const database={query:async(sql)=>String(sql).startsWith("SELECT to_regclass")?{rows:[{relation:null}]}:{rows:[]}};
 const tools=createLedgerlyBusinessTools({database});
 await assert.rejects(()=>tools.getStaff({input:{},context:{organizationId:"org-a"}}),(error)=>error.code==="AI_DOMAIN_NOT_MIGRATED");
});

test("approved tool is rechecked against current human permissions",async()=>{
 const gateway=new AiToolGateway({audit:{write:async()=>{}}});
 gateway.register({name:"send_notice",permissions:["notifications:send"],risk:"medium",consequential:true,approvalRequired:true},async()=>({sent:true}));
 const agent={agentId:"a1",name:"Secretary",role:"Secretary",status:"active",autonomyLevel:3,allowedTools:["send_notice"],permissions:["notifications:send"]};
 const approval={organization_id:"org-a",status:"approved",agent_id:"a1",requested_action:"send_notice",payload:{},task_id:"t1",approval_id:"p1",reason:"approved"};
 await assert.rejects(()=>gateway.executeApproved({approval,agent,context:{organizationId:"org-a",permissions:[]}}),(error)=>error.code==="AI_PERMISSION_DENIED");
});
