import test from "node:test";
import assert from "node:assert/strict";
import { AiDocumentEngine } from "../src/ai/document-engine.mjs";

function makeDocumentDatabase(initial) {
  const state={
    ...initial,
    approvals:[...(initial.approvals??[])],
    human_editors:[...(initial.human_editors??[])],
  };
  const db={
    async transaction(work){return work(db);},
    async query(sql,params=[]) {
      if(sql.includes("SELECT * FROM ledgerly_ai.documents")) return {rows:[{...state}],rowCount:1};
      if(sql.startsWith("UPDATE ledgerly_ai.documents SET status=")) {
        const [status,approvalJson]=params;
        state.status=status;
        if(approvalJson)state.approvals.push(JSON.parse(approvalJson));
        if(status==="changes_requested")state.rendered_pdf_ref=null;
        return {rows:[{...state}],rowCount:1};
      }
      if(sql.startsWith("UPDATE ledgerly_ai.documents SET content=")) {
        const [contentJson,version,provenanceJson,humanEditorsJson]=params;
        state.content=JSON.parse(contentJson);
        state.version=version;
        state.ai_provenance=JSON.parse(provenanceJson);
        if(humanEditorsJson)state.human_editors.push(...JSON.parse(humanEditorsJson));
        state.rendered_pdf_ref=null;
        return {rows:[{...state}],rowCount:1};
      }
      if(sql.startsWith("INSERT INTO ledgerly_ai.document_versions")) return {rows:[],rowCount:1};
      if(sql.startsWith("UPDATE ledgerly_ai.documents SET rendered_pdf_ref=")) {
        const [ref,,org,version,status]=params;
        if(org!==state.organization_id||Number(version)!==Number(state.version)||status!==state.status)return {rows:[],rowCount:0};
        state.rendered_pdf_ref=ref;
        return {rows:[{...state}],rowCount:1};
      }
      throw new Error(`unexpected SQL in document test: ${sql}`);
    },
  };
  return {db,state};
}

const writerContext={organizationId:"org-1",userId:"teacher-1",userName:"Teacher",permissions:["ai:write"]};
const approverContext={organizationId:"org-1",userId:"director-1",userName:"Director",permissions:["ai:write","ai:approve"]};

test("official document approval requires the review state and records the human approver",async()=>{
  const {db,state}=makeDocumentDatabase({document_id:"doc-1",organization_id:"org-1",type:"letter",title:"Parents Notice",content:{body:"Draft"},version:1,status:"draft",creator:{actor_type:"ai_agent"},ai_provenance:{fields:{}},rendered_pdf_ref:null});
  const engine=new AiDocumentEngine({database:db,audit:null});

  await assert.rejects(
    engine.setStatus({context:approverContext,documentId:"doc-1",status:"approved"}),
    (error)=>error?.code==="AI_DOCUMENT_INVALID_STATUS_TRANSITION",
  );

  await engine.setStatus({context:writerContext,documentId:"doc-1",status:"in_review",reason:"Ready for review"});
  await assert.rejects(
    engine.setStatus({context:writerContext,documentId:"doc-1",status:"approved",reason:"Self approve"}),
    (error)=>error?.code==="AI_DOCUMENT_APPROVAL_REQUIRED"&&error?.status===403,
  );
  const approved=await engine.setStatus({context:approverContext,documentId:"doc-1",status:"approved",reason:"Approved by Director"});
  assert.equal(approved.status,"approved");
  assert.equal(state.approvals.length,1);
  assert.equal(state.approvals[0].approved_by,"director-1");
  assert.equal(state.approvals[0].version,1);
});

test("approved documents are immutable and only an approver can reopen them",async()=>{
  const {db,state}=makeDocumentDatabase({document_id:"doc-2",organization_id:"org-1",type:"letter",title:"Circular",content:{body:"Approved copy"},version:2,status:"approved",creator:{actor_type:"ai_agent"},ai_provenance:{fields:{}},rendered_pdf_ref:"ai/documents/doc-2/v2.pdf"});
  const engine=new AiDocumentEngine({database:db,audit:null});

  await assert.rejects(
    engine.reviseHuman({context:writerContext,documentId:"doc-2",content:{body:"Silent edit"}}),
    (error)=>error?.code==="AI_DOCUMENT_NOT_EDITABLE",
  );
  await assert.rejects(
    engine.setStatus({context:writerContext,documentId:"doc-2",status:"changes_requested",reason:"Try to reopen"}),
    (error)=>error?.code==="AI_DOCUMENT_APPROVAL_REQUIRED",
  );

  await engine.setStatus({context:approverContext,documentId:"doc-2",status:"changes_requested",reason:"Correct the closing date"});
  assert.equal(state.rendered_pdf_ref,null);
  const revised=await engine.reviseHuman({context:writerContext,documentId:"doc-2",content:{body:"Corrected copy"},reason:"Correct date"});
  assert.equal(revised.version,3);
  assert.deepEqual(revised.content,{body:"Corrected copy"});
});

test("published documents remain immutable and archiving them requires an approver",async()=>{
  const {db,state}=makeDocumentDatabase({document_id:"doc-3",organization_id:"org-1",type:"notice",title:"Published",content:{body:"Final"},version:4,status:"published",creator:{actor_type:"human"},ai_provenance:{fields:{}},rendered_pdf_ref:"ai/documents/doc-3/v4.pdf"});
  const engine=new AiDocumentEngine({database:db,audit:null});
  await assert.rejects(engine.reviseHuman({context:writerContext,documentId:"doc-3",content:{body:"Changed"}}),(error)=>error?.code==="AI_DOCUMENT_NOT_EDITABLE");
  await assert.rejects(engine.setStatus({context:writerContext,documentId:"doc-3",status:"archived"}),(error)=>error?.code==="AI_DOCUMENT_APPROVAL_REQUIRED");
  const archived=await engine.setStatus({context:approverContext,documentId:"doc-3",status:"archived",reason:"Superseded"});
  assert.equal(archived.status,"archived");
  assert.equal(state.status,"archived");
});

test("Secretary renderer writes an approved PDF only through tenant-scoped storage",async(t)=>{
  let createAiDocumentRenderer;
  try {
    ({createAiDocumentRenderer}=await import("../src/ai/document-renderer.mjs"));
  } catch(error) {
    if(error?.code==="ERR_MODULE_NOT_FOUND"&&String(error.message).includes("pdf-lib"))return t.skip("pdf-lib is unavailable in the offline smoke environment");
    throw error;
  }
  let stored=null;
  const database={
    async query(sql){
      if(sql.includes("FROM organizations"))return {rows:[{id:"org-1",name:"Lubowa Memorial Junior School",legal_name:"Lubowa Memorial Junior School",timezone:"Africa/Kampala",branding_json:"{}"}]};
      if(sql.includes("FROM school_profiles"))return {rows:[{school_code:"LMJS",motto:"Knowledge and Discipline",physical_address:"Kampala",country:"Uganda",branding_json:"{}"}]};
      throw new Error(`unexpected SQL in renderer test: ${sql}`);
    },
  };
  const tenantStorage={forOrganization(organizationId){assert.equal(organizationId,"org-1");return {async put(key,data,metadata){stored={key,data:Buffer.from(data),metadata};}};}};
  const renderer=createAiDocumentRenderer({database,tenantStorage});
  const result=await renderer({
    context:approverContext,
    document:{document_id:"doc-secretary",organization_id:"org-1",type:"letter",title:"End of Term Notice",content:{recipient:"Parents and Guardians",body:"Term closes on Friday."},version:2,status:"approved",creator:{agent_name:"Mirembe"}},
  });
  assert.equal(result.ref,"ai/documents/doc-secretary/v2.pdf");
  assert.equal(stored.key,result.ref);
  assert.equal(stored.metadata.contentType,"application/pdf");
  assert.equal(stored.data.subarray(0,4).toString("ascii"),"%PDF");
});
