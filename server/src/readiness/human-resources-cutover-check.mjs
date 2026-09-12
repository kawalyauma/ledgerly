import { loadConfig } from "../config.mjs";
import { createPostgresDatabase } from "../adapters/postgres-database.mjs";

const required=["app_modules","organization_modules","contacts","mobile_sync_devices","hr_departments","hr_employees","hr_leave_types","hr_leave_requests","hr_onboarding_tasks","hr_mobile_leave_intents","hr_mobile_onboarding_intents"];
const config=loadConfig(process.env);
const database=await createPostgresDatabase(config.database);
try{
  const expressions=required.map((name,index)=>`to_regclass('public.${name}') AS t${index}`).join(',');
  const result=await database.query(`SELECT ${expressions}`);
  const row=result.rows[0]??{};
  const missing=required.filter((_,index)=>!row[`t${index}`]);
  const problems=[];
  let moduleCatalog=false;
  if(!missing.length){
    const checks=await database.query(`SELECT
      (SELECT count(*) FROM hr_employees e LEFT JOIN hr_departments d ON d.id=e.department_id AND d.organization_id=e.organization_id WHERE e.department_id IS NOT NULL AND d.id IS NULL) orphan_employee_departments,
      (SELECT count(*) FROM hr_employees e LEFT JOIN hr_employees m ON m.id=e.manager_employee_id AND m.organization_id=e.organization_id WHERE e.manager_employee_id IS NOT NULL AND m.id IS NULL) orphan_employee_managers,
      (SELECT count(*) FROM hr_leave_requests r LEFT JOIN hr_employees e ON e.id=r.employee_id AND e.organization_id=r.organization_id WHERE e.id IS NULL) orphan_leave_employees,
      (SELECT count(*) FROM hr_leave_requests r LEFT JOIN hr_leave_types t ON t.id=r.leave_type_id AND t.organization_id=r.organization_id WHERE t.id IS NULL) orphan_leave_types,
      (SELECT count(*) FROM hr_onboarding_tasks t LEFT JOIN hr_employees e ON e.id=t.employee_id AND e.organization_id=t.organization_id WHERE e.id IS NULL) orphan_onboarding_employees`);
    for(const [name,value] of Object.entries(checks.rows[0]??{}))if(Number(value)!==0)problems.push({name,count:Number(value)});
    moduleCatalog=Boolean((await database.query("SELECT 1 FROM app_modules WHERE module_key='human-resources' AND active=true LIMIT 1")).rows[0]);
    if(!moduleCatalog)problems.push({name:'human_resources_module_catalog',count:1});
  }
  const ok=missing.length===0&&problems.length===0;
  console.log(JSON.stringify({ok,provider:database.provider,requiredTables:required.length,missing,moduleCatalog,relationshipChecks:problems},null,2));
  if(!ok)process.exitCode=1;
}finally{await database.close();}
