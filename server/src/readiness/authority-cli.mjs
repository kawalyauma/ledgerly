#!/usr/bin/env node
import { loadConfig } from '../config.mjs';
import {
  BUSINESS_ROUTE_AUTHORITY_POLICY,
  createHttpCutoverCapabilities,
  resolveBusinessRouteAuthority,
} from '../runtime/business-route-authority.mjs';

async function main(){
  const config=loadConfig();
  const {getBusinessRouteAuthorityAudit,listHttpRouteDescriptors}=await import('../http/routes.mjs');
  const audit=getBusinessRouteAuthorityAudit();
  const capabilities=createHttpCutoverCapabilities(config);
  const businessRoutes=listHttpRouteDescriptors()
    .filter(route=>route.business)
    .map(route=>({
      name:route.name,
      prefix:route.prefix,
      sourceFile:route.sourceFile,
      ...resolveBusinessRouteAuthority(route,capabilities),
    }))
    .sort((a,b)=>a.name.localeCompare(b.name));
  const report={
    ok:audit.ok===true,
    checkedAt:new Date().toISOString(),
    audit,
    businessRoutes,
    capabilities:capabilities.all,
    policy:BUSINESS_ROUTE_AUTHORITY_POLICY,
  };
  console.log(JSON.stringify(report,null,2));
  if(!report.ok)process.exitCode=2;
}

main().catch(error=>{
  console.error(JSON.stringify({
    ok:false,
    component:'cutover-authority',
    message:error instanceof Error?error.message:String(error),
  }));
  process.exitCode=1;
});
