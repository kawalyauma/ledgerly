import { CUTOVER_CAPABILITIES, createCutoverCapabilities } from './cutover-capabilities.mjs';

export const BUSINESS_ROUTE_AUTHORITY_POLICY=Object.freeze({
  'printerly-legacy-node':Object.freeze({capability:'printerly.nodes'}),
  'printerly-jobs':Object.freeze({capability:'printerly.jobs'}),
  'printerly-documents':Object.freeze({capability:'printerly.jobs'}),
  'printerly-approvals':Object.freeze({capability:'printerly.jobs'}),
  'security-camera-selfhost':Object.freeze({capability:'nvr.metadata'}),
});

function normalizeMode(value){return String(value??'cloudflare').trim().toLowerCase();}
function aggregateNvrMode(camera={}){
  const states=['applianceCutover','deviceCutover','viewerCutover','managementCutover'].map(key=>normalizeMode(camera?.[key]));
  if(states.includes('node'))return 'node';
  if(states.includes('shadow'))return 'shadow';
  return 'cloudflare';
}

export function createHttpCutoverCapabilities(config,overrides={}){
  const printerly=config?.extensions?.printerly??{};
  const camera=config?.extensions?.['security-camera']??{};
  return createCutoverCapabilities({
    'printerly.nodes':normalizeMode(printerly.cutover),
    'printerly.jobs':normalizeMode(printerly.jobCutover),
    'nvr.metadata':aggregateNvrMode(camera),
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
