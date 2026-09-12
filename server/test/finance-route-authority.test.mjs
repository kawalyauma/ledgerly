import assert from 'node:assert/strict';
import test from 'node:test';
import schoolFeesRoute from '../src/http/routes/school-fees.route.mjs';
import payrollRoute from '../src/http/routes/payroll.route.mjs';
import bankingRoute from '../src/http/routes/finance-banking.route.mjs';
import taxRoute from '../src/http/routes/finance-tax.route.mjs';

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

test('Payroll Node authority covers implemented Worker parity and leaves calculation fallback',()=>{
  assert.equal(matches(payrollRoute,'GET','/api/v1/payroll/manifest'),true);
  assert.equal(matches(payrollRoute,'GET','/api/v1/payroll/workforce'),true);
  assert.equal(matches(payrollRoute,'POST','/api/v1/payroll/employees'),true);
  assert.equal(matches(payrollRoute,'POST','/api/v1/payroll/runs/run1/approve'),true);
  assert.equal(matches(payrollRoute,'POST','/api/v1/payroll/runs/run1/reverse-safe'),true);
  assert.equal(matches(payrollRoute,'GET','/api/v1/payroll/runs/run1/payslips/emp1/pdf'),true);
  assert.equal(matches(payrollRoute,'PATCH','/api/v1/payroll/components/c1'),true);
  assert.equal(matches(payrollRoute,'PATCH','/api/v1/payroll/rules/r1'),true);
  assert.equal(matches(payrollRoute,'GET','/api/v1/payroll/statutory-returns'),true);
  assert.equal(matches(payrollRoute,'POST','/api/v1/payroll/payment-batches/b1/process-safe'),true);
  assert.equal(matches(payrollRoute,'GET','/api/v1/payroll/year-end/2026/statements'),true);
  assert.equal(matches(payrollRoute,'POST','/api/v1/payroll/runs/calculate'),false);
  assert.equal(matches(payrollRoute,'DELETE','/api/v1/payroll/components/c1'),false);
});

test('Banking Node authority fails closed outside implemented operations',()=>{
  assert.equal(matches(bankingRoute,'GET','/api/v1/banking/accounts'),true);
  assert.equal(matches(bankingRoute,'POST','/api/v1/banking/accounts/b1/reconciliations'),true);
  assert.equal(matches(bankingRoute,'POST','/api/v1/banking/transfers'),true);
  assert.equal(matches(bankingRoute,'DELETE','/api/v1/banking/accounts/b1'),false);
  assert.equal(matches(bankingRoute,'GET','/api/v1/banking/cash-drawers'),false);
});

test('Tax Node authority fails closed outside implemented operations',()=>{
  assert.equal(matches(taxRoute,'GET','/api/v1/tax/codes'),true);
  assert.equal(matches(taxRoute,'POST','/api/v1/tax/returns/r1/file'),true);
  assert.equal(matches(taxRoute,'POST','/api/v1/tax/returns/prepare'),true);
  assert.equal(matches(taxRoute,'DELETE','/api/v1/tax/codes/t1'),false);
  assert.equal(matches(taxRoute,'GET','/api/v1/tax/rates'),false);
});
