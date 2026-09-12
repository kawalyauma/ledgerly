import test from 'node:test';
import assert from 'node:assert/strict';
import payrollRoute from '../src/http/routes/payroll.route.mjs';
import {PayrollCalculationService} from '../src/finance/payroll-calculation-service.mjs';

test('payroll route claims the legacy calculate endpoint',()=>{
  assert.equal(payrollRoute.matches({request:{method:'POST'},url:new URL('http://ledgerly/api/v1/payroll/runs/calculate')}),true);
});

test('payroll calculation is atomic and invalidates tenant cache only after commit',async()=>{
  const events=[];
  const cache={async invalidateTag(tag){events.push(`invalidate:${tag}`);}};
  const tx={async query(sql){
    events.push(sql.trim().split(/\s+/).slice(0,3).join(' '));
    if(sql.includes('FROM payroll_rules'))return{rows:[{id:'rule-1',currency:'UGX'}]};
    if(sql.includes('FROM employees'))return{rows:[{id:'emp-1',employee_number:'E001',base_pay_minor:'100000',currency:'UGX'}]};
    if(sql.includes('FROM payroll_rule_bands'))return{rows:[{id:'band-1',kind:'PAYE',lower_minor:'0',upper_minor:null,rate_micros:'100000',fixed_minor:'0',employee_rate_micros:null,employer_rate_micros:'50000'}]};
    if(sql.includes('FROM payroll_inputs'))return{rows:[{id:'input-1',employee_id:'emp-1',input_date:'2026-09-01',type:'bonus',amount_minor:'10000'}]};
    if(sql.includes('to_regclass'))return{rows:[{table_name:null}]};
    return{rows:[],rowCount:1};
  }};
  const database={async transaction(fn){events.push('tx:start');const value=await fn(tx);events.push('tx:commit');return value;}};
  const service=new PayrollCalculationService({database,cache});
  const result=await service.calculate({organizationId:'org-1',actorId:'user-1',input:{number:'SEP-2026',periodStart:'2026-09-01',periodEnd:'2026-09-30',payDate:'2026-09-30',currency:'UGX',ruleId:'rule-1'}});
  assert.equal(result.grossMinor,110000);
  assert.equal(result.deductionsMinor,11000);
  assert.equal(result.employerCostsMinor,5500);
  assert.equal(result.netMinor,99000);
  assert.equal(result.employeeCount,1);
  const commitIndex=events.indexOf('tx:commit');
  assert.ok(commitIndex>=0);
  assert.ok(events.indexOf('invalidate:org:org-1:dashboard-summary')>commitIndex);
  assert.ok(events.indexOf('invalidate:org:org-1:reference-counts')>commitIndex);
});

test('payroll calculation never invalidates cache after transaction failure',async()=>{
  const invalidations=[];
  const cache={async invalidateTag(tag){invalidations.push(tag);}};
  const database={async transaction(){throw new Error('boom');}};
  const service=new PayrollCalculationService({database,cache});
  await assert.rejects(()=>service.calculate({organizationId:'org-1',actorId:'user-1',input:{number:'SEP-2026',periodStart:'2026-09-01',periodEnd:'2026-09-30',payDate:'2026-09-30',currency:'UGX',ruleId:'rule-1'}}),/boom/);
  assert.deepEqual(invalidations,[]);
});
