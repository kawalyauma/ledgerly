import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHttpCutoverCapabilities } from '../src/runtime/business-route-authority.mjs';
import { listHttpRouteDescriptors } from '../src/http/routes.mjs';
import mobileSyncRoute from '../src/http/routes/mobile-sync-api.route.mjs';
import offlineRoute from '../src/http/routes/mobile-sync-offline.route.mjs';

function request(payload,{method='GET',headers={}}={}){const stream=Readable.from(payload===undefined?[]:[Buffer.from(JSON.stringify(payload))]);stream.method=method;stream.headers=headers;stream.socket={remoteAddress:'127.0.0.1'};return stream;}
const principal={organizationId:'org_1',userId:'usr_1',role:'owner',scopes:[]};
function runtimeFor(api={}){return{auth:{async authenticateRequest(){return principal;},async issueTokens(input){return{accessToken:'access',expiresIn:900,...input};}},extensions:{'mobile-sync':{api}}};}
const config={http:{maxRequestBodyBytes:65536},extensions:{'mobile-sync':{enabled:true,cutover:'node'},contacts:{},communications:{},'platform-modules':{},'human-resources':{},'school-platform':{},printerly:{}}};

test('Mobile Sync private and offline routes are registered under /api/v1',()=>{const routes=listHttpRouteDescriptors();const api=routes.find(item=>item.name==='mobile-sync-api');const offline=routes.find(item=>item.name==='mobile-sync-offline');assert.equal(api?.prefix,'/api/v1/mobile-sync');assert.equal(api?.business,true);assert.equal(offline?.prefix,'/api/v1/mobile-sync/offline');assert.equal(offline?.public,true);});

test('Mobile Sync authority defaults to Cloudflare and switches independently',()=>{const defaults=createHttpCutoverCapabilities({extensions:{'mobile-sync':{},contacts:{},communications:{},'platform-modules':{},'human-resources':{},'school-platform':{},printerly:{}}});assert.equal(defaults.state('mobile-sync.core'),'cloudflare');assert.equal(createHttpCutoverCapabilities(config).state('mobile-sync.core'),'node');});

test('Mobile Sync manifest delegates to the PostgreSQL API facade',async()=>{const result=await mobileSyncRoute.handle({request:request(),url:new URL('http://localhost/api/v1/mobile-sync/manifest'),requestId:'req_1',config,runtime:runtimeFor({manifest(){return{protocolVersion:1,collections:[]};}})});assert.equal(result.status,200);assert.equal(result.body.data.protocolVersion,1);});

test('Mobile Sync push preserves authenticated tenant identity',async()=>{let received;const api={async push(who,input){received={who,input};return{batchId:input.batchId,status:'completed',operations:[]};}};const payload={deviceId:'msd_device_1234',batchId:'batch_12345678',protocolVersion:1,operations:[{operationId:'operation_12345678',sequence:1,moduleKey:'contacts',collectionKey:'contacts',recordId:'record_12345678',kind:'upsert',schemaVersion:1,baseVersion:0,clientTimestamp:new Date().toISOString(),payload:{name:'A'}}]};const result=await mobileSyncRoute.handle({request:request(payload,{method:'POST'}),url:new URL('http://localhost/api/v1/mobile-sync/push'),requestId:'req_2',config,runtime:runtimeFor(api)});assert.equal(result.status,200);assert.equal(received.who.organizationId,'org_1');assert.equal(received.input.batchId,'batch_12345678');});

test('Offline grant exchange is exposed only while Node cutover is enabled',()=>{assert.equal(offlineRoute.enabled(config),true);assert.equal(offlineRoute.enabled({extensions:{'mobile-sync':{enabled:true,cutover:'cloudflare'}}}),false);});
