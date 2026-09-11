import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUSINESS_ROUTE_AUTHORITY_POLICY,
  assertBusinessRouteAuthorityCoverage,
  auditBusinessRouteAuthority,
  createHttpCutoverCapabilities,
  resolveBusinessRouteAuthority,
} from '../src/runtime/business-route-authority.mjs';
import { createCutoverCapabilities } from '../src/runtime/cutover-capabilities.mjs';

const expectedBusinessRoutes=[
  'printerly-approvals',
  'printerly-documents',
  'printerly-jobs',
  'printerly-legacy-node',
  'security-camera-selfhost',
];
const descriptors=expectedBusinessRoutes.map(name=>({name,business:true}));
function config(printerlyNode='node',printerlyJobs='node',camera={}){
  return {extensions:{
    printerly:{cutover:printerlyNode,jobCutover:printerlyJobs},
    'security-camera':{
      applianceCutover:'cloudflare',deviceCutover:'cloudflare',viewerCutover:'cloudflare',managementCutover:'cloudflare',...camera,
    },
  }};
}

test('every reviewed business route has exactly one known authority mapping',()=>{
  assert.deepEqual(Object.keys(BUSINESS_ROUTE_AUTHORITY_POLICY).sort(),expectedBusinessRoutes);
  const audit=auditBusinessRouteAuthority(descriptors);
  assert.equal(audit.ok,true,JSON.stringify(audit));
  assert.deepEqual(audit.unmapped,[]);
  assert.deepEqual(audit.stalePolicy,[]);
});

test('authority audit fails closed for an unmapped future business route',()=>{
  const audit=auditBusinessRouteAuthority([
    {name:'printerly-jobs',business:true},
    {name:'future-finance-api',business:true},
  ],{policy:{'printerly-jobs':{capability:'printerly.jobs'}}});
  assert.equal(audit.ok,false);
  assert.deepEqual(audit.unmapped,['future-finance-api']);
  assert.throws(()=>assertBusinessRouteAuthorityCoverage([{name:'future-finance-api',business:true}],{policy:{}}),/unmapped=future-finance-api/);
});

test('authority audit rejects stale, non-business and unknown capability policy entries',()=>{
  const sample=[{name:'selfhost-only',business:false}];
  const audit=auditBusinessRouteAuthority(sample,{policy:{
    'missing-route':{capability:'printerly.jobs'},
    'selfhost-only':{capability:'not-a-capability'},
  }});
  assert.equal(audit.ok,false);
  assert.deepEqual(audit.stalePolicy,['missing-route']);
  assert.deepEqual(audit.nonBusinessPolicy,['selfhost-only']);
  assert.deepEqual(audit.unknownCapabilities,[{routeName:'selfhost-only',capability:'not-a-capability'}]);
});

test('HTTP capability state follows Printerly and security-camera cutover config',()=>{
  const cloudflare=createHttpCutoverCapabilities(config('cloudflare','cloudflare'));
  assert.equal(cloudflare.state('printerly.nodes'),'cloudflare');
  assert.equal(cloudflare.state('printerly.jobs'),'cloudflare');
  assert.equal(cloudflare.state('nvr.metadata'),'cloudflare');
  const shadow=createHttpCutoverCapabilities(config('shadow','shadow',{viewerCutover:'shadow'}));
  assert.equal(shadow.state('printerly.nodes'),'shadow');
  assert.equal(shadow.state('printerly.jobs'),'shadow');
  assert.equal(shadow.state('nvr.metadata'),'shadow');
  const node=createHttpCutoverCapabilities(config('node','node',{deviceCutover:'node'}));
  assert.equal(node.isNodeAuthoritative('printerly.nodes'),true);
  assert.equal(node.isNodeAuthoritative('printerly.jobs'),true);
  assert.equal(node.isNodeAuthoritative('nvr.metadata'),true);
});

test('NVR metadata becomes node only when at least one camera route group is explicitly node',()=>{
  const keys=['applianceCutover','deviceCutover','viewerCutover','managementCutover'];
  for(const key of keys){
    const caps=createHttpCutoverCapabilities(config('cloudflare','cloudflare',{[key]:'node'}));
    assert.equal(caps.state('nvr.metadata'),'node',key);
  }
  assert.equal(createHttpCutoverCapabilities(config('cloudflare','cloudflare',{viewerCutover:'shadow'})).state('nvr.metadata'),'shadow');
});

test('business route resolver only treats node as HTTP authoritative',()=>{
  const descriptor={name:'security-camera-selfhost',business:true};
  for(const state of ['cloudflare','shadow']){
    const capabilities=createCutoverCapabilities({'nvr.metadata':state});
    const authority=resolveBusinessRouteAuthority(descriptor,capabilities);
    assert.equal(authority.state,state);
    assert.equal(authority.nodeAuthoritative,false);
  }
  const authority=resolveBusinessRouteAuthority(descriptor,createCutoverCapabilities({'nvr.metadata':'node'}));
  assert.equal(authority.nodeAuthoritative,true);
});
