import assert from 'node:assert/strict';
import test from 'node:test';
import finance from '../src/migration/phases/finance-core.phase.mjs';
import fees from '../src/migration/phases/school-fees.phase.mjs';
import payroll from '../src/migration/phases/payroll.phase.mjs';

test('finance-owned phases declare integration prerequisites',()=>{
  assert.deepEqual(finance.prerequisites,['auth-core']);
  assert.deepEqual(fees.prerequisites,['finance-core','school-reference']);
  assert.deepEqual(payroll.prerequisites,['finance-core']);
});

test('finance phases include relationship and domain integrity gates',()=>{
  for(const phase of [finance,fees,payroll]){
    assert.ok(phase.tables.length>0,`${phase.name} tables`);
    assert.ok(phase.relationshipChecks.length>0,`${phase.name} checks`);
    assert.equal(typeof phase.ensureSchema,'function');
  }
});

test('finance core migrates reversed allocation timestamps',()=>{
  const allocations=finance.tables.find(table=>table.name==='payment_allocations');
  assert.ok(allocations.columns.includes('reversed_at'));
});
