import assert from 'node:assert/strict';
import test from 'node:test';
import schoolFeesRoute from '../src/http/routes/school-fees.route.mjs';
import payrollRoute from '../src/http/routes/payroll.route.mjs';

function matches(route,method,path){return route.matches({request:{method},url:new URL(`http://ledgerly${path}`)});}

test('School Fees Node authority includes only implemented endpoint/method pairs',()=>{
  assert.equal(matches(schoolFeesRoute,'GET','/api/v1/school-fees/fee-categories'),true);
  assert.equal(matches(schoolFeesRoute,'POST','/api/v1/school-fees/receipts'),true);
  assert.equal(matches(schoolFeesRoute,'POST','/api/v1/school-fees/charges/c1/adjustments'),true);
  assert.equal(matches(schoolFeesRoute,'GET','/api/v1/school-fees/students/s1/balance'),true);
  assert.equal(matches(schoolFeesRoute,'GET','/api/v1/school-fees/billing-batches'),false);
  assert.equal(matches(schoolFeesRoute,'POST','/api/v1/school-fees/receipts/r1/reverse'),false);
  assert.equal(matches(schoolFeesRoute,'DELETE','/api/v1/school-fees/structures/s1'),false);
});

test('Payroll Node authority includes only implemented endpoint/method pairs',()=>{
  assert.equal(matches(payrollRoute,'GET','/api/v1/payroll/employees'),true);
  assert.equal(matches(payrollRoute,'POST','/api/v1/payroll/runs'),true);
  assert.equal(matches(payrollRoute,'POST','/api/v1/payroll/runs/run1/reverse'),true);
  assert.equal(matches(payrollRoute,'POST','/api/v1/payroll/salary-payments/pay1/reverse'),true);
  assert.equal(matches(payrollRoute,'GET','/api/v1/payroll/statutory-returns'),false);
  assert.equal(matches(payrollRoute,'POST','/api/v1/payroll/payment-batches'),false);
  assert.equal(matches(payrollRoute,'PATCH','/api/v1/payroll/components/c1'),false);
});
