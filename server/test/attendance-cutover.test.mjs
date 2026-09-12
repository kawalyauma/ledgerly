import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHttpCutoverCapabilities } from '../src/runtime/business-route-authority.mjs';
import { listHttpRouteDescriptors } from '../src/http/routes.mjs';
import attendanceRoute from '../src/http/routes/attendance-api.route.mjs';
import deviceRoute from '../src/http/routes/attendance-device.route.mjs';
import enrollmentRoute from '../src/http/routes/attendance-device-enrollment.route.mjs';

function request(payload,{method='GET',headers={}}={}){const stream=Readable.from(payload===undefined?[]:[Buffer.from(JSON.stringify(payload))]);stream.method=method;stream.headers=headers;return stream;}
const config={http:{maxRequestBodyBytes:4096},extensions:{attendance:{enabled:true,cutover:'node'},contacts:{},communications:{},'platform-modules':{},'human-resources':{},'school-platform':{},printerly:{}}};
function userRuntime(api){return{auth:{async authenticateRequest(){return{organizationId:'org_1',userId:'usr_1',role:'owner',scopes:[]};}},services:{database:{async query(){return{rows:[]};}}},extensions:{attendance:{api}}};}

test('Attendance management and kiosk routes are registered as business routes',()=>{
  const routes=listHttpRouteDescriptors();
  for(const [name,prefix] of [['attendance-api','/api/v1/attendance'],['attendance-device','/api/v1/attendance/device'],['attendance-device-enrollment','/api/v1/attendance/device-enrollment']]){
    const route=routes.find(item=>item.name===name);assert.equal(route?.prefix,prefix);assert.equal(route?.business,true);
  }
});

test('Attendance authority defaults to Cloudflare and moves independently to Node',()=>{
  const defaults=createHttpCutoverCapabilities({extensions:{}});assert.equal(defaults.state('attendance.core'),'cloudflare');
  const node=createHttpCutoverCapabilities(config);assert.equal(node.state('attendance.core'),'node');
});

test('Attendance overview delegates tenant identity to PostgreSQL service',async()=>{
  let enabledOrg,overviewArgs;
  const api={async requireEnabled(org){enabledOrg=org;},async overview(org,date){overviewArgs={org,date};return{date};}};
  const result=await attendanceRoute.handle({request:request(undefined),url:new URL('http://localhost/api/v1/attendance/overview?date=2026-09-12'),requestId:'req_1',runtime:userRuntime(api),config});
  assert.equal(result.status,200);assert.equal(enabledOrg,'org_1');assert.deepEqual(overviewArgs,{org:'org_1',date:'2026-09-12'});
});

test('Attendance kiosk endpoint authenticates the device instead of a user JWT',async()=>{
  let authorization;
  const api={async authenticateDevice(value){authorization=value;return{id:'atd_1',device_code:'ATT-000001',organization_id:'org_1',status:'active'};},async deviceBootstrap(device){return{deviceId:device.id};}};
  const runtime={extensions:{attendance:{api}}};
  const result=await deviceRoute.handle({request:request(undefined,{headers:{authorization:'Device atd_1.secret'}}),url:new URL('http://localhost/api/v1/attendance/device/bootstrap'),runtime,config});
  assert.equal(result.status,200);assert.equal(authorization,'Device atd_1.secret');assert.equal(result.body.data.deviceId,'atd_1');
});

test('One-time kiosk enrollment is public at the HTTP layer but still token validated by the service',async()=>{
  let input;
  const api={async enrollDevice(value){input=value;return{deviceId:'atd_1',status:'active'};}};
  const result=await enrollmentRoute.handle({request:request({token:'a'.repeat(32),appVersion:'1.0.0'},{method:'POST'}),url:new URL('http://localhost/api/v1/attendance/device-enrollment'),runtime:{extensions:{attendance:{api}}},config});
  assert.equal(result.status,201);assert.equal(input.enrollmentToken,'a'.repeat(32));assert.equal(input.appVersion,'1.0.0');
});
