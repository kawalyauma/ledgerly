import test from 'node:test';
import assert from 'node:assert/strict';
import { ContactsService } from '../src/contacts/service.mjs';
import { HumanResourcesService } from '../src/human-resources/service.mjs';
import contactsCollection from '../src/mobile-sync/collections/contacts.collection.mjs';
import { createCollection as createHrLeaveCollection } from '../src/mobile-sync/collections/hr-leave-requests.collection.mjs';

test('contacts preserves stable client-generated id and actor in audit', async()=>{
  let createArgs; let auditEvent;
  const repository={async create(args){createArgs=args;return{id:args.contact.id,organization_id:args.organizationId,name:args.contact.name};}};
  const service=new ContactsService({repository,audit:{async write(e){auditEvent=e;}}});
  const row=await service.create({organizationId:'org_a',actor:{actorType:'human',actorId:'usr_1'},contact:{id:'contact_client_1',type:'customer',name:'A'}});
  assert.equal(row.id,'contact_client_1'); assert.equal(createArgs.organizationId,'org_a'); assert.equal(createArgs.changedBy,'usr_1'); assert.equal(auditEvent.entityId,'contact_client_1');
});

test('contacts mobile collection is readable only after core tenant/device scoping and privacy remains external projector responsibility', async()=>{
  assert.equal(contactsCollection.moduleKey,'contacts'); assert.equal(contactsCollection.collectionKey,'contacts'); assert.equal(await contactsCollection.canRead({organizationId:'org_a'}),true);
});

test('HR leave request preserves tenant and actor and emits audit', async()=>{
  let args; const events=[];
  const service=new HumanResourcesService({repository:{async createLeave(v){args=v;return{id:v.id,status:'pending',organization_id:v.organizationId};}},audit:{async write(e){events.push(e);}}});
  const row=await service.requestLeave({organizationId:'org_a',actor:{actorType:'human',actorId:'usr_1'},id:'leave_client_1',employeeId:'emp_1',leaveTypeId:'annual',startsOn:'2026-09-15',endsOn:'2026-09-16',daysMicros:2000000});
  assert.equal(row.id,'leave_client_1'); assert.equal(args.organizationId,'org_a'); assert.equal(args.requestedBy,'usr_1'); assert.equal(events[0].action,'hr.leave.request');
});

test('HR review accepts only approved/rejected and records reviewer', async()=>{
  let args; const service=new HumanResourcesService({repository:{async reviewLeave(v){args=v;return{before:{status:'pending'},after:{id:v.id,status:v.status}};}}});
  const row=await service.reviewLeave({organizationId:'org_a',actor:{actorType:'human',actorId:'admin_1'},id:'leave_1',decision:'approved',notes:'ok'});
  assert.equal(row.status,'approved'); assert.equal(args.reviewedBy,'admin_1');
  await assert.rejects(service.reviewLeave({organizationId:'org_a',actor:{actorId:'admin_1'},id:'leave_2',decision:'paid'}),/approved or rejected/);
});

test('HR mobile leave visibility is fail-closed to linked user/reviewer/requester', async()=>{
  let params;
  const collection=await createHrLeaveCollection({services:{database:{async query(_sql,p){params=p;return{rowCount:p[2]==='allowed_user'?1:0,rows:[]};}}}});
  assert.equal(await collection.canRead({organizationId:'org_a',userId:'allowed_user',recordId:'leave_1'}),true);
  assert.equal(await collection.canRead({organizationId:'org_a',userId:'other_user',recordId:'leave_1'}),false);
  assert.deepEqual(params,['org_a','leave_1','other_user']);
});

test('HR mobile intent service delegates stable intent id without rewriting identity', async()=>{
  let input; const service=new HumanResourcesService({repository:{async submitMobileLeaveIntent(v){input=v;return{id:v.intent.id,status:'pending'};}}});
  const result=await service.submitMobileLeaveIntent({organizationId:'org_a',userId:'usr_1',deviceId:'dev_1',intent:{id:'intent_client_1',employeeId:'emp_1'}});
  assert.equal(result.id,'intent_client_1'); assert.equal(input.organizationId,'org_a'); assert.equal(input.userId,'usr_1');
});

test('HR failed mobile intent commits retry metadata before surfacing the error', async()=>{
  const { PostgresHumanResourcesRepository } = await import('../src/human-resources/repository.mjs');
  let retryPersisted=false; let committed=false;
  const intent={id:'intent_1',organization_id:'org_a',status:'pending',leave_type_id:'missing',employee_id:'emp_1',requested_by:'usr_1'};
  const database={
    async query(){ throw new Error('outside query not expected'); },
    async transaction(work){
      const tx={async query(sql){
        if(sql.includes('FROM hr_mobile_leave_intents')) return {rows:[intent]};
        if(sql.includes('FROM hr_leave_types')) return {rows:[]};
        if(sql.includes("SET status='pending'")){ retryPersisted=true; return {rows:[],rowCount:1}; }
        throw new Error(`unexpected sql: ${sql}`);
      }};
      const result=await work(tx); committed=true; return result;
    },
  };
  const repo=new PostgresHumanResourcesRepository({database});
  await assert.rejects(repo.processMobileLeaveIntent({organizationId:'org_a',intentId:'intent_1'}),(error)=>error.code==='HR_LEAVE_TYPE_NOT_FOUND'&&error.status===404);
  assert.equal(committed,true); assert.equal(retryPersisted,true);
});
