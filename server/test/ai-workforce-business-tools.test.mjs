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

test("academic context restricts subjects through migrated class mappings and tenant scope",async()=>{
 const calls=[];
 const database={query:async(sql,values=[])=>{const q=String(sql);calls.push({sql:q,values});if(q.startsWith("SELECT to_regclass"))return {rows:[{relation:values[0]}]};if(q.includes("JOIN school_class_subjects"))return {rows:[{id:"sub-math",name:"Mathematics"}]};if(q.includes("FROM school_classes")&&!q.includes("JOIN"))return {rows:[{id:"class-p3",class_level_id:"level-p3",academic_year_id:"year-2026"}]};return {rows:[]};}};
 const tools=createLedgerlyBusinessTools({database});
 const out=await tools.getAcademicContext({input:{academicYearId:"year-2026",termId:"term-2",classId:"class-p3",subjectId:"sub-math",weekNo:6},context:{organizationId:"org-school"}});
 assert.equal(out.filters.classId,"class-p3");
 assert.equal(out.filters.weekNo,6);
 assert.equal(out.subjects[0].id,"sub-math");
 const mapped=calls.find((call)=>call.sql.includes("JOIN school_class_subjects"));
 assert.ok(mapped);
 assert.equal(mapped.values[0],"org-school");
 assert.equal(mapped.values[1],"class-p3");
 assert.equal(mapped.values[2],"sub-math");
 assert.match(mapped.sql,/cs\.organization_id=c\.organization_id/);
 assert.match(mapped.sql,/c\.organization_id=\$1/);
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

test("unmatched fee payments use receipt unallocated balance and tenant scope",async()=>{
 const calls=[];
 const database={query:async(sql,values)=>{calls.push({sql,values});if(String(sql).startsWith("SELECT to_regclass"))return {rows:[{relation:"school_fee_receipts"}]};return {rows:[{id:"r1",unallocated_minor:5000}]};}};
 const tools=createLedgerlyBusinessTools({database});
 const out=await tools.findUnmatchedPayments({input:{limit:10},context:{organizationId:"org-fees"}});
 assert.equal(out.items[0].unallocated_minor,5000);
 const query=calls.at(-1);
 assert.equal(query.values[0],"org-fees");
 assert.match(query.sql,/school_fee_receipts/);
 assert.match(query.sql,/unallocated_minor>0/);
 assert.doesNotMatch(query.sql,/payment_allocations/);
});

test("fee reminder drafts use authoritative tenant balance and never send",async()=>{
 const calls=[];
 const database={query:async(sql,values)=>{const q=String(sql);calls.push({sql:q,values});if(q.startsWith("SELECT to_regclass"))return {rows:[{relation:values[0]}]};if(q.includes("FROM school_students"))return {rows:[{id:"stu-1",admission_number:"LMJ-001",first_name:"Amina",middle_name:null,last_name:"N."}]};if(q.includes("FROM school_student_fee_charges"))return {rows:[{charged_minor:90000}]};if(q.includes("FROM school_fee_receipts"))return {rows:[{allocated_minor:30000}]};if(q.includes("FROM organizations"))return {rows:[{base_currency:"UGX"}]};return {rows:[]};}};
 const tools=createLedgerlyBusinessTools({database});
 const draft=await tools.prepareFeeReminder({input:{studentId:"stu-1",tone:"friendly",dueDate:"Friday"},context:{organizationId:"org-a"}});
 assert.equal(draft.status,"draft");
 assert.equal(draft.balanceMinor,60000);
 assert.equal(draft.currency,"UGX");
 assert.equal(draft.sendRequired,false);
 assert.match(draft.message,/Amina/);
 assert.ok(calls.filter((call)=>Array.isArray(call.values)&&call.values.includes("org-a")).length>=4);
});

test("report tool returns an unpublished tenant-scoped structured draft",async()=>{
 const tools=createLedgerlyBusinessTools({database:{query:async()=>({rows:[]})}});
 const report=await tools.generateReport({input:{title:"Finance review",content:{summary:"Balanced"}},context:{organizationId:"org-a"},agent:{agentId:"a1"},taskId:"t1"});
 assert.equal(report.status,"draft");
 assert.equal(report.organizationId,"org-a");
 assert.equal(report.published,false);
 assert.equal(report.generatedBy.agentId,"a1");
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
