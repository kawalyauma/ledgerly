import assert from 'node:assert/strict';
import test from 'node:test';
import {PayrollTransactions} from '../src/finance/payroll-transactions.mjs';

function db(steps){let rolledBack=false;const calls=[];return{calls,get rolledBack(){return rolledBack},async transaction(fn){const tx={async query(sql,values){calls.push({sql,values});const step=steps.shift();if(!step)throw new Error('Unexpected query');return step}};try{return await fn(tx)}catch(e){rolledBack=true;throw e}}};}

test('payroll payment rollback prevents overpayment',async()=>{
  const database=db([{rows:[{id:'p1',status:'posted',amount_minor:'50'}],rowCount:1},{rows:[{id:'l1',net_minor:'100',paid_minor:'80',balance_minor:'20',payment_status:'partially_paid'}],rowCount:1}]);
  const service=new PayrollTransactions({database});
  await assert.rejects(service.recordSalaryPayment({organizationId:'o1',payrollLineId:'l1',paymentId:'p1',amountMinor:50}),e=>e.code==='PAYROLL_OVERPAYMENT');
  assert.equal(database.rolledBack,true);
});

test('salary reversal restores payroll balance only after accounting payment reversed',async()=>{
  const database=db([{rows:[{id:'ssp1',payroll_line_id:'l1',amount_minor:'30',status:'posted'}],rowCount:1},{rows:[{id:'p1',status:'reversed'}],rowCount:1},{rows:[{id:'l1',paid_minor:'20',balance_minor:'80',payment_status:'partially_paid'}],rowCount:1},{rows:[],rowCount:1}]);
  const service=new PayrollTransactions({database});
  const result=await service.reverseSalaryPayment({organizationId:'o1',paymentId:'p1',reason:'duplicate'});
  assert.equal(result.balance_minor,'80');
  assert.match(database.calls[2].sql,/paid_minor=GREATEST/);
});

test('payroll run reversal is blocked while any salary amount remains paid',async()=>{
  const database=db([{rows:[{id:'r1',status:'posted',journal_entry_id:'j1'}],rowCount:1},{rows:[{paid_minor:'1'}],rowCount:1}]);
  const service=new PayrollTransactions({database});
  await assert.rejects(service.assertRunReversible({organizationId:'o1',payrollRunId:'r1'}),e=>e.code==='PAYROLL_HAS_SALARY_PAYMENTS');
  assert.equal(database.rolledBack,true);
});
