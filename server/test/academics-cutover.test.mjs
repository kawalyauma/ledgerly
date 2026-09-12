import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHttpCutoverCapabilities } from '../src/runtime/business-route-authority.mjs';
import { listHttpRouteDescriptors } from '../src/http/routes.mjs';
import academicsRoute from '../src/http/routes/academics-api.route.mjs';
import { PostgresAcademicsParityService } from '../src/academics/parity-service.mjs';

function request(payload,{method='GET',headers={}}={}){const stream=Readable.from(payload===undefined?[]:[Buffer.from(JSON.stringify(payload))]);stream.method=method;stream.headers=headers;return stream;}
const config={http:{maxRequestBodyBytes:65536},extensions:{academics:{enabled:true,cutover:'node'},attendance:{},contacts:{},communications:{},'platform-modules':{},'human-resources':{},'school-platform':{},printerly:{}}};
function runtime(api){return{auth:{async authenticateRequest(){return{organizationId:'org_1',userId:'usr_1',role:'owner',scopes:[]};}},services:{database:{async query(){return{rows:[]};}}},extensions:{academics:{api}}};}

test('Academics route is registered as an explicit business route',()=>{const route=listHttpRouteDescriptors().find(item=>item.name==='academics-api');assert.equal(route?.prefix,'/api/v1/academics');assert.equal(route?.business,true);});

test('Academics defaults to Cloudflare and can move independently to Node',()=>{const defaults=createHttpCutoverCapabilities({extensions:{}});assert.equal(defaults.state('academics.core'),'cloudflare');const node=createHttpCutoverCapabilities(config);assert.equal(node.state('academics.core'),'node');assert.equal(node.state('attendance.core'),'cloudflare');});

test('Academics overview preserves tenant identity when delegating to PostgreSQL',async()=>{let enabledOrg,overviewOrg;const api={async requireEnabled(org){enabledOrg=org;},async overview(org){overviewOrg=org;return{schemes:2};}};const result=await academicsRoute.handle({request:request(undefined),url:new URL('http://localhost/api/v1/academics/overview'),requestId:'req_1',runtime:runtime(api),config});assert.equal(result.status,200);assert.equal(enabledOrg,'org_1');assert.equal(overviewOrg,'org_1');assert.equal(result.body.data.schemes,2);});

test('Academics lesson-plan resubmission remains available without changing Exams authority',async()=>{let args;const api={async requireEnabled(){},async resubmitLessonPlan(value){args=value;return{id:value.id,status:'submitted'};}};const result=await academicsRoute.handle({request:request({}, {method:'POST'}),url:new URL('http://localhost/api/v1/academics/lesson-plans/alp_1/resubmit'),requestId:'req_2',runtime:runtime(api),config});assert.equal(result.status,200);assert.equal(args.organizationId,'org_1');assert.equal(args.id,'alp_1');const caps=createHttpCutoverCapabilities(config);assert.equal(caps.state('academics.core'),'node');assert.throws(()=>caps.state('exams.core'),/Unknown cutover capability/);});

test('Academics manifest explicitly excludes Exams',()=>{const database={async query(){return{rows:[]};}};const api=new PostgresAcademicsParityService({database});const manifest=api.manifest();assert.equal(manifest.key,'academics');assert.equal(manifest.examsExclusive,true);assert.equal(manifest.examsIncluded,false);});
