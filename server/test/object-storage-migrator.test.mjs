import assert from 'node:assert/strict';
import test from 'node:test';
import {defaultTargetKey,ObjectStorageMigrator} from '../src/migration/object-storage-migrator.mjs';

function memoryStorage(objects={}){
  const data=new Map(Object.entries(objects).map(([k,v])=>[k,{bytes:Buffer.from(v),metadata:{}}]));
  return{
    async list(prefix=''){return[...data.keys()].filter(k=>k.startsWith(prefix)).sort()},
    async head(k){const v=data.get(k);return v?{key:k,size:v.bytes.length,etag:`e-${v.bytes.length}`,metadata:v.metadata}:null},
    async get(k){return data.get(k)?.bytes??null},
    async put(k,v,meta={}){data.set(k,{bytes:Buffer.from(v),metadata:{sha256:meta.custom?.sha256}});return{key:k,size:v.length}},
  };
}
function memoryDatabase(){
  const rows=new Map();
  return{rows,async query(sql,args=[]){
    if(sql.startsWith('SELECT status,organization_id'))return{rows:rows.has(args[2])?[rows.get(args[2])]:[]};
    if(sql.startsWith('SELECT organization_id,target_key'))return{rows:rows.has(args[2])?[rows.get(args[2])]:[]};
    if(sql.startsWith('INSERT INTO ledgerly_meta.object_migration_state')){rows.set(args[2],{status:sql.includes("'verified'")?'verified':'failed',organization_id:args[3]??null,target_key:args[4]??null,source_size:args[5]??0,source_etag:args[6]??null,sha256:args[7]??null});return{rows:[]};}
    return{rows:[]};
  }};
}

test('object migration writes into canonical tenant namespace and verifies it',async()=>{
  const database=memoryDatabase(),source=memoryStorage({'legacy/receipt.pdf':'abc'}),target=memoryStorage();
  const m=new ObjectStorageMigrator({database,source,target,tenantResolver:()=> 'o1'});
  const r=await m.migratePrefix('legacy');assert.equal(r.migrated,1);
  assert.equal((await target.get('org/o1/legacy/receipt.pdf')).toString(),'abc');
  const state=database.rows.get('legacy/receipt.pdf');assert.equal(state.target_key,'org/o1/legacy/receipt.pdf');
  const v=await m.validate('legacy');assert.equal(v.ok,true);
});

test('legacy org-prefixed source keys are not double scoped',()=>{
  assert.equal(defaultTargetKey('o1','org/o1/receipt.pdf'),'org/o1/receipt.pdf');
});

test('tenant resolution is mandatory and target key cannot escape tenant prefix',async()=>{
  assert.throws(()=>new ObjectStorageMigrator({database:{query(){}},source:memoryStorage(),target:memoryStorage()}),/tenantResolver/);
  const m=new ObjectStorageMigrator({database:memoryDatabase(),source:memoryStorage({'x':'1'}),target:memoryStorage(),tenantResolver:()=> 'o1',targetKeyResolver:()=> 'other/x'});
  await assert.rejects(()=>m.migrateObject('x'),/escaped tenant scope/);
});
