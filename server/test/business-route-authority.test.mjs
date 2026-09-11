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
  'printerly-alerts',
  'printerly-approvals',
  'printerly-audit',
  'printerly-audit-csv',
  'printerly-batches-admin',
  'printerly-core',
  'printerly-costing',
  'printerly-documents',
  'printerly-jobs',
  'printerly-legacy-node',
  'printerly-nodes-admin',
  'printerly-overview',
  'printerly-pools',
  'printerly-printers-admin',
  'printerly-procurement',
  'printerly-quotas',
  'printerly-release-admin',
  'printerly-reports',
  'printerly-retention',
  'printerly-rules',
  'printerly-scannerly',
  'printerly-scanners',
  'printerly-scans',
  'printerly-service-desk',
  'printerly-supplies',
];

function printerlyConfig(state='node',overrides={}){
  return {extensions:{printerly:{
    cutover:state,
    nodeCutover:state,
    jobCutover:state,
    scannerCutover:state,
    coreCutover:state,
    governanceCutover:state,
    batchCutover:state,
    routingCutover:state,
    releaseCutover:state,
    retentionCutover:state,
    suppliesCutover:state,
    procurementCutover:state,
    serviceDeskCutover:state,
    auditCutover:state,
    ...overrides,
  }}};
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

test('HTTP capability state follows every granular Printerly extension cutover',()=>{
  const node=createHttpCutoverCapabilities(printerlyConfig('node'));
  for(const capability of [
    'printerly.nodes','printerly.jobs','printerly.scanner','printerly.core','printerly.governance','printerly.batch','printerly.routing','printerly.release','printerly.retention','printerly.supplies','printerly.procurement','printerly.service-desk','printerly.audit','printerly.alerts',
  ]) assert.equal(node.state(capability),'node',capability);

  const cloudflare=createHttpCutoverCapabilities(printerlyConfig('cloudflare'));
  for(const capability of Object.keys(cloudflare.all).filter(name=>name.startsWith('printerly.'))) assert.equal(cloudflare.state(capability),'cloudflare',capability);

  const mixed=createHttpCutoverCapabilities(printerlyConfig('cloudflare',{
    coreCutover:'shadow',
    governanceCutover:'node',
    scannerCutover:'shadow',
  }));
  assert.equal(mixed.state('printerly.core'),'shadow');
  assert.equal(mixed.state('printerly.governance'),'node');
  assert.equal(mixed.state('printerly.scanner'),'shadow');
  assert.equal(mixed.state('printerly.alerts'),'node');
});

test('legacy broad Printerly cutover does not implicitly claim the job API',()=>{
  const caps=createHttpCutoverCapabilities({extensions:{printerly:{cutover:'node'}}});
  assert.equal(caps.state('printerly.nodes'),'node');
  assert.equal(caps.state('printerly.core'),'node');
  assert.equal(caps.state('printerly.jobs'),'cloudflare');
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
  const config=printerlyConfig('node');
  const cloudflareOverrides=Object.fromEntries(Object.keys(createHttpCutoverCapabilities(config).all).filter(name=>name.startsWith('printerly.')).map(name=>[name,'cloudflare']));
  const cloudflareCaps=createCutoverCapabilities(cloudflareOverrides);
  const blocked=await createHttpRouteRegistry({runtime:{},config,cutoverCapabilities:cloudflareCaps});
  assert.equal(blocked.describe().some(route=>route.business),false);
  const blockedAuthority=blocked.describeAuthority();
  assert(blockedAuthority.blocked.some(route=>route.name==='printerly-core'&&route.reason==='not-node-authoritative'));
  assert(blockedAuthority.blocked.some(route=>route.name==='printerly-jobs'&&route.reason==='not-node-authoritative'));

  const nodeCaps=createHttpCutoverCapabilities(config);
  const enabled=await createHttpRouteRegistry({runtime:{},config,cutoverCapabilities:nodeCaps});
  assert.deepEqual(enabled.describe().filter(route=>route.business).map(route=>route.name).sort(),expectedBusinessRoutes);
});
