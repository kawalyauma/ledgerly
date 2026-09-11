import test from 'node:test';
import assert from 'node:assert/strict';
import { projectMobilePayload } from '../src/mobile-sync/privacy.mjs';
import { CommunicationsService } from '../src/communications/service.mjs';
import { CommunicationsWorker } from '../src/communications/worker.mjs';
import { PostgresCommunicationsRepository } from '../src/communications/repository.mjs';
import { ensureCommunicationsSchema, finalizeCommunicationsSchema } from '../src/migration/communications-schema.mjs';
import { canAccessCommunications } from '../src/mobile-sync/communications-auth.mjs';
import { createCollection as createDraftCollection } from '../src/mobile-sync/collections/communications-campaign-drafts.collection.mjs';

test('communications privacy uses explicit camelCase allowlists',()=>{
 const recipient=projectMobilePayload('communications','recipients',{id:'r',campaignId:'c',recipientName:'Ada',phone:'+256',data:{secret:1},data_json:'secret',providerMessageId:'x'});
 assert.deepEqual(recipient,{id:'r',campaignId:'c',recipientName:'Ada',phone:'+256'});
 const delivery=projectMobilePayload('communications','deliveries',{id:'d',campaignId:'c',provider:'egosms',status:'sent',providerMessageId:'raw',lastError:'oops',templateVariables:{secret:1},renderedMessage:'ok'});
 assert.deepEqual(delivery,{id:'d',campaignId:'c',provider:'egosms',renderedMessage:'ok',status:'sent'});
});

test('repository only selects retries whose next attempt is due',async()=>{
 const seen=[];const db={query:async(sql,values)=>{seen.push({sql,values});return{rows:[]}}};
 const repo=new PostgresCommunicationsRepository({database:db});
 await repo.listSendableDeliveryIds('o','c');await repo.claimDelivery('o','d');
 assert.match(seen[0].sql,/next_attempt_at<=now\(\)/);assert.match(seen[1].sql,/next_attempt_at<=now\(\)/);
});

test('service exposes retry timestamp and skips premature retry',async()=>{
 let sent=0;const future=new Date(Date.now()+60000).toISOString();
 const repo={getDeliveryState:async()=>({id:'d',status:'failed',campaign_id:'c',next_attempt_at:future}),setCampaignState:async()=>assert.fail('not due'),claimDelivery:async()=>assert.fail('not due')};
 const service=new CommunicationsService({repository:repo,queue:{},notifications:{send:async()=>{sent++}},audit:{write:async()=>{}},batchSize:1});
 const result=await service.processDelivery({organizationId:'o',deliveryId:'d'});assert.equal(result.reason,'retry_not_due');assert.equal(result.retryAt,future);assert.equal(sent,0);
});

test('provider failure carries delayed retry timestamp',async()=>{
 const delivery={id:'d',status:'queued',campaign_id:'c',recipient_snapshot_id:'r',channel:'sms',recipient_phone:'+256',provider:'egosms',rendered_subject:'',rendered_message:'x',template_variables_json:'{}',attempts:1};
 let failed;
 const repo={getDeliveryState:async()=>delivery,setCampaignState:async()=>({}),claimDelivery:async()=>({...delivery,status:'sending'}),getRecipient:async()=>({id:'r',recipient_type:'contact',recipient_id:'p',recipient_name:'Ada',phone:'+256'}),getPreference:async()=>null,markDeliveryFailed:async(_o,_id,x)=>{failed=x},refreshCampaignProgress:async()=>({})};
 const service=new CommunicationsService({repository:repo,queue:{},notifications:{send:async()=>{throw new Error('down')}},audit:{write:async()=>{}},batchSize:1});
 let caught;try{await service.processDelivery({organizationId:'o',deliveryId:'d'});}catch(e){caught=e}
 assert.match(caught.message,/down/);assert.ok(caught.retryAt);assert.equal(failed.nextAttemptAt.toISOString(),caught.retryAt);
});

test('worker delays retry and dead-letters every unprocessed member when batch exhausts',async()=>{
 const delays=[],dead=[];let retryCount=0;
 const queue={take:async()=>({job:{jobId:'j',kind:'communications.delivery-batch',organizationId:'o',payload:{deliveryIds:['d1','d2','d3']}},receipt:'r'}),retry:async(_r,opts)=>{delays.push(opts.delayUntil);retryCount++;return{deadLettered:true}},ack:async()=>assert.fail('no ack')};
 const service={processDelivery:async({deliveryId})=>{const e=new Error(`down:${deliveryId}`);e.retryAt='2026-09-11T12:00:00.000Z';throw e;},deadLetterDelivery:async({deliveryId})=>dead.push(deliveryId)};
 const result=await new CommunicationsWorker({queue,service}).runOnce();assert.equal(result.deadLettered,true);assert.equal(retryCount,1);assert.equal(delays[0],'2026-09-11T12:00:00.000Z');assert.deepEqual(dead,['d1','d2','d3']);
});

test('communications schema installs safe change-feed triggers and idempotent privacy finalizer',async()=>{
 const sql=[];const db={query:async(text)=>{sql.push(text);return{rows:[]}},transaction:async(fn)=>fn({query:async(text)=>{sql.push(text);return{rows:[]}}})};
 await ensureCommunicationsSchema(db);await finalizeCommunicationsSchema(db);
 assert.match(sql[0],/ledgerly_emit_communication_sync/);assert.match(sql[0],/communication_sync_deliveries_update/);assert.doesNotMatch(sql[0],/'providerMessageId'/);assert.doesNotMatch(sql[0],/'lastError'/);
 assert.match(sql[1],/400 days/);assert.match(sql[1],/mobile_sync_tombstones/);assert.match(sql[1],/jsonb_strip_nulls/);
});

test('communications access honors core scopes and fails closed without school tables',async()=>{
 const db={query:async(sql)=>{if(sql.includes('FROM memberships'))return{rows:[{role:'staff',scopes:'["communications:read"]'}],rowCount:1};throw Object.assign(new Error('missing'),{code:'42P01'});}};
 assert.equal(await canAccessCommunications(db,{organizationId:'o',userId:'u',level:'read'}),true);
 assert.equal(await canAccessCommunications(db,{organizationId:'o',userId:'u',level:'send'}),false);
});

test('offline campaign draft collection is append-only and inserts a server draft',async()=>{
 const services={database:{query:async()=>({rows:[]})}};const def=await createDraftCollection({services});
 const queries=[];const tx={query:async(sql,values)=>{queries.push({sql,values});if(sql.includes('FROM memberships'))return{rows:[{role:'owner',scopes:'[]'}],rowCount:1};if(sql.includes('FROM communication_campaigns'))return{rows:[],rowCount:0};if(sql.includes('FROM communication_message_types'))return{rows:[{id:'t1',type_key:'general',module_key:'platform',name:'General',audience_kind:'contacts',audience_defaults_json:'{}',subject_template:'Subject',message_template:'Message'}],rowCount:1};if(sql.includes('FROM organizations'))return{rows:[{name:'School'}],rowCount:1};if(sql.startsWith('INSERT INTO communication_campaigns'))return{rows:[],rowCount:1};throw new Error(sql)}};
 const operation={kind:'upsert',recordId:'draft_12345678',clientTimestamp:'2026-09-11T09:00:00.000Z',payload:{typeKey:'general',channels:['sms'],audience:{kind:'contacts'}}};
 const result=await def.apply({transaction:tx,organizationId:'o',userId:'u',operation});assert.equal(result.result.status,'draft');assert.equal(queries.some(x=>x.sql.startsWith('INSERT INTO communication_campaigns')),true);
 await assert.rejects(()=>def.apply({transaction:tx,organizationId:'o',userId:'u',operation:{...operation,kind:'delete'}}),/cannot be deleted/);
});
