#!/usr/bin/env node
import { createPostgresDatabase } from "../adapters/postgres-database.mjs";
import { createSchoolSetupService } from "./setup-service.mjs";

function required(name){const value=process.env[name];if(!value)throw new Error(`${name} is required`);return value;}
function int(name,fallback){const value=Number.parseInt(process.env[name]??String(fallback),10);if(!Number.isInteger(value)||value<1)throw new Error(`${name} must be a positive integer`);return value;}
function bool(value,fallback=false){if(value==null||value==="")return fallback;return ["1","true","yes","on"].includes(String(value).toLowerCase());}

const database=await createPostgresDatabase({
  host:process.env.LEDGERLY_DATABASE_HOST??"127.0.0.1",
  port:int("LEDGERLY_DATABASE_PORT",6432),
  database:process.env.LEDGERLY_DATABASE_NAME??"ledgerly",
  user:process.env.LEDGERLY_DATABASE_USER??"ledgerly",
  password:required("LEDGERLY_DATABASE_PASSWORD"),
  poolMax:2,
  connectionTimeoutMs:int("LEDGERLY_DEPENDENCY_TIMEOUT_MS",5000),
  idleTimeoutMs:30000,
  ssl:bool(process.env.LEDGERLY_DATABASE_SSL,false),
  sslRejectUnauthorized:!(["0","false","no","off"].includes(String(process.env.LEDGERLY_DATABASE_SSL_REJECT_UNAUTHORIZED??"true").toLowerCase())),
  applicationName:"ledgerly-school-cutover-validator",
});

try{
  const org=(await database.query(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`)).rows[0];
  if(!org?.id)throw new Error("No local organization exists. Create the rehearsal account before enabling School Management.");
  const service=createSchoolSetupService({database,auditService:{write:async()=>{}}});
  const resources=["branches","academicYears","terms","departments","classLevels","classes","streams","subjects","classSubjects","gradingScales","gradeBoundaries","divisions","assessmentTypes","promotionRules","calendar","lessonPeriods","feeCategories","paymentMethods","templates"];
  await service.profile(org.id);
  await service.bootstrapStatus(org.id);
  await service.settings(org.id);
  for(const key of resources)await service.list({organizationId:org.id,key,limit:1,offset:0});
  console.log(JSON.stringify({ok:true,organizationId:org.id,surface:"school-setup",resourcesValidated:resources.length},null,2));
}finally{await database.close();}
