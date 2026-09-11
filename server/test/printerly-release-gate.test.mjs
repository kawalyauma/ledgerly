import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {PrinterlyRuntimeService} from '../src/printerly/runtime-service.mjs';
import {PrinterlyHardenedManagementService} from '../src/printerly/management-hardening-service.mjs';

test('active Printerly management path uses cryptographic pairing codes',async()=>{
  const extension=await readFile(new URL('../src/extensions/printerly.extension.mjs',import.meta.url),'utf8');
  const hardened=await readFile(new URL('../src/printerly/management-hardening-service.mjs',import.meta.url),'utf8');
  assert.match(extension,/PrinterlyHardenedManagementService/);
  assert.match(hardened,/randomInt\(0,1_000_000\)/);
  assert.doesNotMatch(hardened,/Math\.random/);
});

test('manual Printerly cost posting rechecks idempotency after locking cost and job rows',async()=>{
  const calls=[];
  const database={query:async()=>({rows:[]}),transaction:async fn=>fn({query:async(sql,args=[])=>{
    calls.push([sql,args]);
    if(sql.includes('FROM prn_cost_ledger')&&sql.includes('FOR UPDATE OF c,j'))return{rows:[{id:'cost-1',job_number:'PRT-1',title:'Report',total_cost_minor:5000,currency:'UGX'}]};
    if(sql.includes('SELECT journal_entry_id FROM prn_cost_postings'))return{rows:[{journal_entry_id:'je-existing'}]};
    if(sql.includes('INSERT INTO journal_entries'))throw new Error('duplicate journal must not be created');
    return{rows:[],rowCount:1};
  }})};
  const service=new PrinterlyHardenedManagementService({database,runtime:null,costing:null,jobs:null});
  const result=await service.postJobCost('org-1','user-1','job-1');
  assert.deepEqual(result,{jobId:'job-1',journalEntryId:'je-existing',duplicate:true});
  assert.match(calls[0][0],/FOR UPDATE OF c,j/);
  assert.match(calls[1][0],/prn_cost_postings/);
  assert.equal(calls.some(([sql])=>sql.includes('INSERT INTO journal_entries')),false);
  assert.ok(calls.slice(0,2).every(([sql,args])=>sql.includes('organization_id')&&args[0]==='org-1'));
});

test('expired node claims are tenant-scoped, reclaimed, and reacquired with SKIP LOCKED',async()=>{
  const calls=[];
  const tx={query:async(sql,args=[])=>{
    calls.push([sql,args]);
    if(sql.includes("status IN ('claimed','downloading')"))return{rows:[],rowCount:1};
    if(sql.includes("status='queued'")&&sql.includes('FOR UPDATE SKIP LOCKED'))return{rows:[{id:'job-1',printer_id:'printer-1',status:'queued'}]};
    if(sql.includes('FROM prn_printers'))return{rows:[{id:'printer-1',system_name:'Office'}]};
    return{rows:[],rowCount:1};
  }};
  const service=new PrinterlyRuntimeService({database:{transaction:async fn=>fn(tx)},randomToken:()=> 'lease-token'});
  const result=await service.claimForNode({organizationId:'org-1',nodeId:'node-1',printerIds:['printer-1']});
  assert.equal(result.claimToken,'lease-token');
  assert.match(calls[0][0],/claim_expires_at<=now\(\)/);
  assert.match(calls[0][0],/organization_id=\$1/);
  assert.equal(calls[0][1][0],'org-1');
  assert.ok(calls.some(([sql])=>/FOR UPDATE SKIP LOCKED/.test(sql)));
});

test('secure release credentials cannot be reused after successful redemption',async()=>{
  let used=false;
  const tx={query:async(sql,args=[])=>{
    if(sql.includes('FROM prn_release_credentials c JOIN prn_jobs'))return{rows:used?[]:[{id:'rel-1',job_id:'job-1',job_status:'held',job_printer_id:'printer-1',pin_digest:'123456',token_digest:'token'}]};
    if(sql.includes('FROM prn_printers'))return{rows:[{id:'printer-1'}]};
    if(sql.includes('UPDATE prn_release_credentials SET used_at')){used=true;return{rows:[],rowCount:1};}
    return{rows:[],rowCount:1};
  }};
  const service=new PrinterlyRuntimeService({database:{transaction:async fn=>fn(tx)},digest:value=>String(value)});
  const first=await service.redeemReleaseCredential({organizationId:'org-1',nodeId:'node-1',printerId:'printer-1',pin:'123456',token:'token'});
  assert.equal(first.status,'queued');
  await assert.rejects(()=>service.redeemReleaseCredential({organizationId:'org-1',nodeId:'node-1',printerId:'printer-1',pin:'123456',token:'token'}),error=>error.code==='RELEASE_INVALID');
});

test('secure release failure counter locks credentials at their attempt limit',async()=>{
  const calls=[];
  const tx={query:async(sql,args=[])=>{calls.push([sql,args]);if(sql.includes('SELECT id,attempts,max_attempts'))return{rows:[{id:'rel-1',attempts:4,max_attempts:5}]};return{rows:[],rowCount:1};}};
  const service=new PrinterlyRuntimeService({database:{transaction:async fn=>fn(tx)}});
  const result=await service.recordReleaseFailure({organizationId:'org-1',nodeId:'node-1',credentialId:'rel-1'});
  assert.deepEqual(result,{attempts:5,locked:true});
  const update=calls.find(([sql])=>sql.includes('UPDATE prn_release_credentials SET attempts'));
  assert.ok(update);assert.equal(update[1][0],5);assert.equal(update[1][1],true);
});

test('completion costing and accounting retain duplicate guards',async()=>{
  const costing=await readFile(new URL('../src/printerly/costing-service.mjs',import.meta.url),'utf8');
  assert.match(costing,/job\.status==='completed'&&existing/);
  assert.match(costing,/SELECT journal_entry_id FROM prn_cost_postings/);
  assert.match(costing,/idempotency_key/);
});
