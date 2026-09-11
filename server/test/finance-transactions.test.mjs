import assert from "node:assert/strict";
import test from "node:test";
import { FinanceIntegrityError, FinanceTransactions, schoolFeeReversalHandler } from "../src/finance/transactions.mjs";

function scriptedDatabase(steps) {
  let rolledBack = false;
  const calls = [];
  return {
    calls,
    get rolledBack() { return rolledBack; },
    async transaction(work) {
      const tx = { async query(sql,values) {
        calls.push({sql,values});
        const step = steps.shift();
        if (!step) throw new Error(`Unexpected query: ${sql}`);
        if (step.error) throw step.error;
        return typeof step.result === "function" ? step.result(sql,values) : step.result;
      }};
      try { return await work(tx); } catch (error) { rolledBack = true; throw error; }
    },
  };
}

test("journal posting rejects imbalance inside transaction", async () => {
  const db=scriptedDatabase([
    {result:{rows:[{id:"j1",status:"draft"}],rowCount:1}},
    {result:{rows:[{line_count:2,debit_minor:"100",credit_minor:"90"}],rowCount:1}},
  ]);
  const service=new FinanceTransactions({database:db});
  await assert.rejects(
    service.postJournal({organizationId:"o1",journalId:"j1",actorId:"u1"}),
    (error)=>error instanceof FinanceIntegrityError && error.code==="UNBALANCED_JOURNAL",
  );
  assert.equal(db.rolledBack,true);
});

test("simultaneous allocation safety is based on row locks and current aggregate", async () => {
  const db=scriptedDatabase([
    {result:{rows:[],rowCount:0}},
    {result:{rows:[{id:"p1",type:"receipt",contact_id:"c1",currency:"UGX",amount_minor:"100",status:"posted"}],rowCount:1}},
    {result:{rows:[{id:"d1",type:"invoice",contact_id:"c1",currency:"UGX",total_minor:"100",paid_minor:"80",status:"partially_paid"}],rowCount:1}},
    {result:{rows:[{allocated_minor:"80"}],rowCount:1}},
  ]);
  const service=new FinanceTransactions({database:db});
  await assert.rejects(
    service.allocatePayment({organizationId:"o1",allocationId:"a2",paymentId:"p1",documentId:"d1",amountMinor:30}),
    (error)=>error.code==="PAYMENT_OVERALLOCATED" || error.code==="DOCUMENT_OVERALLOCATED",
  );
  assert.equal(db.rolledBack,true);
  assert.match(db.calls[1].sql,/FOR UPDATE/);
  assert.match(db.calls[2].sql,/FOR UPDATE/);
});

test("duplicate allocation id is idempotent and does not mutate balances twice", async () => {
  const db=scriptedDatabase([
    {result:{rows:[{id:"a1",payment_id:"p1",document_id:"d1",amount_minor:"20"}],rowCount:1}},
  ]);
  const service=new FinanceTransactions({database:db});
  const result=await service.allocatePayment({organizationId:"o1",allocationId:"a1",paymentId:"p1",documentId:"d1",amountMinor:20});
  assert.equal(result.alreadyApplied,true);
  assert.equal(db.calls.length,1);
});

test("school-fee source reversal runs before GL reversal and shares transaction", async () => {
  const db=scriptedDatabase([
    {result:{rows:[{id:"j1",status:"posted",source_type:"school_fee_payment",description:"Fees",currency:"UGX",exchange_rate_micros:"1000000",metadata:"{}"}],rowCount:1}},
    {result:{rows:[
      {id:"l1",account_id:"cash",debit_minor:"100",credit_minor:"0",base_debit_minor:"100",base_credit_minor:"0"},
      {id:"l2",account_id:"fees",debit_minor:"0",credit_minor:"100",base_debit_minor:"0",base_credit_minor:"100"},
    ],rowCount:2}},
    {result:{rows:[{id:"fp1",status:"posted"}],rowCount:1}},
    {result:{rows:[{id:"fp1"}],rowCount:1}},
    {result:{rows:[],rowCount:1}},
    {result:{rows:[],rowCount:1}},
    {result:{rows:[],rowCount:1}},
    {result:{rows:[],rowCount:1}},
    {result:{rows:[{id:"j1"}],rowCount:1}},
  ]);
  const handlers=new Map([["school_fee_payment",schoolFeeReversalHandler()]]);
  const service=new FinanceTransactions({database:db,sourceReversalHandlers:handlers});
  const result=await service.reverseJournal({
    organizationId:"o1",journalId:"j1",actorId:"u1",postingDate:"2026-09-11",
    reason:"Duplicate receipt",reversalId:"jr1",reversalNumber:"JE-R-1",
  });
  assert.equal(result.status,"reversed");
  const schoolFeeUpdateIndex=db.calls.findIndex((call)=>call.sql.includes("UPDATE school_fee_payments"));
  const reversalInsertIndex=db.calls.findIndex((call)=>call.sql.includes("INSERT INTO journal_entries"));
  assert.ok(schoolFeeUpdateIndex >= 0 && schoolFeeUpdateIndex < reversalInsertIndex);
});

test("source reversal failure rolls back the entire reversal", async () => {
  const db=scriptedDatabase([
    {result:{rows:[{id:"j1",status:"posted",source_type:"school_fee_payment",description:"Fees",currency:"UGX",exchange_rate_micros:"1000000",metadata:"{}"}],rowCount:1}},
    {result:{rows:[
      {id:"l1",account_id:"cash",debit_minor:"100",credit_minor:"0"},
      {id:"l2",account_id:"fees",debit_minor:"0",credit_minor:"100"},
    ],rowCount:2}},
    {result:{rows:[],rowCount:0}},
  ]);
  const service=new FinanceTransactions({database:db,sourceReversalHandlers:new Map([["school_fee_payment",schoolFeeReversalHandler()]])});
  await assert.rejects(
    service.reverseJournal({organizationId:"o1",journalId:"j1",actorId:"u1",postingDate:"2026-09-11",reason:"x reason",reversalId:"jr1",reversalNumber:"JE-R-1"}),
    (error)=>error.code==="SOURCE_LINK_MISSING",
  );
  assert.equal(db.rolledBack,true);
  assert.equal(db.calls.some((call)=>call.sql.includes("INSERT INTO journal_entries")),false);
});
