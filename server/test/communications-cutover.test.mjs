import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHttpCutoverCapabilities } from '../src/runtime/business-route-authority.mjs';
import { listHttpRouteDescriptors } from '../src/http/routes.mjs';
import communicationsRoute from '../src/http/routes/communications-api.route.mjs';

function request(payload,{method='GET',headers={}}={}){const stream=Readable.from(payload===undefined?[]:[Buffer.from(JSON.stringify(payload))]);stream.method=method;stream.headers=headers;stream.socket={remoteAddress:'127.0.0.1'};return stream;}
function runtimeFor(principal,api={}){return{auth:{async authenticateRequest(){return principal;},requireScope(p,scope){if(p.role==='owner'||p.role==='admin'||p.scopes?.includes(scope))return p;throw Object.assign(new Error('forbidden'),{status:403,code:'FORBIDDEN'});}},extensions:{communications:{api}}};}
const config={http:{maxRequestBodyBytes:8192},extensions:{communications:{enabled:true,cutover:'node'},contacts:{},'platform-modules':{},'human-resources':{},'school-platform':{},printerly:{}}};

test('Communications authoritative route is registered under /api/v1',()=>{const route=listHttpRouteDescriptors().find(item=>item.name==='communications-api');assert.equal(route?.prefix,'/api/v1/communications');assert.equal(route?.business,true);});

test('Communications authority defaults to Cloudflare and can switch independently to Node',()=>{const defaults=createHttpCutoverCapabilities({extensions:{communications:{},contacts:{},'platform-modules':{},'human-resources':{},'school-platform':{},printerly:{}}});assert.equal(defaults.state('communications.core'),'cloudflare');const node=createHttpCutoverCapabilities(config);assert.equal(node.state('communications.core'),'node');});

test('Communications summary is tenant scoped',async()=>{const principal={organizationId:'org_1',userId:'usr_1',role:'viewer',scopes:['communications:read']};let org;const result=await communicationsRoute.handle({request:request(),url:new URL('http://localhost/api/v1/communications/summary'),config,runtime:runtimeFor(principal,{async summary(value){org=value;return{campaigns:2,scheduled:1,sent:3,failed:0};}})});assert.equal(result.status,200);assert.equal(org,'org_1');assert.equal(result.body.data.campaigns,2);});

test('Communications campaign creation delegates tenant and actor',async()=>{const principal={organizationId:'org_2',userId:'usr_owner',role:'owner',scopes:[]};let received;const result=await communicationsRoute.handle({request:request({typeKey:'organization_announcement',channels:['sms'],audience:{kind:'organization_users'}},{method:'POST'}),url:new URL('http://localhost/api/v1/communications/campaigns'),config,runtime:runtimeFor(principal,{async createCampaign(input){received=input;return{id:'cmp_1',status:'draft'};}})});assert.equal(result.status,201);assert.equal(received.organizationId,'org_2');assert.equal(received.userId,'usr_owner');assert.equal(result.body.data.id,'cmp_1');});

test('Communications writes require communications:write',async()=>{const principal={organizationId:'org_1',userId:'usr_1',role:'viewer',scopes:['communications:read']};await assert.rejects(communicationsRoute.handle({request:request({typeKey:'organization_announcement',channels:['sms'],audience:{kind:'organization_users'}},{method:'POST'}),url:new URL('http://localhost/api/v1/communications/campaigns'),config,runtime:runtimeFor(principal,{async createCampaign(){throw new Error('must not run');}})}),error=>error?.status===403);});
