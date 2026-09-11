import test from "node:test";
import assert from "node:assert/strict";
import { AiWorkforceStore } from "../src/ai/store.mjs";
import { AiDocumentEngine } from "../src/ai/document-engine.mjs";
import { AiToolGateway, registerCoreTools } from "../src/ai/tool-gateway.mjs";

test("seeded roles expose safe document and notification capabilities", async () => {
  const inserts=[];
  const database={query:async(sql,values=[])=>{if(String(sql).includes("INSERT INTO ledgerly_ai.agents"))inserts.push(values);return {rows:[]};}};
  const store=new AiWorkforceStore({database,logger:{warn(){}}});
  await store.seedTemplates("org-a",(key)=>`agent-${key}`);
  const byKey=new Map(inserts.map((values)=>[values[8],{tools:JSON.parse(values[9]),permissions:JSON.parse(values[10]),instructions:values[6]}]));
  const secretary=byKey.get("secretary");
  assert.ok(secretary.tools.includes("create_document_draft"));
  assert.ok(secretary.tools.includes("send_notification"));
  assert.ok(secretary.permissions.includes("documents:write"));
  assert.ok(secretary.permissions.includes("notifications:send"));
  assert.match(secretary.instructions,/Secretary/);
  const reception=byKey.get("reception_assistant");
  assert.ok(reception.permissions.includes("notifications:send"));
  const reviewer=byKey.get("academic_reviewer");
  assert.ok(reviewer.tools.includes("record_academic_review"));
  assert.equal(reviewer.tools.includes("update_document_draft"),false);
  assert.equal(reviewer.permissions.includes("documents:write"),false);
});

test("create_document_draft is a permissioned persistent tool", async () => {
  const gateway=registerCoreTools(new AiToolGateway({audit:{write:async()=>{}}}),{
    createDocumentDraft:async({input})=>({document_id:"doc-1",status:"draft",...input}),
  });
  const agent={agentId:"secretary-1",name:"Mirembe",role:"Secretary",status:"active",autonomyLevel:2,allowedTools:["create_document_draft"],permissions:["documents:write"]};
  const result=await gateway.invoke({agent,context:{organizationId:"org-a",userId:"human-1",permissions:["documents:write"]},taskId:"task-1",toolName:"create_document_draft",input:{type:"letter",title:"Parent Notice",content:{body:"Hello"}}});
  assert.equal(result.status,"executed");
  assert.equal(result.output.document_id,"doc-1");
  assert.equal(result.output.type,"letter");
});

test("approved documents persist an official human approval record", async () => {
  const calls=[];
  const database={transaction:async(fn)=>fn({query:async(sql,values=[])=>{calls.push({sql:String(sql),values});if(String(sql).startsWith("SELECT * FROM ledgerly_ai.documents"))return {rows:[{document_id:"doc-1",organization_id:"org-a",status:"in_review",approvals:[]}]};if(String(sql).startsWith("UPDATE ledgerly_ai.documents"))return {rows:[{document_id:"doc-1",organization_id:"org-a",status:"approved"}]};return {rows:[]};}})};
  const audit=[];
  const engine=new AiDocumentEngine({database,audit:{write:async(entry)=>audit.push(entry)}});
  const result=await engine.setStatus({context:{organizationId:"org-a",userId:"human-1",userName:"Director",permissions:["ai:approve"]},documentId:"doc-1",status:"approved",reason:"Reviewed"});
  assert.equal(result.status,"approved");
  const update=calls.find((call)=>call.sql.startsWith("UPDATE ledgerly_ai.documents"));
  const approvals=JSON.parse(update.values[3]);
  assert.equal(approvals[0].actor_type,"human");
  assert.equal(approvals[0].actor_id,"human-1");
  assert.equal(approvals[0].official,true);
  assert.equal(audit.at(-1).metadata.official_approval,true);
});

test("document attachments remain editable only before final approval", async () => {
  const editableDb={transaction:async(fn)=>fn({query:async(sql,values=[])=>{if(String(sql).startsWith("SELECT * FROM ledgerly_ai.documents"))return {rows:[{document_id:"doc-1",organization_id:"org-a",status:"draft",attachments:[]}]};if(String(sql).startsWith("UPDATE ledgerly_ai.documents")){const attachments=JSON.parse(values[0]);return {rows:[{document_id:"doc-1",status:"draft",attachments}]};}return {rows:[]};}})};
  const engine=new AiDocumentEngine({database:editableDb,audit:{write:async()=>{}}});
  const added=await engine.addAttachment({context:{organizationId:"org-a",userId:"human-1"},documentId:"doc-1",name:"minutes.pdf",storageRef:"ai/documents/doc-1/attachments/a.pdf",contentType:"application/pdf",size:123});
  assert.equal(added.attachment.name,"minutes.pdf");
  assert.equal(added.document.attachments.length,1);

  const finalizedDb={transaction:async(fn)=>fn({query:async(sql)=>String(sql).startsWith("SELECT * FROM ledgerly_ai.documents")?{rows:[{document_id:"doc-1",organization_id:"org-a",status:"approved",attachments:[]}]}:{rows:[]}})};
  const finalized=new AiDocumentEngine({database:finalizedDb,audit:{write:async()=>{}}});
  await assert.rejects(()=>finalized.addAttachment({context:{organizationId:"org-a",userId:"human-1"},documentId:"doc-1",name:"late.pdf",storageRef:"late"}),(error)=>error.status===409);
});
