import { readdir } from "node:fs/promises";
import {
  assertBusinessRouteAuthorityCoverage,
  createHttpCutoverCapabilities,
  resolveBusinessRouteAuthority,
} from "../runtime/business-route-authority.mjs";

const ROUTE_DIRECTORY = new URL("./routes/", import.meta.url);
const ROUTE_SUFFIX = ".route.mjs";
const RESERVED_PREFIXES = new Set(["/selfhost/health", "/selfhost/ready", "/selfhost/contracts"]);

function normalizePrefix(value, sourceFile, business=false, publicRoute=false) {
  const raw = String(value ?? "").trim().replace(/\/+$/, "");
  const validSelfhost=raw.startsWith('/selfhost/')&&raw!=='/selfhost';
  const validBusiness=business&&raw.startsWith('/api/v1/')&&raw!=='/api/v1';
  const validPublic=publicRoute&&(raw==='/auth'||raw.startsWith('/auth/'));
  if(!validSelfhost&&!validBusiness&&!validPublic)throw new TypeError(`HTTP route ${sourceFile} prefix must be below /selfhost/, an explicitly public /auth route, or explicitly opt into a /api/v1/ business route`);
  if (RESERVED_PREFIXES.has(raw)) throw new Error(`HTTP route ${sourceFile} may not own reserved prefix ${raw}`);
  return raw;
}

function normalizeDescriptor(descriptor, sourceFile) {
  if (!descriptor || typeof descriptor !== "object") throw new TypeError(`HTTP route ${sourceFile} must export an object`);
  const name = String(descriptor.name ?? "").trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new TypeError(`HTTP route ${sourceFile} has an invalid name`);
  if (typeof descriptor.handle !== "function") throw new TypeError(`HTTP route ${name} must define handle()`);
  if (descriptor.enabled != null && typeof descriptor.enabled !== "function") throw new TypeError(`HTTP route ${name} enabled must be a function`);
  const business=descriptor.business===true;
  const publicRoute=descriptor.public===true;
  if(business&&publicRoute)throw new TypeError(`HTTP route ${name} may not be both public and business`);
  return Object.freeze({name,prefix:normalizePrefix(descriptor.prefix,sourceFile,business,publicRoute),business,public:publicRoute,priority:Number.isFinite(descriptor.priority)?Number(descriptor.priority):0,enabled:descriptor.enabled??(()=>true),handle:descriptor.handle,sourceFile});
}

async function discoverDescriptors() {
  const entries = (await readdir(ROUTE_DIRECTORY)).filter((name) => name.endsWith(ROUTE_SUFFIX)).sort((a, b) => a.localeCompare(b));
  const descriptors = [],names=new Set(),prefixes=new Set();
  for (const entry of entries) {const module=await import(new URL(`./routes/${entry}`,import.meta.url));const descriptor=normalizeDescriptor(module.default??module.route,entry);if(names.has(descriptor.name))throw new Error(`Duplicate HTTP route name: ${descriptor.name}`);if(prefixes.has(descriptor.prefix))throw new Error(`Duplicate HTTP route prefix: ${descriptor.prefix}`);names.add(descriptor.name);prefixes.add(descriptor.prefix);descriptors.push(descriptor);}
  return descriptors.sort((a,b)=>b.priority-a.priority||b.prefix.length-a.prefix.length||a.name.localeCompare(b.name));
}
const DESCRIPTORS=await discoverDescriptors();
const AUTHORITY_AUDIT=assertBusinessRouteAuthorityCoverage(DESCRIPTORS);
function pathMatches(prefix,pathname){return pathname===prefix||pathname.startsWith(`${prefix}/`);}
function normalizeResult(result,routeName){if(!result||typeof result!=='object')throw new TypeError(`HTTP route ${routeName} must return a response object`);const status=Number(result.status??200);if(!Number.isInteger(status)||status<100||status>599)throw new TypeError(`HTTP route ${routeName} returned an invalid status`);if(result.headers!=null&&(typeof result.headers!=='object'||Array.isArray(result.headers)))throw new TypeError(`HTTP route ${routeName} headers must be an object`);if(result.rawBody!=null&&!Buffer.isBuffer(result.rawBody)&&!(result.rawBody instanceof Uint8Array))throw new TypeError(`HTTP route ${routeName} rawBody must be bytes`);return{status,body:result.body??null,rawBody:result.rawBody??null,headers:result.headers??{}};}
export function listHttpRouteDescriptors(){return DESCRIPTORS.map(({name,prefix,business,public:publicRoute,priority,sourceFile})=>({name,prefix,business,public:publicRoute,priority,sourceFile}));}
export function getBusinessRouteAuthorityAudit(){return AUTHORITY_AUDIT;}
export async function createHttpRouteRegistry({runtime,config,cutoverCapabilities=createHttpCutoverCapabilities(config)}){
  const active=[];
  const blocked=[];
  for(const descriptor of DESCRIPTORS){
    const featureEnabled=await descriptor.enabled(config);
    const authority=resolveBusinessRouteAuthority(descriptor,cutoverCapabilities);
    if(!featureEnabled){blocked.push({name:descriptor.name,prefix:descriptor.prefix,business:descriptor.business,public:descriptor.public,reason:'feature-disabled',authority});continue;}
    if(authority&&!authority.nodeAuthoritative){blocked.push({name:descriptor.name,prefix:descriptor.prefix,business:true,public:false,reason:'not-node-authoritative',authority});continue;}
    active.push(Object.freeze({...descriptor,authority}));
  }
  return Object.freeze({
    describe(){return active.map(({name,prefix,business,public:publicRoute,priority,sourceFile,authority})=>({name,prefix,business,public:publicRoute,priority,sourceFile,authority}));},
    describeAuthority(){return{audit:AUTHORITY_AUDIT,capabilities:cutoverCapabilities.all,blocked:[...blocked]};},
    async dispatch({request,url,requestId}){const route=active.find(descriptor=>pathMatches(descriptor.prefix,url.pathname));if(!route)return null;const result=await route.handle({request,url,requestId,runtime,config});return normalizeResult(result,route.name);}
  });
}
