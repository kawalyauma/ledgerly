import assert from 'node:assert/strict';import test from 'node:test';
import {createCutoverCapabilities} from '../src/runtime/cutover-capabilities.mjs';
import {TenantCache,createPostCommitInvalidator} from '../src/cache/tenant-cache.mjs';
import {createJobEnvelope,FINANCE_JOB_TYPES,runQueuedJob} from '../src/jobs/finance-job-catalog.mjs';

test('high-risk finance stays Cloudflare-authoritative by default',()=>{const c=createCutoverCapabilities();for(const key of ['finance.payments.write','finance.journals.write','finance.reversals.write','school-fees.reversal','payroll.reversal'])assert.equal(c.state(key),'cloudflare');});
test('tenant cache keys and tags cannot cross organizations',()=>{const fake={};const a=new TenantCache({cache:fake,organizationId:'a'}),b=new TenantCache({cache:fake,organizationId:'b'});assert.notEqual(a.key('accounts'),b.key('accounts'));assert.notEqual(a.tag('accounts'),b.tag('accounts'));});
test('cache invalidation occurs only after explicit commit',async()=>{const invalidated=[];const i=createPostCommitInvalidator({cache:{async invalidateTag(x){invalidated.push(x)}},organizationId:'o1'});i.mark('accounts','dashboard-summary');assert.deepEqual(invalidated,[]);await i.committed();assert.equal(invalidated.length,2);});
test('job envelopes require idempotency and retries through durable queue',async()=>{const job=createJobEnvelope({jobId:'j1',type:FINANCE_JOB_TYPES.PAYROLL,organizationId:'o1',idempotencyKey:'pay:r1'});let retried=false;const queue={async take(){return{job,receipt:'x'}},async retry(){retried=true;return{retried:true}},async ack(){throw new Error('must not ack')},async deadLetter(){}};await runQueuedJob({queue,handlers:{[FINANCE_JOB_TYPES.PAYROLL]:async()=>{throw new Error('fail')}}});assert.equal(retried,true);});
