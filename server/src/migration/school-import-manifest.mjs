function table({name,columns,conflict,dependencies=[]}){return Object.freeze({name,columns:Object.freeze(columns),conflict:Object.freeze(conflict),dependencies:Object.freeze(dependencies),transform(row){const next={};for(const c of columns)next[c]=row[c]??null;return next;}});}
export const SCHOOL_IMPORT_TABLES=Object.freeze([
 table({name:"school_import_jobs",columns:["id","organization_id","import_type","file_name","object_key","mapping_json","options_json","status","total_rows","valid_rows","invalid_rows","processed_rows","errors_json","created_by","completed_at","created_at","updated_at"],conflict:["id"],dependencies:["organizations","users"]}),
]);
