import assert from 'node:assert/strict';
import test from 'node:test';
import {PrinterlyQueueWorker} from '../src/printerly/queue-worker.mjs';
import {PRINTERLY_SCHEDULE_DEFINITIONS,PrinterlyScheduleRegistry} from '../src/printerly/schedule-registry.mjs';

function queue(items,{deadOnRetry=false}={}){const pending=[...items],calls=[];return{calls,async take(){return pending.shift()||null},async ack(receipt){calls.push(['ack',receipt])},async retry(receipt,{reason}){calls.push(['retry',receipt,reason]);return deadOnRetry?{deadLettered:true}:{retried:true}},async deadLetter(receipt,{reason}){calls.push(['dead',receipt,reason]);return{deadLettered:true}}};}

test('Printerly scheduler mirrors Cloudflare 5-minute and hourly cadences',()=>{const by=Object.fromEntries(PRINTERLY_SCHEDULE_DEFINITIONS.map(([name,kind,cron])=>[kind,{name,cron}]));for(const kind of ['printerly.health','printerly.batch-dispatch','printerly.batch-status','printerly.retention','printerly.consumables','printerly.service-sla','printerly.routing'])assert.equal(by[kind].cron,'*/5 * * * *');for(const kind of ['printerly.release-cleanup','printerly.procurement'])assert.equal(by[kind].cron,'0 * * * *');});

test('Printerly scheduler registers only authoritative kinds and cancels stale owned schedules',async()=>{
  const calls=[];
  const database={query:async()=>({rows:[{organization_id:'o1'}]})};
  const scheduler={
    async list(){return[
      {id:'printerly:o1:health',enabled:true,organization_id:'o1',kind:'printerly.health',cron_expression:'*/5 * * * *',timezone:'UTC'},
      {id:'printerly:o1:retention',enabled:true,organization_id:'o1',kind:'printerly.retention',cron_expression:'*/5 * * * *',timezone:'UTC'},
    ];},
    async register(value){calls.push(['register',value]);},
    async cancel(id){calls.push(['cancel',id]);},
  };
  const registry=new PrinterlyScheduleRegistry({database,scheduler});
  const result=await registry.reconcile({enabled:true,enabledKinds:['printerly.retention']});
  assert.equal(result.schedules,1);
  assert.deepEqual(result.kinds,['printerly.retention']);
  assert.ok(calls.some(([kind,id])=>kind==='cancel'&&id==='printerly:o1:health'));
  assert.equal(calls.some(([kind,value])=>kind==='register'&&value.kind==='printerly.health'),false);
});

test('Printerly queue worker acks successful scheduled and outbox jobs',async()=>{const q=queue([{job:{jobId:'1',kind:'printerly.health',organizationId:'o1'},receipt:'r1'},{job:{jobId:'2',type:'printerly.dispatch'},receipt:'r2'}]);let ran=0;const worker=new PrinterlyQueueWorker({queue:q,handlers:{'printerly.health':async()=>{ran++;}}});const result=await worker.runOnce();assert.equal(ran,1);assert.equal(result.acked,2);assert.deepEqual(q.calls,[['ack','r1'],['ack','r2']]);});

test('Printerly queue worker retries failures and dead-letters unknown jobs',async()=>{const q=queue([{job:{jobId:'1',kind:'printerly.health'},receipt:'r1'},{job:{jobId:'2',kind:'printerly.unknown'},receipt:'r2'}]);const worker=new PrinterlyQueueWorker({queue:q,handlers:{'printerly.health':async()=>{throw new Error('boom')}} ,logger:{error(){}}});const result=await worker.runOnce();assert.equal(result.retried,1);assert.equal(result.dead,1);assert.equal(q.calls[0][0],'retry');assert.equal(q.calls[1][0],'dead');});

test('Printerly queue worker reports retry that reaches queue max attempts as dead',async()=>{const q=queue([{job:{jobId:'1',kind:'printerly.health'},receipt:'r1'}],{deadOnRetry:true});const worker=new PrinterlyQueueWorker({queue:q,handlers:{'printerly.health':async()=>{throw new Error('boom')}},logger:{error(){}}});const result=await worker.runOnce();assert.equal(result.retried,0);assert.equal(result.dead,1);});
