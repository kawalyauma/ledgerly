import { CUTOVER_CAPABILITIES, createCutoverCapabilities } from './cutover-capabilities.mjs';

export const BUSINESS_ROUTE_AUTHORITY_POLICY=Object.freeze({
  'platform-modules':Object.freeze({capability:'platform.modules'}),
  'contacts-api':Object.freeze({capability:'contacts.core'}),
  'communications-api':Object.freeze({capability:'communications.core'}),
  'attendance-api':Object.freeze({capability:'attendance.core'}),
  'attendance-device':Object.freeze({capability:'attendance.core'}),
  'attendance-device-enrollment':Object.freeze({capability:'attendance.core'}),
  'academics-api':Object.freeze({capability:'academics.core'}),
  'school-setup':Object.freeze({capability:'school.reference.read'}),
  'school-student-management':Object.freeze({capability:'school.people.read'}),
  'school-files':Object.freeze({capability:'school.files'}),
  'human-resources-api':Object.freeze({capability:'human-resources.core'}),
  'printerly-legacy-node':Object.freeze({capability:'printerly.nodes'}),
  'printerly-jobs':Object.freeze({capability:'printerly.jobs'}),
  'printerly-documents':Object.freeze({capability:'printerly.jobs'}),
  'printerly-approvals':Object.freeze({capability:'printerly.jobs'}),
  'printerly-scannerly':Object.freeze({capability:'printerly.scanner'}),
  'printerly-scanners':Object.freeze({capability:'printerly.scanner'}),
  'printerly-scans':Object.freeze({capability:'printerly.scanner'}),
  'printerly-core':Object.freeze({capability:'printerly.core'}),
  'printerly-costing':Object.freeze({capability:'printerly.core'}),
  'printerly-nodes-admin':Object.freeze({capability:'printerly.core'}),
  'printerly-overview':Object.freeze({capability:'printerly.core'}),
  'printerly-printers-admin':Object.freeze({capability:'printerly.core'}),
  'printerly-reports':Object.freeze({capability:'printerly.core'}),
  'printerly-alerts':Object.freeze({capability:'printerly.alerts'}),
  'printerly-quotas':Object.freeze({capability:'printerly.governance'}),
  'printerly-rules':Object.freeze({capability:'printerly.governance'}),
  'printerly-batches-admin':Object.freeze({capability:'printerly.batch'}),
  'printerly-pools':Object.freeze({capability:'printerly.routing'}),
  'printerly-release-admin':Object.freeze({capability:'printerly.release'}),
  'printerly-retention':Object.freeze({capability:'printerly.retention'}),
  'printerly-supplies':Object.freeze({capability:'printerly.supplies'}),
  'printerly-procurement':Object.freeze({capability:'printerly.procurement'}),
  'printerly-service-desk':Object.freeze({capability:'printerly.service-desk'}),
  'printerly-audit':Object.freeze({capability:'printerly.audit'}),
  'printerly-audit-csv':Object.freeze({capability:'printerly.audit'}),
});

function normalizeMode(value){return String(value??'cloudflare').trim().toLowerCase();}
function combineModes(...values){const modes=values.map(normalizeMode);if(modes.includes('node'))return'node';if(modes.includes('shadow'))return'shadow';return'cloudflare';}

export function createHttpCutoverCapabilities(config,overrides={}){
  const printerly=config?.extensions?.printerly??{};
  const school=config?.extensions?.['school-platform']??{};
  const platformModules=config?.extensions?.['platform-modules']??{};
  const contacts=config?.extensions?.contacts??{};
  const communications=config?.extensions?.communications??{};
  const attendance=config?.extensions?.attendance??{};
  const academics=config?.extensions?.academics??{};
  const humanResources=config?.extensions?.['human-resources']??{};
  const fallback=normalizeMode(printerly.cutover);
  const surface=(value)=>normalizeMode(value??fallback);
  const core=surface(printerly.coreCutover);
  const governance=surface(printerly.governanceCutover);
  return createCutoverCapabilities({
    'platform.modules':normalizeMode(platformModules.cutover),
    'contacts.core':normalizeMode(contacts.cutover),
    'communications.core':normalizeMode(communications.cutover),
    'attendance.core':normalizeMode(attendance.cutover),
    'academics.core':normalizeMode(academics.cutover),
    'school.reference.read':normalizeMode(school.referenceReadCutover),
    'school.reference.write':normalizeMode(school.referenceWriteCutover),
    'school.people.read':normalizeMode(school.peopleReadCutover),
    'school.people.write':normalizeMode(school.peopleWriteCutover),
    'school.files':normalizeMode(school.filesCutover),
    'human-resources.core':normalizeMode(humanResources.cutover),
    'printerly.nodes':surface(printerly.nodeCutover),
    'printerly.jobs':normalizeMode(printerly.jobCutover),
    'printerly.scanner':surface(printerly.scannerCutover),
    'printerly.core':core,
    'printerly.governance':governance,
    'printerly.batch':surface(printerly.batchCutover),
    'printerly.routing':surface(printerly.routingCutover),
    'printerly.release':surface(printerly.releaseCutover),
    'printerly.retention':surface(printerly.retentionCutover),
    'printerly.supplies':surface(printerly.suppliesCutover),
    'printerly.procurement':surface(printerly.procurementCutover),
    'printerly.service-desk':surface(printerly.serviceDeskCutover),
    'printerly.audit':surface(printerly.auditCutover),
    'printerly.alerts':combineModes(core,governance),
    ...overrides,
  });
}

export function auditBusinessRouteAuthority(descriptors,{policy=BUSINESS_ROUTE_AUTHORITY_POLICY}={}){
  const byName=new Map((descriptors??[]).map(descriptor=>[descriptor.name,descriptor]));
  const business=(descriptors??[]).filter(descriptor=>descriptor.business===true);
  const unmapped=business.filter(descriptor=>!policy[descriptor.name]).map(descriptor=>descriptor.name).sort();
  const unknownCapabilities=[];
  const stalePolicy=[];
  const nonBusinessPolicy=[];
  for(const [routeName,entry] of Object.entries(policy)){
    const descriptor=byName.get(routeName);
    if(!descriptor)stalePolicy.push(routeName);
    else if(descriptor.business!==true)nonBusinessPolicy.push(routeName);
    if(!entry?.capability||!(entry.capability in CUTOVER_CAPABILITIES))unknownCapabilities.push({routeName,capability:entry?.capability??null});
  }
  return Object.freeze({
    ok:unmapped.length===0&&unknownCapabilities.length===0&&stalePolicy.length===0&&nonBusinessPolicy.length===0,
    businessRoutes:business.map(descriptor=>descriptor.name).sort(),
    unmapped,
    unknownCapabilities,
    stalePolicy:stalePolicy.sort(),
    nonBusinessPolicy:nonBusinessPolicy.sort(),
  });
}

export function assertBusinessRouteAuthorityCoverage(descriptors,options={}){
  const audit=auditBusinessRouteAuthority(descriptors,options);
  if(!audit.ok){
    const details=[];
    if(audit.unmapped.length)details.push(`unmapped=${audit.unmapped.join(',')}`);
    if(audit.unknownCapabilities.length)details.push(`unknownCapabilities=${audit.unknownCapabilities.map(item=>`${item.routeName}:${item.capability}`).join(',')}`);
    if(audit.stalePolicy.length)details.push(`stalePolicy=${audit.stalePolicy.join(',')}`);
    if(audit.nonBusinessPolicy.length)details.push(`nonBusinessPolicy=${audit.nonBusinessPolicy.join(',')}`);
    throw new Error(`Business route cutover authority policy is incomplete: ${details.join('; ')}`);
  }
  return audit;
}

export function resolveBusinessRouteAuthority(descriptor,capabilities,{policy=BUSINESS_ROUTE_AUTHORITY_POLICY}={}){
  if(descriptor.business!==true)return null;
  const entry=policy[descriptor.name];
  if(!entry)throw new Error(`Business route ${descriptor.name} has no cutover authority policy`);
  const state=capabilities.state(entry.capability);
  return Object.freeze({capability:entry.capability,state,nodeAuthoritative:state==='node'});
}
