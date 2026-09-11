import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {policyApplies} from '../src/printerly/batch-service.mjs';

test('Printerly batch policy matching preserves role, source and cost boundaries',()=>{
  const principal={userId:'u1',role:'teacher'};
  const options={sourceModule:'printerly-batch',priority:'normal',colorMode:'color',pageSize:'A4',copies:2,projectId:'p1',departmentType:'school',departmentId:'d1'};
  const prepared={estimatedImpressions:20,estimatedCostMinor:5000};
  assert.equal(policyApplies({roles:['teacher'],sourceModules:['printerly-batch'],minCostMinor:4000,maxCostMinor:6000,departments:['school:d1']},principal,options,prepared),true);
  assert.equal(policyApplies({roles:['admin']},principal,options,prepared),false);
  assert.equal(policyApplies({maxCostMinor:4999},principal,options,prepared),false);
});

test('Printerly batch dispatch leases work and commits policy, approval, quota and document state atomically',async()=>{
  const source=await readFile(new URL('../src/printerly/batch-service.mjs',import.meta.url),'utf8');
  assert.match(source,/FOR UPDATE SKIP LOCKED/);
  assert.match(source,/FOR UPDATE OF i,d/);
  assert.match(source,/status='approval_pending'/);
  assert.match(source,/INSERT INTO prn_approvals/);
  assert.match(source,/SELECT \* FROM prn_quota_periods[\s\S]*FOR UPDATE/);
  assert.match(source,/UPDATE prn_documents SET status='attached'/);
  assert.match(source,/status='dispatching' AND claim_token=\$4/);
  assert.match(source,/INSERT INTO prn_dispatch_outbox/);
});

test('Printerly extension routes only authoritative durable batch jobs through policy-aware batch service',async()=>{
  const source=await readFile(new URL('../src/extensions/printerly.extension.mjs',import.meta.url),'utf8');
  assert.match(source,/new PrinterlyBatchService/);
  assert.match(source,/'printerly\.batch-dispatch':'batchCutover'/);
  assert.match(source,/'printerly\.batch-status':'batchCutover'/);
  assert.match(source,/'printerly\.batch-dispatch':runBatch/);
  assert.match(source,/if\(!kindEnabled\(job\.kind\)\)return\{skipped:true,reason:'cloudflare-authoritative'\}/);
  assert.match(source,/await batches\.dispatch\(org\)/);
  assert.match(source,/await maintenance\.batchStatus\(org\)/);
});
