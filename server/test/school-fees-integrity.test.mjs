import assert from 'node:assert/strict';
import test from 'node:test';
import { schoolFeeReceiptReversalHandler } from '../src/finance/school-fees-reversal.mjs';
import { SCHOOL_FEES_TABLES } from '../src/migration/school-fees-manifest.mjs';

function scripted(steps){ const calls=[]; return {calls,tx:{async query(sql,values){calls.push({sql,values});const step=steps.shift();if(!step)throw new Error(`Unexpected query ${sql}`);return step;}}}; }

test('school-fee migration keeps receipt archive and mobile intent after authoritative receipt',()=>{
  const names=SCHOOL_FEES_TABLES.map(x=>x.name);
  assert.ok(names.indexOf('school_fee_receipts') < names.indexOf('school_fee_receipt_snapshots'));
  assert.ok(names.indexOf('school_fee_receipts') < names.indexOf('school_mobile_fee_receipt_intents'));
});

test('D1 fee booleans are converted for PostgreSQL',()=>{
  const line=SCHOOL_FEES_TABLES.find(x=>x.name==='school_fee_structure_lines').transform({mandatory:1,discountable:0,installment_allowed:1,refundable:0});
  assert.deepEqual([line.mandatory,line.discountable,line.installment_allowed,line.refundable],[true,false,true,false]);
});

test('receipt reversal restores document balance before reversing receipt/payment',async()=>{
  const {tx,calls}=scripted([
    {rows:[{receipt_id:'r1',receipt_status:'posted',payment_id:'p1',payment_status:'posted'}],rowCount:1},
    {rows:[{id:'a1',document_id:'d1',amount_minor:'30'}],rowCount:1},
    {rows:[{id:'d1',paid_minor:'70',status:'partially_paid'}],rowCount:1},
    {rows:[],rowCount:1},
    {rows:[],rowCount:1},
    {rows:[{id:'p1'}],rowCount:1},
    {rows:[{id:'r1'}],rowCount:1},
  ]);
  const result=await schoolFeeReceiptReversalHandler()({tx,organizationId:'o1',original:{id:'j1'},reason:'duplicate'});
  assert.equal(result.handled,true);
  assert.ok(calls.findIndex(c=>c.sql.includes('UPDATE documents')) < calls.findIndex(c=>c.sql.includes("UPDATE payments SET status='reversed'")));
  assert.ok(calls.some(c=>c.sql.includes('reversed_at IS NULL')));
});

test('non-school payment journal is not claimed by school-fee handler',async()=>{
  const {tx}=scripted([{rows:[],rowCount:0}]);
  const result=await schoolFeeReceiptReversalHandler()({tx,organizationId:'o1',original:{id:'j2'},reason:'x'});
  assert.deepEqual(result,{handled:false});
});
