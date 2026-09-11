import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createHttpRouteRegistry,
  getBusinessRouteAuthorityAudit,
  listHttpRouteDescriptors,
} from '../src/http/routes.mjs';
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
];

function printerlyConfig(cutover='node',jobCutover='node'){
  return {extensions:{printerly:{cutover,jobCutover}}};
}

test('every discovered business route has exactly one reviewed authority mapping',()=>{
  const descriptors=listHttpRouteDescriptors();
  const business=descriptors.filter(route=>route.business).map(route=>route.name).sort();
  assert.deepEqual(business,expectedBusinessRoutes);
  assert.deepEqual(Object.keys(BUSINESS_ROUTE_AUTHORITY_POLICY).sort(),expectedBusinessRoutes);
  const audit=getBusinessRouteAuthorityAudit();
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
  assert.throws(()=>assertBusinessRouteAuthorityCoverage([
    {name:'future-finance-api',business:true},
  ],{policy:{}}),/unmapped=future-finance-api/);
});

test('authority audit rejects stale, non-business and unknown capability policy entries',()=>{
  const descriptors=[{name:'selfhost-only',business:false}];
  const audit=auditBusinessRouteAuthority(descriptors,{policy:{
    'missing-route':{capability:'printerly.jobs'},
    'selfhost-only':{capability:'not-a-capability'},
  }});
  assert.equal(audit.ok,false);
  assert.deepEqual(audit.stalePolicy,['missing-route']);
  assert.deepEqual(audit.nonBusinessPolicy,['selfhost-only']);
  assert.deepEqual(audit.unknownCapabilities,[{routeName:'selfhost-only',capability:'not-a-capability'}]);
});

test('HTTP capability state follows Printerly extension cutover config',()=>{
  const cloudflare=createHttpCutoverCapabilities(printerlyConfig('cloudflare','cloudflare'));
  assert.equal(cloudflare.state('printerly.nodes'),'cloudflare');
  assert.equal(cloudflare.state('printerly.jobs'),'cloudflare');
  const shadow=createHttpCutoverCapabilities(printerlyConfig('shadow','shadow'));
  assert.equal(shadow.state('printerly.nodes'),'shadow');
  assert.equal(shadow.state('printerly.jobs'),'shadow');
  const node=createHttpCutoverCapabilities(printerlyConfig('node','node'));
  assert.equal(node.isNodeAuthoritative('printerly.nodes'),true);
  assert.equal(node.isNodeAuthoritative('printerly.jobs'),true);
});

test('business route resolver only treats node as HTTP authoritative',()=>{
  const descriptor={name:'printerly-jobs',business:true};
  for(const state of ['cloudflare','shadow']){
    const capabilities=createCutoverCapabilities({'printerly.jobs':state});
    const authority=resolveBusinessRouteAuthority(descriptor,capabilities);
    assert.equal(authority.state,state);
    assert.equal(authority.nodeAuthoritative,false);
  }
  const authority=resolveBusinessRouteAuthority(descriptor,createCutoverCapabilities({'printerly.jobs':'node'}));
  assert.equal(authority.nodeAuthoritative,true);
});

test('route registry independently blocks feature-enabled business routes unless capability is node',async()=>{
  const config=printerlyConfig('node','node');
  const cloudflareCaps=createCutoverCapabilities({
    'printerly.nodes':'cloudflare',
    'printerly.jobs':'cloudflare',
  });
  const blocked=await createHttpRouteRegistry({runtime:{},config,cutoverCapabilities:cloudflareCaps});
  assert.equal(blocked.describe().some(route=>route.business),false);
  const blockedAuthority=blocked.describeAuthority();
  assert(blockedAuthority.blocked.some(route=>route.name==='printerly-jobs'&&route.reason==='not-node-authoritative'));

  const nodeCaps=createCutoverCapabilities({
    'printerly.nodes':'node',
    'printerly.jobs':'node',
  });
  const enabled=await createHttpRouteRegistry({runtime:{},config,cutoverCapabilities:nodeCaps});
  assert.deepEqual(enabled.describe().filter(route=>route.business).map(route=>route.name).sort(),expectedBusinessRoutes);
});
