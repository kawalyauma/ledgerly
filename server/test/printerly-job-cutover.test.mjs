import assert from 'node:assert/strict';
import test from 'node:test';
import printerlyExtension from '../src/extensions/printerly.extension.mjs';
import jobsRoute from '../src/http/routes/printerly-jobs.route.mjs';
import approvalsRoute from '../src/http/routes/printerly-approvals.route.mjs';
import documentsRoute from '../src/http/routes/printerly-documents.route.mjs';
import scansRoute from '../src/http/routes/printerly-scans.route.mjs';
import scannersRoute from '../src/http/routes/printerly-scanners.route.mjs';
import scannerlyRoute from '../src/http/routes/printerly-scannerly.route.mjs';
import {readPrinterlyMultipartFile} from '../src/printerly/document-service.mjs';
import {readScannerMultipartFile} from '../src/printerly/scanner-service.mjs';
import {readFile} from 'node:fs/promises';

test('Printerly route cutovers default to Cloudflare and jobs cannot outrun node appliances',()=>{
  assert.deepEqual(printerlyExtension.configure({}),{cutover:'cloudflare',nodeCutover:'cloudflare',jobCutover:'cloudflare',scannerCutover:'cloudflare',outboxPollMs:2000,workerPollMs:1000});
  assert.throws(()=>printerlyExtension.configure({LEDGERLY_PRINTERLY_NODE_CUTOVER:'cloudflare',LEDGERLY_PRINTERLY_JOB_CUTOVER:'node'}),/requires LEDGERLY_PRINTERLY_NODE_CUTOVER=node/);
  const config=printerlyExtension.configure({LEDGERLY_PRINTERLY_NODE_CUTOVER:'node',LEDGERLY_PRINTERLY_JOB_CUTOVER:'node',LEDGERLY_PRINTERLY_SCANNER_CUTOVER:'node'});assert.equal(config.jobCutover,'node');assert.equal(config.nodeCutover,'node');assert.equal(config.scannerCutover,'node');
  const legacy=printerlyExtension.configure({LEDGERLY_PRINTERLY_CUTOVER:'node'});assert.equal(legacy.nodeCutover,'node');assert.equal(legacy.scannerCutover,'node');
});

test('Printerly cutover owns only independently migrated prefixes',()=>{
  const config={extensions:{printerly:{nodeCutover:'node',jobCutover:'node',scannerCutover:'node'}}};
  assert.equal(jobsRoute.prefix,'/api/v1/printerly/jobs');assert.equal(jobsRoute.enabled(config),true);
  assert.equal(approvalsRoute.prefix,'/api/v1/printerly/approvals');assert.equal(approvalsRoute.enabled(config),true);
  assert.equal(documentsRoute.prefix,'/api/v1/printerly/documents');assert.equal(documentsRoute.enabled(config),true);
  assert.equal(scansRoute.prefix,'/api/v1/printerly/scans');assert.equal(scansRoute.enabled(config),true);
  assert.equal(scannersRoute.prefix,'/api/v1/printerly/scanners');assert.equal(scannerlyRoute.prefix,'/api/v1/printerly/scannerly');
  assert.notEqual(jobsRoute.prefix,'/api/v1/printerly');assert.notEqual(scansRoute.prefix,'/api/v1/printerly');
});

test('multipart parsers extract binary Printerly and Scannerly files without text conversion',async()=>{
  const boundary='----ledgerly-test',file=Buffer.from([0,1,2,255,10,13,42]);
  const body=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),file,Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const request=()=>({headers:{'content-type':`multipart/form-data; boundary=${boundary}`},async *[Symbol.asyncIterator](){yield body;}});
  const printed=await readPrinterlyMultipartFile(request());assert.equal(printed.name,'test.pdf');assert.equal(printed.mime,'application/pdf');assert.deepEqual(printed.bytes,file);
  const scanned=await readScannerMultipartFile(request());assert.equal(scanned.name,'test.pdf');assert.equal(scanned.mime,'application/pdf');assert.deepEqual(scanned.bytes,file);
});

test('Printerly job, approval and scan services lock high-risk transitions',async()=>{
  const jobs=await readFile(new URL('../src/printerly/job-service.mjs',import.meta.url),'utf8'),approvals=await readFile(new URL('../src/printerly/approval-service.mjs',import.meta.url),'utf8'),scans=await readFile(new URL('../src/printerly/scanner-service.mjs',import.meta.url),'utf8');
  assert.match(jobs,/FROM prn_documents[\s\S]*FOR UPDATE/);assert.match(jobs,/FROM prn_quota_periods[\s\S]*FOR UPDATE/);assert.match(jobs,/idempotency_key/);assert.match(jobs,/INSERT INTO prn_dispatch_outbox/);
  assert.match(approvals,/FOR UPDATE OF a,j/);assert.match(approvals,/status='approval_pending'/);assert.match(approvals,/INSERT INTO prn_dispatch_outbox/);assert.match(approvals,/prn_quota_reservations[\s\S]*FOR UPDATE/);
  assert.match(scans,/FOR UPDATE SKIP LOCKED/);assert.match(scans,/organization_id=\$1/);assert.match(scans,/claim_expires_at/);
});

test('Printerly runtime schema separates API idempotency from business source references',async()=>{const source=await readFile(new URL('../src/printerly/runtime-schema.mjs',import.meta.url),'utf8');assert.match(source,/ADD COLUMN IF NOT EXISTS idempotency_key/);assert.match(source,/prn_jobs_selfhost_idempotency_idx/);});
