import { loadConfig } from "../config.mjs";
import { createPostgresDatabase } from "../adapters/postgres-database.mjs";

const required=["app_modules","organization_modules","contacts","contact_addresses","contact_people","mobile_sync_record_versions","mobile_sync_changes","mobile_sync_tombstones"];
const config=loadConfig(process.env);
const database=await createPostgresDatabase(config.database);
try{
  const expressions=required.map((name,index)=>`to_regclass('public.${name}') AS t${index}`).join(',');
  const result=await database.query(`SELECT ${expressions}`);
  const row=result.rows[0]??{};
  const missing=required.filter((_,index)=>!row[`t${index}`]);
  const problems=[];
  let catalog={contacts:false,ledgerlyCore:false,mobileSync:false};
  if(!missing.length){
    const checks=await database.query(`SELECT
      (SELECT count(*) FROM contact_addresses a LEFT JOIN contacts c ON c.id=a.contact_id AND c.organization_id=a.organization_id WHERE c.id IS NULL) orphan_addresses,
      (SELECT count(*) FROM contact_people p LEFT JOIN contacts c ON c.id=p.contact_id AND c.organization_id=p.organization_id WHERE c.id IS NULL) orphan_people`);
    for(const [name,value] of Object.entries(checks.rows[0]??{}))if(Number(value)!==0)problems.push({name,count:Number(value)});
    const modules=await database.query("SELECT module_key,core,active FROM app_modules WHERE module_key=ANY($1::text[])",[["contacts","ledgerly-core","mobile-sync"]]);
    const byKey=new Map(modules.rows.map(item=>[item.module_key,item]));
    catalog={contacts:Boolean(byKey.get('contacts')?.core&&byKey.get('contacts')?.active),ledgerlyCore:Boolean(byKey.get('ledgerly-core')?.core&&byKey.get('ledgerly-core')?.active),mobileSync:Boolean(byKey.get('mobile-sync')?.core&&byKey.get('mobile-sync')?.active)};
    for(const [name,ok] of Object.entries(catalog))if(!ok)problems.push({name:`catalog_${name}`,count:1});
  }
  const ok=missing.length===0&&problems.length===0;
  console.log(JSON.stringify({ok,provider:database.provider,requiredTables:required.length,missing,catalog,relationshipChecks:problems},null,2));
  if(!ok)process.exitCode=1;
}finally{await database.close();}
