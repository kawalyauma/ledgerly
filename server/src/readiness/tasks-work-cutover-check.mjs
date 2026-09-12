import { loadConfig } from "../config.mjs";
import { createPostgresDatabase } from "../adapters/postgres-database.mjs";
import { TASKS_WORK_RELATIONSHIP_CHECKS } from "../migration/tasks-work-validators.mjs";

const required=[
  "organizations","users","memberships","contacts","contact_people","organization_modules",
  "work_teams","work_team_members","work_contacts","work_projects","work_project_members","work_sequences","work_tasks","work_task_assignees","work_task_followers",
  "work_task_checklist_items","work_comments","work_time_entries","work_notifications","work_notification_preferences","work_notification_deliveries","work_webhook_receipts","work_task_reminders",
  "work_chat_threads","work_chat_participants","work_chat_messages","work_recurrence_occurrences",
];

const config=loadConfig(process.env);const database=await createPostgresDatabase(config.database);
try{
  const existence=(await database.query(`SELECT ${required.map((name,index)=>`to_regclass('public.${name}') AS t${index}`).join(',')}`)).rows[0]??{};
  const missing=required.filter((_,index)=>!existence[`t${index}`]);
  const relationshipChecks=[];
  if(!missing.length){for(const check of TASKS_WORK_RELATIONSHIP_CHECKS){const row=(await database.query(check.sql)).rows[0]??{};const count=Number(row.count??Object.values(row)[0]??0);if(count!==0)relationshipChecks.push({name:check.name,count});}}
  const moduleRows=missing.includes("organization_modules")?[]:(await database.query(`SELECT organization_id FROM organization_modules WHERE module_key='tasks-work' AND enabled=true`)).rows;
  const ok=missing.length===0&&relationshipChecks.length===0;
  console.log(JSON.stringify({ok,provider:database.provider,requiredTables:required.length,missing,relationshipChecks,enabledOrganizations:moduleRows.length},null,2));
  if(!ok)process.exitCode=1;
}finally{await database.close();}
