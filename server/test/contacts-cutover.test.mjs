import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHttpCutoverCapabilities } from '../src/runtime/business-route-authority.mjs';
import { listHttpRouteDescriptors } from '../src/http/routes.mjs';
import contactsRoute from '../src/http/routes/contacts-api.route.mjs';

function request(payload,{method='GET',headers={}}={}){const stream=Readable.from(payload===undefined?[]:[Buffer.from(JSON.stringify(payload))]);stream.method=method;stream.headers=headers;stream.socket={remoteAddress:'127.0.0.1'};return stream;}
function runtimeFor(principal,api={}){return{auth:{async authenticateRequest(){return principal;},requireScope(p,scope){if(p.role==='owner'||p.role==='admin'||p.scopes?.includes(scope))return p;throw Object.assign(new Error('forbidden'),{status:403,code:'FORBIDDEN'});}},extensions:{contacts:{api}}};}
const config={http:{maxRequestBodyBytes:4096},extensions:{contacts:{enabled:true,cutover:'node'},'platform-modules':{},'human-resources':{},'school-platform':{},printerly:{}}};

test('Contacts authoritative route is registered under /api/v1',()=>{const route=listHttpRouteDescriptors().find(item=>item.name==='contacts-api');assert.equal(route?.prefix,'/api/v1/contacts');assert.equal(route?.business,true);});

test('Contacts authority defaults to Cloudflare and can switch independently to Node',()=>{const defaults=createHttpCutoverCapabilities({extensions:{contacts:{},'platform-modules':{},'human-resources':{},'school-platform':{},printerly:{}}});assert.equal(defaults.state('contacts.core'),'cloudflare');const node=createHttpCutoverCapabilities(config);assert.equal(node.state('contacts.core'),'node');});

test('Contacts capabilities are tenant-scoped through the PostgreSQL API service',async()=>{const principal={organizationId:'org_1',userId:'usr_1',role:'viewer',scopes:['contacts:read']};let received;const result=await contactsRoute.handle({request:request(),url:new URL('http://localhost/api/v1/contacts/capabilities'),requestId:'req_1',config,runtime:runtimeFor(principal,{async capabilities(org){received=org;return{enabledModules:[],sources:[]};}})});assert.equal(result.status,200);assert.equal(received,'org_1');assert.deepEqual(result.body.data.sources,[]);});

test('Contacts create delegates actor, tenant and request identity',async()=>{const principal={organizationId:'org_7',userId:'usr_owner',role:'owner',scopes:[]};let received;const result=await contactsRoute.handle({request:request({type:'customer',name:'Acme'},{method:'POST'}),url:new URL('http://localhost/api/v1/contacts'),requestId:'req_7',config,runtime:runtimeFor(principal,{async create(input){received=input;return{id:'con_1',...input.input};}})});assert.equal(result.status,201);assert.equal(received.organizationId,'org_7');assert.equal(received.userId,'usr_owner');assert.equal(received.requestId,'req_7');assert.equal(result.body.data.name,'Acme');});

test('Contacts writes reject principals without contacts:write',async()=>{const principal={organizationId:'org_1',userId:'usr_1',role:'viewer',scopes:['contacts:read']};await assert.rejects(contactsRoute.handle({request:request({type:'other',name:'Nope'},{method:'POST'}),url:new URL('http://localhost/api/v1/contacts'),requestId:'req_2',config,runtime:runtimeFor(principal,{async create(){throw new Error('must not run');}})}),error=>error?.status===403);});
