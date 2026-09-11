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
  async eval(script,{keys,arguments:args}){
    const tag=(script.match(/ledgerly:(\w+)/)||[])[1];
    const remove=(key,value)=>{const rows=this.lists.get(key)||[],i=rows.indexOf(value);if(i<0)return 0;rows.splice(i,1);this.lists.set(key,rows);return 1};
    if(tag==='enqueue'){const [marker,ready]=keys;if(this.strings.has(marker))return 0;this.strings.set(marker,args[0]);await this.lPush(ready,args[2]);return 1}
    if(tag==='promote'){const [delayed,ready]=keys,rows=await this.zRangeByScore(delayed,Number.NEGATIVE_INFINITY,Number(args[0]),{LIMIT:{offset:0,count:Number(args[1])}});for(const raw of rows){await this.zRem(delayed,raw);await this.lPush(ready,raw)}return rows.length}
    if(tag==='claim'){const ready=this.lists.get(keys[0])||[],raw=ready.pop();this.lists.set(keys[0],ready);if(raw==null)return false;const record=`v1:${args[1]}\n${raw}`;await this.lPush(keys[1],record);await this.zAdd(keys[2],[{score:Number(args[0]),value:record}]);return record}
    if(tag==='renew'){if(!(this.lists.get(keys[0])||[]).includes(args[0]))return 0;await this.zAdd(keys[1],[{score:Number(args[1]),value:args[0]}]);return 1}
    if(tag==='ack'){const n=remove(keys[0],args[0]);if(n)await this.zRem(keys[1],args[0]);return n}
    if(tag==='retry'){const n=remove(keys[0],args[0]);if(!n)return 0;await this.zRem(keys[1],args[0]);if(args[1]==='1')await this.zAdd(keys[2],[{score:Number(args[2]),value:args[3]}]);else await this.lPush(keys[3],args[3]);return 1}
    if(tag==='dead'){const n=remove(keys[0],args[0]);if(!n)return 0;await this.zRem(keys[1],args[0]);await this.lPush(keys[2],args[1]);return 1}
    if(tag==='recover'){const n=remove(keys[0],args[0]);if(!n)return 0;await this.zRem(keys[1],args[0]);await this.lPush(keys[2],args[1]);return 1}
    throw new Error(`unsupported fake Redis script: ${tag}`);
  }
  multi(){const ops=[];const m={lRem:(...a)=>(ops.push(()=>this.lRem(...a)),m),lPush:(...a)=>(ops.push(()=>this.lPush(...a)),m),zAdd:(...a)=>(ops.push(()=>this.zAdd(...a)),m),zRem:(...a)=>(ops.push(()=>this.zRem(...a)),m),exec:async()=>Promise.all(ops.map(f=>f()))};return m}
}

const job=(id='j1',attempt=0)=>({jobId:id,kind:'demo',organizationId:'o1',createdAt:new Date().toISOString(),attempt,idempotencyKey:null,payload:{}});

test('queue leases claims and recovers expired work',async()=>{const client=new FakeRedis(),q=new RedisQueue({client,name:'q',namespace:'t',visibilityTimeoutMs:1000});await q.enqueue(job());const claim=await q.take({now:1000});assert.equal(await q.processingSize(),1);assert.equal(await q.leasedSize(),1);let recovery=await q.recoverExpired({now:new Date(1500)});assert.equal(recovery.recovered,0);recovery=await q.recoverExpired({now:new Date(2001)});assert.equal(recovery.recovered,1);assert.equal(await q.processingSize(),0);assert.equal(await q.size(),1);const next=await q.take({now:3000});assert.equal(next.job.jobId,'j1');assert.equal(await q.ack(next.receipt),true);assert.equal(await q.leasedSize(),0);});

test('queue recovers orphaned processing entries from pre-lease crash window',async()=>{const client=new FakeRedis(),q=new RedisQueue({client,name:'q',namespace:'t',visibilityTimeoutMs:1000});const raw=JSON.stringify(job('orphan'));client.lists.set(q.keys.processing,[raw]);const result=await q.recoverExpired({now:new Date(),includeOrphans:true});assert.equal(result.orphans,1);assert.equal(result.recovered,1);assert.equal(await q.size(),1);});

test('worker acknowledges success and delays retry on handler failure',async()=>{const client=new FakeRedis(),q=new RedisQueue({client,name:'q',namespace:'t',maxAttempts:3,visibilityTimeoutMs:10000});let calls=0;await q.enqueue(job('ok'));const okWorker=new DurableJobWorker({queue:q,handlers:{demo:async()=>{calls++}},concurrency:1,retryBaseMs:1000});const ok=await okWorker.runOnce();assert.equal(ok.succeeded,1);assert.equal(calls,1);assert.equal(await q.processingSize(),0);await q.enqueue(job('retry'));const badWorker=new DurableJobWorker({queue:q,handlers:{demo:async()=>{throw new Error('boom')}},concurrency:1,retryBaseMs:60000});const failed=await badWorker.runOnce();assert.equal(failed.retried,1);assert.equal(await q.delayedSize(),1);assert.equal(await q.processingSize(),0);});

test('worker dead-letters unknown kinds',async()=>{const client=new FakeRedis(),q=new RedisQueue({client,name:'q',namespace:'t'});await q.enqueue({...job('u'),kind:'unknown'});const worker=new DurableJobWorker({queue:q,handlers:{},concurrency:1});const result=await worker.runOnce();assert.equal(result.deadLettered,1);assert.equal(await q.deadLetterSize(),1);});

test('recovery runner sweeps all managed queues',async()=>{const calls=[];const queues=new Set([{name:'a',recoverExpired:async()=>{calls.push('a');return{recovered:2}}},{name:'b',recoverExpired:async()=>{calls.push('b');return{recovered:1}}}]);const runner=new QueueRecoveryRunner({queues,intervalMs:1000,batchSize:10,logger:{error(){}}});const result=await runner.runOnce(new Date('2026-01-01T00:00:00Z'));assert.deepEqual(calls,['a','b']);assert.equal(result.recovered,3);assert.equal(runner.status().lastRecovered,3);});

test('stale receipt cannot acknowledge a recovered and re-claimed job',async()=>{const client=new FakeRedis(),q=new RedisQueue({client,name:'q',namespace:'t',visibilityTimeoutMs:1000});await q.enqueue(job('aba'));const first=await q.take({now:0});await q.recoverExpired({now:new Date(1001)});const second=await q.take({now:2000});assert.notEqual(first.receipt,second.receipt);assert.equal(await q.ack(first.receipt),false);assert.equal(await q.processingSize(),1);assert.equal(await q.ack(second.receipt),true);});

test('stale retry cannot duplicate a recovered claim',async()=>{const client=new FakeRedis(),q=new RedisQueue({client,name:'q',namespace:'t',visibilityTimeoutMs:1000});await q.enqueue(job('race'));const first=await q.take({now:0});await q.recoverExpired({now:new Date(1001)});const second=await q.take({now:2000});const outcome=await q.retry(first.receipt);assert.equal(outcome.lost,true);assert.equal(await q.size(),0);assert.equal(await q.processingSize(),1);assert.equal(await q.ack(second.receipt),true);});

test('legacy processing records are recoverable during rolling upgrade',async()=>{const client=new FakeRedis(),q=new RedisQueue({client,name:'q',namespace:'t'}),raw=JSON.stringify(job('legacy'));client.lists.set(q.keys.processing,[raw]);const result=await q.recoverExpired({now:new Date(),includeOrphans:true});assert.equal(result.recovered,1);const claim=await q.take();assert.equal(claim.job.jobId,'legacy');});
