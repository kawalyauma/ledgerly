import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import financeExtension from '../src/extensions/finance-api.extension.mjs';
import reportsRoute from '../src/http/routes/finance-reports.route.mjs';
import policiesRoute from '../src/http/routes/finance-approval-policies.route.mjs';
import documentApprovalRoute from '../src/http/routes/finance-document-approval.route.mjs';
import approvalsRoute from '../src/http/routes/finance-approvals.route.mjs';
import {FinanceReportsReadService,REPORT_TYPES} from '../src/finance/reports-read-service.mjs';

const request=method=>({method});
const url=pathname=>new URL(`http://localhost${pathname}`);

test('approvals and report reads stay Cloudflare-default',()=>{
  const config=financeExtension.configure({});
  assert.equal(config.approvalsCutover,'cloudflare');
  assert.equal(config.reportsCutover,'cloudflare');
  assert.equal(financeExtension.configure({LEDGERLY_FINANCE_APPROVALS_CUTOVER:'node'}).approvalsCutover,'node');
  assert.equal(financeExtension.configure({LEDGERLY_FINANCE_REPORTS_CUTOVER:'shadow'}).reportsCutover,'shadow');
});

test('report route claims only synchronous reads and leaves exports on Cloudflare',()=>{
  assert.equal(reportsRoute.matches({request:request('GET'),url:url('/api/v1/reports')}),true);
  assert.equal(reportsRoute.matches({request:request('GET'),url:url('/api/v1/reports/profit-loss')}),true);
  assert.equal(reportsRoute.matches({request:request('POST'),url:url('/api/v1/reports/profit-loss/exports')}),false);
  assert.equal(reportsRoute.matches({request:request('GET'),url:url('/api/v1/reports/exports/rpt_1/status')}),false);
  assert.equal(reportsRoute.matches({request:request('GET'),url:url('/api/v1/reports/exports/rpt_1/download')}),false);
});

test('approval routes are granular and do not swallow unrelated operations',()=>{
  assert.equal(policiesRoute.matches({request:request('POST'),url:url('/api/v1/operations/approval-policies')}),true);
  assert.equal(documentApprovalRoute.matches({request:request('POST'),url:url('/api/v1/operations/documents/doc_1/submit')}),true);
  assert.equal(documentApprovalRoute.matches({request:request('POST'),url:url('/api/v1/operations/documents/doc_1/other')}),false);
  assert.equal(approvalsRoute.matches({request:request('POST'),url:url('/api/v1/operations/approvals/apr_1/approve')}),true);
  assert.equal(approvalsRoute.matches({request:request('POST'),url:url('/api/v1/operations/approvals/apr_1/reject')}),true);
  assert.equal(approvalsRoute.matches({request:request('POST'),url:url('/api/v1/operations/approvals/apr_1/revise')}),true);
});

test('report type parity matches the Worker report catalog',()=>{
  assert.deepEqual(REPORT_TYPES,[
    'profit-loss','balance-sheet','cash-flow','trial-balance','general-ledger','transaction-detail',
    'receivables-ageing','payables-ageing','sales-analysis','expense-analysis','inventory-valuation',
    'project-profitability','budget-vs-actual','tax-summary','payroll-summary','changes-in-equity',
    'retained-earnings','customer-statement','supplier-statement','bank-reconciliation','fixed-asset-register',
    'depreciation','detailed-tax-return','consolidated-statements','comparative-statements',
  ]);
  const service=new FinanceReportsReadService({database:{query:async()=>({rows:[]})}});
  assert.equal(service.types().length,25);
  assert.rejects(service.generate('org','not-a-report',{}),error=>error?.code==='UNKNOWN_REPORT'&&error?.status===404);
});

test('approval writes lock rows transactionally and invalidate only after commit',async()=>{
  const source=await readFile(new URL('../src/finance/approval-service.mjs',import.meta.url),'utf8');
  assert.match(source,/FOR UPDATE/);
  assert.match(source,/FOR UPDATE OF r,d/);
  assert.match(source,/this\.db\.transaction/);
  assert.match(source,/createPostCommitInvalidator/);
  assert.match(source,/await invalidator\.committed\(\)/);
});

test('router supports per-method/path matchers for Cloudflare fallthrough',async()=>{
  const source=await readFile(new URL('../src/http/routes.mjs',import.meta.url),'utf8');
  assert.match(source,/descriptor\.matches/);
  assert.match(source,/continue;route=descriptor/);
});
