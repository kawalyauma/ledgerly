import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import route,{securityCameraRouteMatcher as matcher} from '../src/http/routes/security-camera.route.mjs';
import extension from '../src/extensions/security-camera.extension.mjs';
import {SecurityCameraNodeService} from '../src/security-camera/node-service.mjs';
import {SECURITY_CAMERA_TABLES} from '../src/migration/security-camera-manifest.mjs';
import {ensureSecurityCameraSchema} from '../src/migration/security-camera-schema.mjs';
import {ALL_SCOPES} from '../src/auth/permissions.mjs';

const request=(method='GET')=>({method,headers:{}});
const url=p=>new URL(`https://ledgerly.test/api/v1/security-camera/${p}`);
const config=(overrides={})=>({extensions:{'security-camera':{applianceCutover:'cloudflare',deviceCutover:'cloudflare',viewerCutover:'cloudflare',managementCutover:'cloudflare',...overrides}}});

test('granular matcher owns only proven appliance routes',()=>{
  assert.equal(matcher.isAppliance(request('GET'),url('server/config')),true);
  assert.equal(matcher.isAppliance(request('POST'),url('server/recordings/sync')),true);
  assert.equal(matcher.isAppliance(request('POST'),url('server/live/update')),false);
  assert.equal(matcher.isAppliance(request('POST'),url('server/unknown')),false);
});
test('granular matcher leaves governance and camera admin routes to fallback',()=>{
  assert.equal(matcher.isViewer(request('POST'),url('cameras/cam1/lifecycle')),false);
  assert.equal(matcher.isViewer(request('POST'),url('cameras/cam1/snapshot')),false);
  assert.equal(matcher.isManagement(request('POST'),url('cameras/cam1/failover')),false);
  assert.equal(matcher.isManagement(request('POST'),url('cameras/cam1/revoke')),true);
});
test('route activation respects independent cutovers',()=>{
  assert.equal(route.enabled(config()),false);
  assert.equal(route.enabled(config({applianceCutover:'node'})),true);
  assert.equal(route.matches({request:request('GET'),url:url('server/config'),config:config({applianceCutover:'node'})}),true);
  assert.equal(route.matches({request:request('GET'),url:url('server/config'),config:config({viewerCutover:'node'})}),false);
  assert.equal(route.matches({request:request('GET'),url:url('cameras'),config:config({viewerCutover:'node'})}),true);
});
test('extension defaults to Cloudflare and validates cutover values',()=>{
  assert.deepEqual(extension.configure({}),{applianceCutover:'cloudflare',deviceCutover:'cloudflare',viewerCutover:'cloudflare',managementCutover:'cloudflare'});
  assert.throws(()=>extension.configure({LEDGERLY_SECURITY_CAMERA_DEVICE_CUTOVER:'maybe'}),/cloudflare, shadow, or node/);
  assert.equal(extension.configure({LEDGERLY_SECURITY_CAMERA_CUTOVER:'node'}).viewerCutover,'node');
});
test('migration manifest owns the complete 37-table D1 security-camera graph',()=>{
  const expected=[
    'security_camera_servers','security_camera_pairings','security_camera_server_pairings','security_cameras','security_camera_recordings','security_camera_live_sessions',
    'security_camera_profiles','security_camera_server_runtime','security_camera_server_volumes','security_camera_alerts','security_camera_access_grants','security_camera_exports',
    'security_camera_zones','security_camera_schedules','security_camera_event_rules','security_camera_events','security_camera_incidents','security_camera_groups','security_camera_group_members',
    'security_camera_wall_views','security_camera_wall_view_items','security_camera_lifecycle','security_camera_audit_events','security_camera_notification_policies','security_camera_notification_queue',
    'security_camera_server_update_policies','security_camera_redundancy','security_camera_failover_events','security_camera_validation_runs','security_camera_inbox','security_camera_backup_status',
    'security_camera_health_events','security_camera_commissioning_runs','security_camera_recording_integrity_checks','security_camera_legal_holds','security_camera_custody_log','security_camera_export_manifests'
  ].sort();
  assert.equal(expected.length,37);
  assert.deepEqual(SECURITY_CAMERA_TABLES.map(t=>t.name).sort(),expected);
  const cameras=SECURITY_CAMERA_TABLES.find(t=>t.name==='security_cameras');
  assert.equal(cameras.transform({recording_enabled:1}).recording_enabled,true);
  assert.equal(cameras.transform({recording_enabled:0}).recording_enabled,false);
});
test('PostgreSQL schema creates exactly the manifest camera tables',async()=>{
  const statements=[];
  await ensureSecurityCameraSchema({query:async sql=>{statements.push(String(sql));return{rows:[]};}});
  const created=[...statements.join('\n').matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-zA-Z0-9_]+)/gi)].map(match=>match[1]).sort();
  assert.deepEqual(created,SECURITY_CAMERA_TABLES.map(table=>table.name).sort());
});

test('self-host auth registry includes all existing camera scopes',()=>{
  for(const scope of ['security:read','security:live','security:export','security:review','security:manage'])assert.equal(ALL_SCOPES.includes(scope),true,scope);
});
test('viewer auth preserves Worker legacy school scope compatibility',async()=>{
  const runtime={
    auth:{authenticateRequest:async()=>({organizationId:'org1',userId:'u1',role:'teacher',scopes:['school:read']})},
    extensions:{'security-camera':{node:{listCameras:async org=>{assert.equal(org,'org1');return[];}}}},
  };
  const response=await route.handle({request:{method:'GET',headers:{}},url:url('cameras'),runtime});
  assert.equal(response.status,200);assert.deepEqual(response.body,{data:[]});
});
test('duplicate/expired device pairing is rejected atomically',async()=>{
  const db={query:async()=>({rows:[]}),transaction:async fn=>fn({query:async sql=>({rows:sql.startsWith('UPDATE security_camera_pairings')?[]:[]})})};
  const service=new SecurityCameraNodeService({database:db});
  await assert.rejects(()=>service.pairDevice({token:'used'}),/invalid, expired or already used/);
});
test('revoked or missing device credentials are rejected',async()=>{
  const db={query:async()=>({rows:[]}),transaction:async()=>{throw new Error('unused');}};
  const service=new SecurityCameraNodeService({database:db});
  await assert.rejects(()=>service.authenticateDevice('cam1','secret'),/invalid or revoked/);
});
test('playback response never leaks local_path',async()=>{
  const queries=[];
  const db={
    async query(sql,params){queries.push(sql);if(sql.startsWith('SELECT r.id'))return{rows:[{id:'r1',camera_id:'c1',server_id:'s1',local_path:'/archive/private/r1.mp4',started_at:'2026-09-11T10:00:00Z',ended_at:'2026-09-11T10:01:00Z',camera_name:'Front',local_base_url:'http://127.0.0.1:8091',public_control_base_url:null}]};return{rows:[]};},
    async transaction(fn){return fn(this);}
  };
  const service=new SecurityCameraNodeService({database:db});
  const grant=await service.playbackGrant('org1','usr1','r1');
  assert.equal(Object.hasOwn(grant,'localPath'),false);
  assert.equal(Object.values(grant).includes('/archive/private/r1.mp4'),false);
  assert.match(grant.url,/\/v1\/access\/[a-f0-9]+\/playback$/);
  assert.equal(queries.some(q=>q.includes('INSERT INTO security_camera_access_grants')),true);
});
test('history list and timeline SQL do not select local_path',async()=>{
  const seen=[];
  const db={async query(sql){seen.push(sql);if(sql.startsWith('SELECT id,name FROM security_cameras'))return{rows:[{id:'c1',name:'Front'}]};return{rows:[]};},async transaction(){throw new Error('unused');}};
  const service=new SecurityCameraNodeService({database:db});
  await service.listRecordings('org1');
  await service.timeline('org1','c1');
  const publicQueries=seen.filter(q=>q.includes('security_camera_recordings'));
  assert.equal(publicQueries.some(q=>/\bSELECT\b[^;]*\blocal_path\b/i.test(q)),false);
});
test('source enforces recording chain continuity and tolerates event metadata races',async()=>{
  const here=path.dirname(fileURLToPath(import.meta.url));
  const source=await readFile(path.join(here,'../src/security-camera/node-service.mjs'),'utf8');
  assert.match(source,/prior\?\.chain_sha256&&previous!==prior\.chain_sha256/);
  assert.match(source,/broken\?'chain_broken'/);
  assert.match(source,/SELECT id FROM security_camera_recordings WHERE id=\$1/);
  assert.match(source,/recordingId=requestedRecording&&await this\.one/);
  assert.match(source,/security_camera_event_rules/);
  assert.match(source,/matching\.some\(rule=>rule\.create_alert\)/);
  assert.match(source,/activeRuntimeIds/);
});
test('Node camera route is control-plane only',async()=>{
  const here=path.dirname(fileURLToPath(import.meta.url));
  const source=await readFile(path.join(here,'../src/http/routes/security-camera.route.mjs'),'utf8');
  assert.doesNotMatch(source,/rawBody|video\/mp4|application\/octet-stream|pipe\(/);
  assert.doesNotMatch(source,/server\/live\/update/);
});
