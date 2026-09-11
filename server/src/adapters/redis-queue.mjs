import { createHash, randomUUID } from "node:crypto";

const ENQUEUE_IDEMPOTENT_SCRIPT = `-- ledgerly:enqueue
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
redis.call('LPUSH', KEYS[2], ARGV[3])
return 1`;
const PROMOTE_DUE_SCRIPT = `-- ledgerly:promote
local rows=redis.call('ZRANGEBYSCORE',KEYS[1],'-inf',ARGV[1],'LIMIT',0,ARGV[2]);local moved=0
for _,raw in ipairs(rows) do if redis.call('ZREM',KEYS[1],raw)==1 then redis.call('LPUSH',KEYS[2],raw);moved=moved+1 end end
return moved`;
const CLAIM_SCRIPT = `-- ledgerly:claim
local raw=redis.call('RPOP',KEYS[1]);if not raw then return false end
local record='v1:'..ARGV[2]..':'..raw
redis.call('LPUSH',KEYS[2],record);redis.call('ZADD',KEYS[3],ARGV[1],record);return record`;
const RENEW_SCRIPT = `-- ledgerly:renew
if not redis.call('LPOS',KEYS[1],ARGV[1]) then return 0 end
redis.call('ZADD',KEYS[2],ARGV[2],ARGV[1]);return 1`;
const ACK_SCRIPT = `-- ledgerly:ack
local removed=redis.call('LREM',KEYS[1],1,ARGV[1]);if removed==1 then redis.call('ZREM',KEYS[2],ARGV[1]) end;return removed`;
const RETRY_SCRIPT = `-- ledgerly:retry
local removed=redis.call('LREM',KEYS[1],1,ARGV[1]);if removed~=1 then return 0 end
redis.call('ZREM',KEYS[2],ARGV[1]);if ARGV[2]=='1' then redis.call('ZADD',KEYS[3],ARGV[3],ARGV[4]) else redis.call('LPUSH',KEYS[4],ARGV[4]) end;return 1`;
const DEAD_SCRIPT = `-- ledgerly:dead
local removed=redis.call('LREM',KEYS[1],1,ARGV[1]);if removed~=1 then return 0 end
redis.call('ZREM',KEYS[2],ARGV[1]);redis.call('LPUSH',KEYS[3],ARGV[2]);return 1`;
const RECOVER_SCRIPT = `-- ledgerly:recover
local removed=redis.call('LREM',KEYS[1],1,ARGV[1]);if removed~=1 then return 0 end
redis.call('ZREM',KEYS[2],ARGV[1]);redis.call('LPUSH',KEYS[3],ARGV[2]);return 1`;

function requireJob(job){if(!job||typeof job!=="object"||typeof job.jobId!=="string"||!job.jobId.trim())throw new TypeError("queue expects a Ledgerly job envelope");return job;}
function encodeReceipt(record){return Buffer.from(record,"utf8").toString("base64url");}
function decodeReceipt(receipt){if(typeof receipt!=="string"||!receipt)throw new TypeError("receipt is required");return Buffer.from(receipt,"base64url").toString("utf8");}
function unpackRecord(record){if(record.startsWith("v1:")){const colon=record.indexOf(":",3),newline=record.indexOf("\n",3),split=newline>3&&(colon<0||newline<colon)?newline:colon;if(split>3)return{record,raw:record.slice(split+1),legacy:false};}return{record,raw:record,legacy:true};}
function dateScore(value,name){if(value==null)return null;const score=(value instanceof Date?value:new Date(value)).getTime();if(!Number.isFinite(score))throw new TypeError(`${name} must be a valid date`);return score;}
function bounded(value,fallback,max=1000){return Math.max(1,Math.min(Number(value)||fallback,max));}

export class RedisQueue{
 constructor({client,name="default",namespace="ledgerly:jobs",maxAttempts=5,idempotencyTtlSeconds=604800,visibilityTimeoutMs=300000}){if(!client)throw new TypeError("RedisQueue requires a Redis client");if(!Number.isInteger(maxAttempts)||maxAttempts<1)throw new TypeError("maxAttempts must be positive");if(!Number.isInteger(idempotencyTtlSeconds)||idempotencyTtlSeconds<60)throw new TypeError("idempotencyTtlSeconds must be at least 60");if(!Number.isInteger(visibilityTimeoutMs)||visibilityTimeoutMs<1000)throw new TypeError("visibilityTimeoutMs must be at least 1000");Object.assign(this,{provider:"redis-durable-list",client,name,namespace,maxAttempts,idempotencyTtlSeconds,visibilityTimeoutMs});this.keys=Object.freeze({ready:`${namespace}:${name}:ready`,processing:`${namespace}:${name}:processing`,leases:`${namespace}:${name}:leases`,delayed:`${namespace}:${name}:delayed`,dead:`${namespace}:${name}:dead`});}
 #idempotencyKey(value){return`${this.namespace}:${this.name}:idempotency:${createHash("sha256").update(value).digest("hex")}`;}
 #leaseScore(now=Date.now(),timeoutMs=this.visibilityTimeoutMs){if(!Number.isInteger(timeoutMs)||timeoutMs<1000)throw new TypeError("visibility timeout must be at least 1000");return Number(now)+timeoutMs;}
 async enqueue(job){const valid=requireJob(job),raw=JSON.stringify(valid);if(valid.idempotencyKey){const inserted=await this.client.eval(ENQUEUE_IDEMPOTENT_SCRIPT,{keys:[this.#idempotencyKey(String(valid.idempotencyKey)),this.keys.ready],arguments:[valid.jobId,String(this.idempotencyTtlSeconds),raw]});return{jobId:valid.jobId,queued:Number(inserted)===1,duplicate:Number(inserted)!==1};}await this.client.lPush(this.keys.ready,raw);return{jobId:valid.jobId,queued:true,duplicate:false};}
 async promoteDue({now=new Date(),limit=100}={}){const score=dateScore(now,"now");return Number(await this.client.eval(PROMOTE_DUE_SCRIPT,{keys:[this.keys.delayed,this.keys.ready],arguments:[String(score),String(bounded(limit,100))]}))||0;}
 async take({now=Date.now()}={}){await this.promoteDue({now:new Date(Number(now))});const deadline=this.#leaseScore(now),record=await this.client.eval(CLAIM_SCRIPT,{keys:[this.keys.ready,this.keys.processing,this.keys.leases],arguments:[String(deadline),randomUUID()]});if(!record)return null;const unpacked=unpackRecord(String(record));return{job:JSON.parse(unpacked.raw),receipt:encodeReceipt(unpacked.record)};}
 async renew(receipt,{now=Date.now(),visibilityTimeoutMs=this.visibilityTimeoutMs}={}){const record=decodeReceipt(receipt),score=this.#leaseScore(now,visibilityTimeoutMs),renewed=Number(await this.client.eval(RENEW_SCRIPT,{keys:[this.keys.processing,this.keys.leases],arguments:[record,String(score)]}))===1;return{renewed,supported:true,visibleAfter:renewed?new Date(score).toISOString():null};}
 async ack(receipt){const record=decodeReceipt(receipt);return Number(await this.client.eval(ACK_SCRIPT,{keys:[this.keys.processing,this.keys.leases],arguments:[record]}))===1;}
 async retry(receipt,{reason=null,delayUntil=null}={}){const record=decodeReceipt(receipt),{raw}=unpackRecord(record),job=JSON.parse(raw),next={...job,attempt:Number(job.attempt??0)+1};if(next.attempt>=this.maxAttempts)return this.deadLetter(receipt,{reason:reason??"max_attempts_reached"});const nextRaw=JSON.stringify(next),score=dateScore(delayUntil,"delayUntil"),shouldDelay=score!=null&&score>Date.now();const moved=Number(await this.client.eval(RETRY_SCRIPT,{keys:[this.keys.processing,this.keys.leases,this.keys.delayed,this.keys.ready],arguments:[record,shouldDelay?"1":"0",String(score??0),nextRaw]}))===1;if(!moved)return{jobId:next.jobId,retried:false,lost:true,attempt:next.attempt,reason};return{jobId:next.jobId,retried:true,attempt:next.attempt,delayed:shouldDelay,availableAt:shouldDelay?new Date(score).toISOString():null,reason};}
 async deadLetter(receipt,{reason="failed"}={}){const record=decodeReceipt(receipt),{raw}=unpackRecord(record),job=JSON.parse(raw),dead=JSON.stringify({job,reason,failedAt:new Date().toISOString()}),moved=Number(await this.client.eval(DEAD_SCRIPT,{keys:[this.keys.processing,this.keys.leases,this.keys.dead],arguments:[record,dead]}))===1;return moved?{jobId:job.jobId,deadLettered:true}:{jobId:job.jobId,deadLettered:false,lost:true};}
 async recoverExpired({now=new Date(),limit=100,includeOrphans=true}={}){const score=dateScore(now,"now"),cap=bounded(limit,100),expired=await this.client.zRangeByScore(this.keys.leases,0,score,{LIMIT:{offset:0,count:cap}}),candidates=[...expired];let orphans=0;if(includeOrphans&&candidates.length<cap){const rows=await this.client.lRange(this.keys.processing,0,Math.max(0,cap-candidates.length-1));for(const record of rows){if(candidates.includes(record))continue;if(await this.client.zScore(this.keys.leases,record)==null){candidates.push(record);orphans++;if(candidates.length>=cap)break;}}}let recovered=0;for(const record of candidates){const {raw}=unpackRecord(String(record)),moved=Number(await this.client.eval(RECOVER_SCRIPT,{keys:[this.keys.processing,this.keys.leases,this.keys.ready],arguments:[String(record),raw]}))===1;if(moved)recovered++;}return{supported:true,recovered,expired:expired.length,orphans};}
 async size(){return this.client.lLen(this.keys.ready)}async processingSize(){return this.client.lLen(this.keys.processing)}async delayedSize(){return this.client.zCard(this.keys.delayed)}async leasedSize(){return this.client.zCard(this.keys.leases)}async deadLetterSize(){return this.client.lLen(this.keys.dead)}
 async health(){try{const[queued,processing,delayed,leased,dead]=await Promise.all([this.size(),this.processingSize(),this.delayedSize(),this.leasedSize(),this.deadLetterSize()]);return{ok:true,provider:this.provider,name:this.name,queued,processing,delayed,leased,dead,visibilityTimeoutMs:this.visibilityTimeoutMs,recoverySupported:true,claimReceipts:"unique-v1"};}catch(error){return{ok:false,provider:this.provider,name:this.name,error:error instanceof Error?error.message:String(error)}}}
}
