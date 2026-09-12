const SCHOOL_MANAGEMENT_MANIFEST=Object.freeze({
  backendModules:['setup','iam','student-management'],
  accountingIntegration:true,
});
const ACADEMICS_MANIFEST=Object.freeze({
  requiresModules:['school-management'],
  features:['timetables','schemes','lesson-plans','lesson-delivery','supervision','record-inspection'],
  examsExclusive:true,
});

export async function ensureAcademicsModuleCatalog(database){
  await database.query(
    `INSERT INTO app_modules(module_key,name,version,description,category,core,manifest_json,active)
     VALUES
       ('school-management','School Management','1.0.0','Professional multi-campus school administration integrated with Ledgerly accounting.','education',false,$1,true),
       ('academics','Academics','1.0.0','Teaching operations for timetables, schemes, lesson planning, delivery and academic supervision.','education',false,$2,true)
     ON CONFLICT(module_key) DO NOTHING`,
    [JSON.stringify(SCHOOL_MANAGEMENT_MANIFEST),JSON.stringify(ACADEMICS_MANIFEST)],
  );
}
