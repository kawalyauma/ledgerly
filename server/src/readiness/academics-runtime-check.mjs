const baseUrl=String(process.env.LEDGERLY_SELFHOST_BASE_URL||'http://127.0.0.1:8788').replace(/\/+$/,'');
const expectedCollections=Object.freeze([
  'scheduling',
  'schemes',
  'scheme-items',
  'templates',
  'lesson-plans',
  'deliveries',
  'supervision',
  'actions',
]);

const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));

async function fetchContracts(){
  let lastError=null;
  for(let attempt=1;attempt<=45;attempt+=1){
    try{
      const response=await fetch(`${baseUrl}/selfhost/contracts`,{headers:{accept:'application/json'}});
      if(response.ok)return response.json();
      lastError=new Error(`self-hosted contracts probe returned HTTP ${response.status}`);
    }catch(error){
      lastError=error;
    }
    await sleep(1000);
  }
  throw lastError??new Error('self-hosted API did not become ready');
}

const contracts=await fetchContracts();
const academics=contracts?.extensions?.academics??null;
const schoolPlatform=contracts?.extensions?.['school-platform']??null;
const mobileSync=contracts?.extensions?.['mobile-sync']??null;
const routes=Array.isArray(contracts?.httpRoutes)?contracts.httpRoutes:[];
const academicsRoute=routes.find(route=>route?.name==='academics-api')??null;
const schoolFilesRoute=routes.find(route=>route?.name==='school-files')??null;
const mobileSyncRoute=routes.find(route=>route?.name==='mobile-sync')??null;
const collections=Array.isArray(mobileSync?.collections)?mobileSync.collections:[];
const academicsCollections=collections.filter(item=>item?.moduleKey==='academics');
const collectionKeys=new Set(academicsCollections.map(item=>item.collectionKey));
const missingCollections=expectedCollections.filter(key=>!collectionKeys.has(key));
const extraCollections=[...collectionKeys].filter(key=>!expectedCollections.includes(key)).sort();

const checks=Object.freeze({
  academicsExtensionLoaded:Boolean(academics),
  academicsNodeAuthoritative:academics?.cutover==='node',
  academicsRouteActive:Boolean(academicsRoute),
  academicsRouteNodeAuthoritative:academicsRoute?.authority?.state==='node',
  schoolPlatformExtensionLoaded:Boolean(schoolPlatform),
  schoolFilesRouteActive:Boolean(schoolFilesRoute),
  schoolFilesRouteNodeAuthoritative:schoolFilesRoute?.authority?.state==='node',
  mobileSyncExtensionLoaded:Boolean(mobileSync),
  mobileSyncProviderReady:mobileSync?.provider==='postgresql-mobile-sync',
  mobileSyncRouteActive:Boolean(mobileSyncRoute),
  mobileSyncCollectionsComplete:missingCollections.length===0&&academicsCollections.length===expectedCollections.length,
  mobileSyncLimitsValid:Number(mobileSync?.maxPush)>0&&Number(mobileSync?.maxPull)>0,
});
const ok=Object.values(checks).every(Boolean);

console.log(JSON.stringify({
  ok,
  baseUrl,
  checks,
  academicsCutover:academics?.cutover??null,
  academicsRouteAuthority:academicsRoute?.authority??null,
  schoolFilesRouteAuthority:schoolFilesRoute?.authority??null,
  mobileSyncProvider:mobileSync?.provider??null,
  mobileSyncMaxPush:mobileSync?.maxPush??null,
  mobileSyncMaxPull:mobileSync?.maxPull??null,
  academicsCollections:academicsCollections.map(item=>item.collectionKey).sort(),
  expectedCollections,
  missingCollections,
  extraCollections,
},null,2));

if(!ok)process.exitCode=1;
