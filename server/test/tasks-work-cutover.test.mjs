import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHttpCutoverCapabilities } from '../src/runtime/business-route-authority.mjs';
import { listHttpRouteDescriptors } from '../src/http/routes.mjs';
import route from '../src/http/routes/tasks-work-api.route.mjs';

const principal={organizationId:'org_1',userId:'usr_1',role:'owner',scopes:[]};
function request(payload,{method='GET'}={}){const stream=Readable.from(payload===undefined?[]:[Buffer.from(JSON.stringify(payload))]);stream.method=method;stream.headers={};stream.socket={remoteAddress:'127.0.0.1'};return stream;}
function runtime(api,enabled=true){return{auth:{async authenticateRequest(){return principal;}},services:{database:{async query(){return{rows:enabled?[{enabled:true}]:[]};}}},extensions:{'tasks-work':{api}}};}
const config={http:{maxRequestBodyBytes:65536},extensions:{'tasks-work':{enabled:true,cutover:'node',webhookCutover:'cloudflare'},'mobile-sync':{},contacts:{},communications:{},'platform-modules':{},'human-resources':{},'school-platform':{},printerly:{}}};

test('Tasks & Work private API is registered under /api/v1/work',()=>{const found=listHttpRouteDescriptors().find(item=>item.name==='tasks-work-api');assert.equal(found?.prefix,'/api/v1/work');assert.equal(found?.business,true);});

test('Tasks & Work authority defaults to Cloudflare and switches independently',()=>{const defaults=createHttpCutoverCapabilities({extensions:{'tasks-work':{},'mobile-sync':{},contacts:{},communications:{},'platform-modules':{},'human-resources':{},'school-platform':{},printerly:{}}});assert.equal(defaults.state('tasks-work.core'),'cloudflare');assert.equal(defaults.state('tasks-work.webhook'),'cloudflare');const node=createHttpCutoverCapabilities(config);assert.equal(node.state('tasks-work.core'),'node');assert.equal(node.state('tasks-work.webhook'),'cloudflare');});

test('Tasks & Work route delegates dashboard with authenticated tenant',async()=>{let seen;const api={async dashboard(p){seen=p;return{tasks:{total:3}};}};const result=await route.handle({request:request(),url:new URL('http://localhost/api/v1/work/dashboard'),requestId:'req_1',config,runtime:runtime(api)});assert.equal(result.status,200);assert.equal(result.body.data.tasks.total,3);assert.equal(seen.organizationId,'org_1');});

test('Tasks & Work route rejects organizations where the optional module is disabled',async()=>{await assert.rejects(()=>route.handle({request:request(),url:new URL('http://localhost/api/v1/work/dashboard'),requestId:'req_2',config,runtime:runtime({dashboard(){throw new Error('must not run')}},false)}),error=>error?.code==='MODULE_DISABLED'&&error?.status===403);});

test('Tasks & Work task creation preserves authenticated principal',async()=>{let seen;const api={async createTask(p,input,requestId){seen={p,input,requestId};return{id:'tsk_1',title:input.title};}};const result=await route.handle({request:request({title:'Finish report'},{method:'POST'}),url:new URL('http://localhost/api/v1/work/tasks'),requestId:'req_3',config,runtime:runtime(api)});assert.equal(result.status,201);assert.equal(seen.p.userId,'usr_1');assert.equal(seen.input.title,'Finish report');assert.equal(seen.requestId,'req_3');});
