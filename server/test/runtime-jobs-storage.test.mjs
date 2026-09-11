import test from 'node:test';
import assert from 'node:assert/strict';
import {RedisQueue} from '../src/adapters/redis-queue.mjs';
import {DurableJobWorker} from '../src/jobs/durable-job-worker.mjs';
import {QueueRecoveryRunner} from '../src/jobs/queue-recovery-runner.mjs';

class FakeRedis {
  constructor(){this.strings=new Map();this.lists=new Map();this.zsets=new Map();}
  async lPush(k,v){const a=this.lists.get(k)||[];a.unshift(v);this.lists.set(k,a);return a.length}
  async rPopLPush(s,d){const a=this.lists.get(s)||[],v=a.pop();this.lists.set(s,a);if(v==null)return null;const b=this.lists.get(d)||[];b.unshift(v);this.lists.set(d,b);return v}
  async lRem(k,_c,v){const a=this.lists.get(k)||[],i=a.indexOf(v);if(i<0)return 0;a.splice(i,1);this.lists.set(k,a);return 1}
  async lLen(k){return(this.lists.get(k)||[]).length}
  async lRange(k,start,end){const a=this.lists.get(k)||[];return a.slice(start,end+1)}
  async zAdd(k,items){const m=this.zsets.get(k)||new Map();let added=0;for(const item of items){if(!m.has(item.value))added++;m.set(item.value,item.score)}this.zsets.set(k,m);return added}
  async zCard(k){return(this.zsets.get(k)||new Map()).size}
  async zRem(k,v){const m=this.zsets.get(k)||new Map(),ok=m.delete(v);this.zsets.set(k,m);return ok?1:0}
  async zScore(k,v){return(this.zsets.get(k)||new Map()).get(v)??null}
  async zRangeByScore(k,min,max,{LIMIT}={}){const m=this.zsets.get(k)||new Map();let rows=[...m.entries()].filter(([,s])=>s>=Number(min)&&s<=Number(max)).sort((a,b)=>a[1]-b[1]).map(([v])=>v);if(LIMIT)rows=rows.slice(LIMIT.offset,LIMIT.offset+LIMIT.count);return rows}
  async eval(script,{keys,arguments:args}){if(script.includes('ZRANGEBYSCORE')){const [delayed,ready]=keys,now=Number(args[0]),limit=Number(args[1]),rows=await this.zRangeByScore(delayed,Number.NEGATIVE_INFINITY,now,{LIMIT:{offset:0,count:limit}});for(const raw of rows){await this.zRem(delayed,raw);await this.lPush(ready,raw)}return rows.length}const [marker,ready]=keys;if(this.strings.has(marker))return 0;this.strings.set(marker,args[0]);await this.lPush(ready,args[2]);return 1}
  multi(){const ops=[];const m={lRem:(...a)=>(ops.push(()=>this.lRem(...a)),m),lPush:(...a)=>(ops.push(()=>this.lPush(...a)),m),zAdd:(...a)=>(ops.push(()=>this.zAdd(...a)),m),zRem:(...a)=>(ops.push(()=>this.zRem(...a)),m),exec:async()=>Promise.all(ops.map(f=>f()))};return m}
}

const job=(id='j1',attempt=0)=>({jobId:id,kind:'demo',organizationId:'o1',createdAt:new Date().toISOString(),attempt,idempotencyKey:null,payload:{}});

test('queue leases claims and recovers expired work',async()=>{const client=new FakeRedis(),q=new RedisQueue({client,name:'q',namespace:'t',visibilityTimeoutMs:1000});await q.enqueue(job());const claim=await q.take({now:1000});assert.equal(await q.processingSize(),1);assert.equal(await q.leasedSize(),1);let recovery=await q.recoverExpired({now:new Date(1500)});assert.equal(recovery.recovered,0);recovery=await q.recoverExpired({now:new Date(2001)});assert.equal(recovery.recovered,1);assert.equal(await q.processingSize(),0);assert.equal(await q.size(),1);const next=await q.take({now:3000});assert.equal(next.job.jobId,'j1');assert.equal(await q.ack(next.receipt),true);assert.equal(await q.leasedSize(),0);});

test('queue recovers orphaned processing entries from pre-lease crash window',async()=>{const client=new FakeRedis(),q=new RedisQueue({client,name:'q',namespace:'t',visibilityTimeoutMs:1000});const raw=JSON.stringify(job('orphan'));client.lists.set(q.keys.processing,[raw]);const result=await q.recoverExpired({now:new Date(),includeOrphans:true});assert.equal(result.orphans,1);assert.equal(result.recovered,1);assert.equal(await q.size(),1);});

test('worker acknowledges success and delays retry on handler failure',async()=>{const client=new FakeRedis(),q=new RedisQueue({client,name:'q',namespace:'t',maxAttempts:3,visibilityTimeoutMs:10000});let calls=0;await q.enqueue(job('ok'));const okWorker=new DurableJobWorker({queue:q,handlers:{demo:async()=>{calls++}},concurrency:1,retryBaseMs:1000});const ok=await okWorker.runOnce();assert.equal(ok.succeeded,1);assert.equal(calls,1);assert.equal(await q.processingSize(),0);await q.enqueue(job('retry'));const badWorker=new DurableJobWorker({queue:q,handlers:{demo:async()=>{throw new Error('boom')}},concurrency:1,retryBaseMs:60000});const failed=await badWorker.runOnce();assert.equal(failed.retried,1);assert.equal(await q.delayedSize(),1);assert.equal(await q.processingSize(),0);});

test('worker dead-letters unknown kinds',async()=>{const client=new FakeRedis(),q=new RedisQueue({client,name:'q',namespace:'t'});await q.enqueue({...job('u'),kind:'unknown'});const worker=new DurableJobWorker({queue:q,handlers:{},concurrency:1});const result=await worker.runOnce();assert.equal(result.deadLettered,1);assert.equal(await q.deadLetterSize(),1);});

test('recovery runner sweeps all managed queues',async()=>{const calls=[];const queues=new Set([{name:'a',recoverExpired:async()=>{calls.push('a');return{recovered:2}}},{name:'b',recoverExpired:async()=>{calls.push('b');return{recovered:1}}}]);const runner=new QueueRecoveryRunner({queues,intervalMs:1000,batchSize:10,logger:{error(){}}});const result=await runner.runOnce(new Date('2026-01-01T00:00:00Z'));assert.deepEqual(calls,['a','b']);assert.equal(result.recovered,3);assert.equal(runner.status().lastRecovered,3);});
