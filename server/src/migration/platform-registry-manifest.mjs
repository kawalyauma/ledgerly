import {migrationTable} from './shared-manifest-utils.mjs';
export const PLATFORM_REGISTRY_TABLES=Object.freeze([
 migrationTable({name:'app_modules',columns:['module_key','name','version','description','category','core','manifest_json','active','created_at','updated_at'],conflict:['module_key'],booleans:['core','active']}),
 migrationTable({name:'organization_modules',columns:['organization_id','module_key','enabled','configuration_json','enabled_by','enabled_at','disabled_at','created_at','updated_at'],conflict:['organization_id','module_key'],booleans:['enabled'],dependencies:['organizations','app_modules','users']})
]);
