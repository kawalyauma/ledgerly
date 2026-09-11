import test from 'node:test';
import assert from 'node:assert/strict';
import { D1MigrationRunner } from '../src/migration/runner.mjs';
import communicationsPhase from '../src/migration/phases/communications.phase.mjs';
import { finalizeCommunicationsSchema } from '../src/migration/communications-schema.mjs';

test('communications phase finalizes privacy/tombstone compatibility after copy',()=>{
  assert.equal(communicationsPhase.finalizeSchema,finalizeCommunicationsSchema);
  assert.deepEqual(communicationsPhase.prerequisites,['auth-core','mobile-sync-core','contacts']);
  assert.deepEqual(communicationsPhase.tables.map((table)=>table.name),[
    'communication_message_types','communication_campaigns','communication_recipients',
    'communication_deliveries','communication_preferences','communication_provider_events',
  ]);
});

class ReplayDatabase{
  constructor(){this.run=null;this.finish=[];}
  async query(sql,values=[]){
    if(sql.includes('CREATE TABLE IF NOT EXISTS ledgerly_meta.migration_')||sql.includes('CREATE INDEX IF NOT EXISTS migration_validations_run_idx'))return{rows:[]};
    if(sql.includes('SELECT id FROM ledgerly_meta.migration_runs'))return{rows:this.run&&['running','failed','validation_failed'].includes(this.run.status)?[{id:this.run.id}]:[]};
    if(sql.includes('INSERT INTO ledgerly_meta.migration_runs')){this.run={id:values[0],status:'running'};return{rows:[]};}
    if(sql.includes('UPDATE ledgerly_meta.migration_runs SET status=')){this.run={...(this.run||{id:values[0]}),status:values[1]};this.finish.push(values[1]);return{rows:[]};}
    throw new Error(`Unexpected replay SQL: ${sql.slice(0,100)}`);
  }
}

test('migration run reuses failed run and safely replays an idempotent finalizer',async()=>{
  const database=new ReplayDatabase();
  const source={};
  let finalizerCalls=0;
  const phase={
    name:'replay-test',description:'replay',prerequisites:[],tables:[],relationshipChecks:[],
    async ensureSchema(){},
    async finalizeSchema(){finalizerCalls+=1;if(finalizerCalls===1)throw new Error('temporary finalize failure');},
  };
  const runner=new D1MigrationRunner({database,source,sourceIdentity:'d1:test',phase,logger:{info(){}}});
  await assert.rejects(()=>runner.run(),/temporary finalize failure/);
  const failedRunId=database.run.id;
  assert.equal(database.run.status,'failed');
  const result=await runner.run();
  assert.equal(result.runId,failedRunId);
  assert.equal(result.status,'completed');
  assert.equal(finalizerCalls,2);
  assert.deepEqual(database.finish,['failed','completed']);
});
