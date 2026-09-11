import assert from 'node:assert/strict';
import test from 'node:test';
import {ensureFinanceOperationsSchema} from '../src/migration/finance-operations-schema.mjs';

test('finance operations schema keeps high-risk modules tenant scoped',async()=>{
  let sql='';
  await ensureFinanceOperationsSchema({async query(text){sql=text;return{rows:[]}}});
  for(const table of ['fiscal_periods','bank_transactions','bank_reconciliations','inventory_movements','stock_counts','expense_claims','ledgerly_mobile_journal_intents']){
    assert.match(sql,new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?organization_id text NOT NULL`));
  }
});

test('mobile journals are intents rather than direct offline posted journals',async()=>{
  let sql=''; await ensureFinanceOperationsSchema({async query(text){sql=text;return{rows:[]}}});
  assert.match(sql,/ledgerly_mobile_journal_intents/);
  assert.match(sql,/status IN \('pending','processing','retry','applied','rejected'\)/);
  assert.doesNotMatch(sql,/ledgerly_mobile_journal_intents[\s\S]*?status text NOT NULL DEFAULT 'posted'/);
});
