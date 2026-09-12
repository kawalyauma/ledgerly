import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHttpCutoverCapabilities } from '../src/runtime/business-route-authority.mjs';
import { listHttpRouteDescriptors } from '../src/http/routes.mjs';
import hrRoute from '../src/http/routes/human-resources-api.route.mjs';

function request(payload,{method='GET',headers={}}={}){
  const stream=Readable.from(payload===undefined?[]:[Buffer.from(JSON.stringify(payload))]);
  stream.method=method;stream.headers=headers;stream.socket={remoteAddress:'127.0.0.1'};return stream;
}

function runtimeFor(principal,api={}){
  return{
    auth:{async authenticateRequest(){return principal;},requireScope(){return principal;}},
    extensions:{'human-resources':{api:{async requireEnabled(){},...api}}},
  };
}

const config={http:{maxRequestBodyBytes:4096},extensions:{
  'human-resources':{enabled:true,cutover:'node'},
  'platform-modules':{enabled:true,cutover:'node'},
  'school-platform':{},printerly:{},
}};

test('HR and platform module business routes are registered under /api/v1',()=>{
  const routes=listHttpRouteDescriptors();
  const hr=routes.find(route=>route.name==='human-resources-api');
  const modules=routes.find(route=>route.name==='platform-modules');
  assert.equal(hr?.prefix,'/api/v1/human-resources');
  assert.equal(hr?.business,true);
  assert.equal(modules?.prefix,'/api/v1/modules');
  assert.equal(modules?.business,true);
});

test('HR and platform module authority is fail-closed by default and independently switchable',()=>{
  const defaults=createHttpCutoverCapabilities({extensions:{printerly:{},'school-platform':{},'human-resources':{},'platform-modules':{}}});
  assert.equal(defaults.state('human-resources.core'),'cloudflare');
  assert.equal(defaults.state('platform.modules'),'cloudflare');
  const node=createHttpCutoverCapabilities(config);
  assert.equal(node.state('human-resources.core'),'node');
  assert.equal(node.state('platform.modules'),'node');
});

test('HR dashboard delegates to PostgreSQL API service for an HR reader',async()=>{
  const principal={organizationId:'org_1',userId:'usr_1',role:'viewer',scopes:['hr:read']};
  let received;
  const result=await hrRoute.handle({
    request:request(),url:new URL('http://localhost/api/v1/human-resources/dashboard'),requestId:'req_1',config,
    runtime:runtimeFor(principal,{async dashboard(organizationId){received=organizationId;return{employees:4,activeEmployees:3,departments:2,pendingLeave:1,pendingOnboarding:0};}}),
  });
  assert.equal(result.status,200);
  assert.equal(received,'org_1');
  assert.equal(result.body.data.activeEmployees,3);
});

test('HR write routes reject read-only principals before mutation',async()=>{
  const principal={organizationId:'org_1',userId:'usr_1',role:'viewer',scopes:['hr:read']};
  await assert.rejects(
    hrRoute.handle({request:request({employeeNumber:'E1'},{method:'POST'}),url:new URL('http://localhost/api/v1/human-resources/employees'),requestId:'req_2',config,runtime:runtimeFor(principal,{async createEmployee(){throw new Error('must not run');}})}),
    error=>error?.status===403&&error?.code==='FORBIDDEN',
  );
});

test('owner HR write delegates tenant and actor identity explicitly',async()=>{
  const principal={organizationId:'org_7',userId:'usr_owner',role:'owner',scopes:[]};
  let received;
  const result=await hrRoute.handle({
    request:request({code:'OPS',name:'Operations'},{method:'POST'}),url:new URL('http://localhost/api/v1/human-resources/departments'),requestId:'req_3',config,
    runtime:runtimeFor(principal,{async createDepartment(input){received=input;return{id:'hrd_1',...input.input};}}),
  });
  assert.equal(result.status,201);
  assert.equal(received.organizationId,'org_7');
  assert.equal(received.userId,'usr_owner');
  assert.equal(received.requestId,'req_3');
  assert.equal(result.body.data.code,'OPS');
});
