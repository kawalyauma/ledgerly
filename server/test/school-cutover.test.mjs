import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import setupRoute from '../src/http/routes/school-setup.route.mjs';
import studentRoute from '../src/http/routes/school-student-management.route.mjs';
import { listHttpRouteDescriptors, createHttpRouteRegistry } from '../src/http/routes.mjs';
import { createHttpCutoverCapabilities } from '../src/runtime/business-route-authority.mjs';

function request(method='GET', payload, headers={authorization:'Bearer test'}) {
  const stream=Readable.from(payload===undefined?[]:[Buffer.from(JSON.stringify(payload))]);
  stream.method=method;
  stream.headers=headers;
  stream.socket={remoteAddress:'127.0.0.1'};
  return stream;
}
function authRuntime(extra={}) {
  return {
    auth:{
      async authenticateRequest(){return{userId:'usr_1',organizationId:'org_1',role:'owner',scopes:[]};},
      requireScope(){},
    },
    extensions:{'school-platform':{setup:{async bootstrapStatus(){return{profile:true,academicYear:true};}}}},
    services:{database:{async query(){return{rows:[]};}}},
    ...extra,
  };
}
const config={extensions:{'school-platform':{
  enabled:true,
  referenceReadCutover:'node',referenceWriteCutover:'node',
  peopleReadCutover:'node',peopleWriteCutover:'cloudflare',
},printerly:{}}};

test('School business routes are registered under explicit API prefixes',()=>{
  const descriptors=listHttpRouteDescriptors();
  const setup=descriptors.find(x=>x.name==='school-setup');
  const people=descriptors.find(x=>x.name==='school-student-management');
  assert.equal(setup?.prefix,'/api/v1/school/setup');
  assert.equal(setup?.business,true);
  assert.equal(people?.prefix,'/api/v1/school/student-management');
  assert.equal(people?.business,true);
});

test('School cutover capabilities independently expose setup and people reads',()=>{
  const capabilities=createHttpCutoverCapabilities(config);
  assert.equal(capabilities.state('school.reference.read'),'node');
  assert.equal(capabilities.state('school.reference.write'),'node');
  assert.equal(capabilities.state('school.people.read'),'node');
  assert.equal(capabilities.state('school.people.write'),'cloudflare');
});

test('School setup bootstrap delegates to PostgreSQL service',async()=>{
  const result=await setupRoute.handle({request:request(),url:new URL('http://localhost/api/v1/school/setup/bootstrap/status'),runtime:authRuntime(),config});
  assert.equal(result.status,200);
  assert.equal(result.body.data.profile,true);
});

test('School setup writes fail closed when write authority is not Node',async()=>{
  const blocked={...config,extensions:{...config.extensions,'school-platform':{...config.extensions['school-platform'],referenceWriteCutover:'cloudflare'}}};
  await assert.rejects(
    setupRoute.handle({request:request('PUT',{schoolName:'Example'}),url:new URL('http://localhost/api/v1/school/setup/profile'),runtime:authRuntime(),config:blocked}),
    error=>error?.status===503&&error?.code==='SCHOOL_SETUP_WRITE_NOT_CUT_OVER',
  );
});

test('School people writes remain blocked even if a caller reaches the route',async()=>{
  await assert.rejects(
    studentRoute.handle({request:request('POST',{firstName:'A'}),url:new URL('http://localhost/api/v1/school/student-management/students'),runtime:authRuntime(),config}),
    error=>error?.status===503&&error?.code==='SCHOOL_PEOPLE_WRITE_NOT_CUT_OVER',
  );
});

test('HTTP registry activates School routes only when their read capabilities are Node',async()=>{
  const registry=await createHttpRouteRegistry({runtime:authRuntime(),config,cutoverCapabilities:createHttpCutoverCapabilities(config)});
  const active=registry.describe().map(x=>x.name);
  assert.ok(active.includes('school-setup'));
  assert.ok(active.includes('school-student-management'));
});
