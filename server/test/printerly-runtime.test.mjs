import assert from 'node:assert/strict';
import test from 'node:test';
import {NODE_TRANSITIONS,PrinterlyRuntimeError,PrinterlyRuntimeService,projectedExceeded} from '../src/printerly/runtime-service.mjs';
import {PrinterlyDispatchWorker} from '../src/printerly/dispatch-worker.mjs';
import {ensurePrinterlyRuntimeSchema} from '../src/printerly/runtime-schema.mjs';

test('quota projection counts consumed, reserved and requested usage',()=>{
  assert.equal(projectedExceeded({max_impressions:100,max_sheets:0,max_cost_minor:0},{consumed_impressions:60,reserved_impressions:20},{impressions:21,sheets:0,costMinor:0}),true);
  assert.equal(projectedExceeded({max_impressions:100,max_sheets:0,max_cost_minor:0},{consumed_impressions:60,reserved_impressions:20},{impressions:20,sheets:0,costMinor:0}),false);
});

test('node transition graph never permits skipping directly from claimed to completed',()=>{
  assert.equal(NODE_TRANSITIONS.claimed.has('completed'),false);
  assert.equal(NODE_TRANSITIONS.claimed.has('downloading'),true);
});

test('runtime schema supplies durable outbox and self-host request idempotency',async()=>{
  let sql='';await ensurePrinterlyRuntimeSchema({query:async text=>{sql+=text;return {rows:[]};}});
  assert.match(sql,/CREATE TABLE IF NOT EXISTS prn_dispatch_outbox/);
  assert.match(sql,/UNIQUE\(organization_id,job_id,event_type\)/);
  assert.match(sql,/prn_jobs_selfhost_request_idx/);
});

test('createJob returns an existing self-host request without mutating state',async()=>{
  const queries=[];
  const database={transaction:async fn=>fn({query:async(sql,args)=>{queries.push([sql,args]);if(sql.includes("source_module='selfhost-api'"))return {rows:[{id:'j1',job_number:'PRT-1',status:'queued'}],rowCount:1};throw new Error('unexpected query');}})};
  const service=new PrinterlyRuntimeService({database});
  const result=await service.createJob({organizationId:'o1',userId:'u1',documentId:'d1',idempotencyKey:'same'});
  assert.equal(result.alreadyCreated,true);assert.equal(queries.length,1);
});

test('secure release issuer uses injected six-digit cryptographic pin source and stores only digests',async()=>{
  const writes=[];
  const tx={query:async(sql,args=[])=>{
    writes.push([sql,args]);
    if(sql.includes('SELECT id,status,secure_release'))return {rows:[{id:'j1',status:'held',secure_release:true}],rowCount:1};
    return {rows:[],rowCount:1};
  }};
  const database={transaction:async fn=>fn(tx)};
  const service=new PrinterlyRuntimeService({database,digest:value=>`digest:${value}`,randomPin:()=> '004321',randomToken:()=> 'token-secret'});
  const result=await service.issueReleaseCredential({organizationId:'o1',userId:'u1',jobId:'j1'});
  assert.equal(result.pin,'004321');
  assert.equal(result.token,'token-secret');
  const insert=writes.find(([sql])=>sql.includes('INSERT INTO prn_release_credentials'));
  assert.ok(insert);
  assert.equal(insert[1][4],'digest:004321');
  assert.equal(insert[1][5],'digest:token-secret');
  assert.equal(writes.some(([,args])=>args.some(value=>value==='004321'||value==='token-secret')),false,'clear release secrets must not be persisted as query arguments');
});

test('secure release issuer rejects malformed pin providers',async()=>{
  const database={transaction:async()=>{throw new Error('transaction should not run for malformed pin');}};
  const service=new PrinterlyRuntimeService({database,randomPin:()=> '12345'});
  await assert.rejects(()=>service.issueReleaseCredential({organizationId:'o1',userId:'u1',jobId:'j1'}),/six-digit/);
});

test('dispatch worker preserves an outbox row for retry when Redis is unavailable',async()=>{
  let claimed=false;const writes=[];
  const database={
    transaction:async fn=>fn({query:async(sql,args=[])=>{
      writes.push([sql,args]);
      if(sql.includes('SELECT * FROM prn_dispatch_outbox')){if(claimed)return {rows:[]};claimed=true;return {rows:[{id:'out1',organization_id:'o1',job_id:'j1',event_type:'dispatch',attempts:0}]};}
      return {rows:[],rowCount:1};
    }}),
    query:async(sql,args=[])=>{writes.push([sql,args]);return {rows:[],rowCount:1};},
  };
  const worker=new PrinterlyDispatchWorker({database,queue:{enqueue:async()=>{throw new Error('redis down');}}});
  const result=await worker.drain({limit:1});
  assert.deepEqual(result,{processed:0,failed:1});
  const retry=writes.find(([sql,args])=>sql.includes('last_error')&&args?.[1]==='pending');
  assert.ok(retry,'failed dispatch must return to pending instead of disappearing');
});

test('service rejects unsafe construction without transactional database',()=>{
  assert.throws(()=>new PrinterlyRuntimeService({database:{}}),/database.transaction/);
  assert.ok(new PrinterlyRuntimeError('X','x') instanceof Error);
});