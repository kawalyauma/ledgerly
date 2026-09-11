import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUSINESS_ROUTE_AUTHORITY_POLICY,
  auditBusinessRouteAuthority,
  createHttpCutoverCapabilities,
  resolveBusinessRouteAuthority,
} from '../src/runtime/business-route-authority.mjs';

const descriptor={name:'security-camera-selfhost',business:true};
const cameraConfig=(cuts={})=>({extensions:{'security-camera':{
  applianceCutover:'cloudflare',deviceCutover:'cloudflare',viewerCutover:'cloudflare',managementCutover:'cloudflare',...cuts,
}}});

test('security camera has reviewed central NVR authority mapping',()=>{
  assert.equal(BUSINESS_ROUTE_AUTHORITY_POLICY['security-camera-selfhost']?.capability,'nvr.metadata');
  const audit=auditBusinessRouteAuthority([descriptor],{policy:{'security-camera-selfhost':BUSINESS_ROUTE_AUTHORITY_POLICY['security-camera-selfhost']}});
  assert.equal(audit.ok,true,JSON.stringify(audit));
});

test('NVR central capability stays Cloudflare when every camera group is Cloudflare',()=>{
  assert.equal(createHttpCutoverCapabilities(cameraConfig()).state('nvr.metadata'),'cloudflare');
});

test('NVR central capability is shadow when no group is node but at least one is shadow',()=>{
  assert.equal(createHttpCutoverCapabilities(cameraConfig({viewerCutover:'shadow'})).state('nvr.metadata'),'shadow');
});

test('NVR central capability becomes node when any proven camera group is node',()=>{
  for(const key of ['applianceCutover','deviceCutover','viewerCutover','managementCutover']){
    const caps=createHttpCutoverCapabilities(cameraConfig({[key]:'node'}));
    assert.equal(caps.state('nvr.metadata'),'node',key);
    assert.equal(resolveBusinessRouteAuthority(descriptor,caps).nodeAuthoritative,true,key);
  }
});

test('shadow NVR metadata never becomes HTTP authoritative',()=>{
  const caps=createHttpCutoverCapabilities(cameraConfig({applianceCutover:'shadow'}));
  const authority=resolveBusinessRouteAuthority(descriptor,caps);
  assert.equal(authority.state,'shadow');
  assert.equal(authority.nodeAuthoritative,false);
});
