import { randomUUID } from "node:crypto";

function fail(status, code, message, details) {
  throw Object.assign(new Error(message), { status, code, details });
}

function id(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function parseJson(value, fallback = {}) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function camelizeRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row ?? {})) {
    const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (key.endsWith("_json")) out[camel.replace(/Json$/, "")] = parseJson(value, {});
    else out[camel] = value;
  }
  return out;
}

function boundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Math.max(min, Math.min(Number.isFinite(parsed) ? parsed : fallback, max));
}

const SPECS = Object.freeze({
  branches:{table:"school_branches",prefix:"brn",columns:{code:"code",name:"name",registrationNumber:"registration_number",phone:"phone",email:"email",physicalAddress:"physical_address",postalAddress:"postal_address",districtRegion:"district_region",locationText:"location_text",principalName:"principal_name",isMain:"is_main",active:"active"},bool:new Set(["isMain","active"]),order:"is_main DESC,name"},
  academicYears:{table:"school_academic_years",prefix:"acy",columns:{code:"code",name:"name",startsOn:"starts_on",endsOn:"ends_on",status:"status",isCurrent:"is_current"},bool:new Set(["isCurrent"]),order:"starts_on DESC"},
  terms:{table:"school_terms",prefix:"trm",columns:{academicYearId:"academic_year_id",code:"code",name:"name",sequenceNo:"sequence_no",startsOn:"starts_on",endsOn:"ends_on",status:"status",isCurrent:"is_current"},bool:new Set(["isCurrent"]),order:"starts_on DESC"},
  departments:{table:"school_departments",prefix:"dep",columns:{campusId:"campus_id",code:"code",name:"name",description:"description",headUserId:"head_user_id",parentId:"parent_id",active:"active"},bool:new Set(["active"]),order:"name"},
  classLevels:{table:"school_class_levels",prefix:"lvl",columns:{code:"code",name:"name",sequenceNo:"sequence_no",educationLevel:"education_level",promotionLevelId:"promotion_level_id",terminal:"terminal",active:"active"},bool:new Set(["terminal","active"]),order:"sequence_no"},
  classes:{table:"school_classes",prefix:"cls",columns:{academicYearId:"academic_year_id",campusId:"campus_id",classLevelId:"class_level_id",departmentId:"department_id",code:"code",name:"name",capacity:"capacity",classTeacherUserId:"class_teacher_user_id",active:"active"},bool:new Set(["active"]),order:"name"},
  streams:{table:"school_streams",prefix:"str",columns:{classId:"class_id",campusId:"campus_id",code:"code",name:"name",capacity:"capacity",classTeacherUserId:"class_teacher_user_id",active:"active"},bool:new Set(["active"]),order:"name"},
  subjects:{table:"school_subjects",prefix:"sub",columns:{departmentId:"department_id",code:"code",name:"name",shortName:"short_name",subjectType:"subject_type",curriculumCode:"curriculum_code",passMark:"pass_mark",maxMark:"max_mark",active:"active",metadata:"metadata_json"},json:new Set(["metadata"]),bool:new Set(["active"]),order:"name"},
  classSubjects:{table:"school_class_subjects",prefix:"csu",columns:{classLevelId:"class_level_id",subjectId:"subject_id",academicYearId:"academic_year_id",compulsory:"compulsory",periodsPerWeek:"periods_per_week",teacherUserId:"teacher_user_id",active:"active"},bool:new Set(["compulsory","active"]),order:"created_at"},
  gradingScales:{table:"school_grading_scales",prefix:"grs",columns:{code:"code",name:"name",curriculum:"curriculum",isDefault:"is_default",active:"active"},bool:new Set(["isDefault","active"]),order:"is_default DESC,name"},
  gradeBoundaries:{table:"school_grade_boundaries",prefix:"grb",columns:{gradingScaleId:"grading_scale_id",grade:"grade",minScore:"min_score",maxScore:"max_score",points:"points",aggregatePoints:"aggregate_points",remark:"remark",colorHex:"color_hex",sequenceNo:"sequence_no"},order:"sequence_no,min_score DESC"},
  divisions:{table:"school_divisions",prefix:"div",columns:{gradingScaleId:"grading_scale_id",code:"code",name:"name",minAggregate:"min_aggregate",maxAggregate:"max_aggregate",minSubjects:"min_subjects",rule:"rule_json",sequenceNo:"sequence_no",active:"active"},json:new Set(["rule"]),bool:new Set(["active"]),order:"sequence_no,name"},
  assessmentTypes:{table:"school_assessment_types",prefix:"ast",columns:{code:"code",name:"name",weightPercent:"weight_percent",maxScore:"max_score",sequenceNo:"sequence_no",active:"active"},bool:new Set(["active"]),order:"sequence_no,name"},
  promotionRules:{table:"school_promotion_rules",prefix:"prm",columns:{classLevelId:"class_level_id",name:"name",minimumAverage:"minimum_average",maximumFailedSubjects:"maximum_failed_subjects",minimumAttendancePercent:"minimum_attendance_percent",targetClassLevelId:"target_class_level_id",allowManualOverride:"allow_manual_override",rule:"rule_json",active:"active"},json:new Set(["rule"]),bool:new Set(["allowManualOverride","active"]),order:"name"},
  calendar:{table:"school_calendar_events",prefix:"cal",columns:{campusId:"campus_id",academicYearId:"academic_year_id",termId:"term_id",eventType:"event_type",title:"title",description:"description",startsAt:"starts_at",endsAt:"ends_at",allDay:"all_day",teachingDay:"teaching_day",recurrenceRule:"recurrence_rule"},bool:new Set(["allDay","teachingDay"]),order:"starts_at"},
  lessonPeriods:{table:"school_lesson_periods",prefix:"lsp",columns:{campusId:"campus_id",code:"code",name:"name",sequenceNo:"sequence_no",startsAt:"starts_at",endsAt:"ends_at",periodType:"period_type",teachingPeriod:"teaching_period",active:"active"},bool:new Set(["teachingPeriod","active"]),order:"sequence_no"},
  feeCategories:{table:"school_fee_categories",prefix:"fee",columns:{code:"code",name:"name",description:"description",incomeAccountId:"income_account_id",receivableAccountId:"receivable_account_id",productId:"product_id",taxable:"taxable",taxCode:"tax_code",refundable:"refundable",mandatory:"mandatory",active:"active",metadata:"metadata_json"},json:new Set(["metadata"]),bool:new Set(["taxable","refundable","mandatory","active"]),order:"name"},
  paymentMethods:{table:"school_payment_methods",prefix:"pmt",columns:{code:"code",name:"name",methodType:"method_type",accountId:"account_id",configuration:"configuration_json",active:"active"},json:new Set(["configuration"]),bool:new Set(["active"]),order:"name"},
  templates:{table:"school_document_templates",prefix:"tpl",columns:{campusId:"campus_id",templateType:"template_type",name:"name",fileId:"file_id",version:"version",content:"content_json",isDefault:"is_default",active:"active"},json:new Set(["content"]),bool:new Set(["isDefault","active"]),order:"template_type,name,version DESC"},
});

const LEVELS = [
  ["BABY","Baby Class",1,"nursery","MIDDLE",false],["MIDDLE","Middle Class",2,"nursery","TOP",false],["TOP","Top Class",3,"nursery","P1",false],
  ["P1","Primary One",10,"primary","P2",false],["P2","Primary Two",11,"primary","P3",false],["P3","Primary Three",12,"primary","P4",false],
  ["P4","Primary Four",13,"primary","P5",false],["P5","Primary Five",14,"primary","P6",false],["P6","Primary Six",15,"primary","P7",false],["P7","Primary Seven",16,"primary",null,true],
];
const SUBJECTS = [["ENG","English","English"],["MATH","Mathematics","Math"],["SCI","Science","Science"],["SST","Social Studies","SST"],["CRE","Christian Religious Education","CRE"],["IRE","Islamic Religious Education","IRE"],["LUGANDA","Luganda","Luganda"]];

function dbValue(spec, key, value) {
  if (spec.json?.has(key)) return JSON.stringify(value ?? {});
  if (spec.bool?.has(key)) return Boolean(value);
  return value === undefined ? null : value;
}

async function audit(auditService, principal, requestId, action, entityType, entityId, after, before = null) {
  await auditService.write({organizationId:principal.organizationId,actorType:"human",actorId:principal.userId,action,entityType,entityId,before,after,requestId});
}

async function ensureUniqueCurrent(database, spec, organizationId, record) {
  if ((spec.table === "school_academic_years" || spec.table === "school_terms") && record.isCurrent === true) {
    await database.query(`UPDATE ${spec.table} SET is_current=false,updated_at=now() WHERE organization_id=$1`, [organizationId]);
  }
  if (spec.table === "school_grading_scales" && record.isDefault === true) {
    await database.query(`UPDATE school_grading_scales SET is_default=false,updated_at=now() WHERE organization_id=$1`, [organizationId]);
  }
  if (spec.table === "school_document_templates" && record.isDefault === true && record.templateType) {
    await database.query(`UPDATE school_document_templates SET is_default=false,updated_at=now() WHERE organization_id=$1 AND template_type=$2`, [organizationId, record.templateType]);
  }
}

export class SchoolSetupService {
  constructor({ database, auditService }) { this.database=database; this.auditService=auditService; }

  async profile(organizationId) {
    const result=await this.database.query(`SELECT sp.*,o.name AS school_name,o.legal_name,f.original_name AS logo_file_name FROM school_profiles sp JOIN organizations o ON o.id=sp.organization_id LEFT JOIN school_files f ON f.id=sp.logo_file_id AND f.organization_id=sp.organization_id WHERE sp.organization_id=$1`,[organizationId]);
    return result.rows[0] ? camelizeRow(result.rows[0]) : null;
  }

  async saveProfile({ principal, requestId, value }) {
    if (!value?.schoolCode) fail(422,"VALIDATION_ERROR","School code is required");
    if (value.logoFileId) {
      const owned=await this.database.query(`SELECT 1 FROM school_files WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`,[value.logoFileId,principal.organizationId]);
      if (!owned.rowCount) fail(422,"INVALID_LOGO_FILE","The selected school logo upload does not belong to this school or has been deleted");
    }
    const v={schoolType:"day",phoneNumbers:[],emailAddresses:[],country:"Uganda",language:"en",timezone:"Africa/Kampala",dateFormat:"DD/MM/YYYY",timeFormat:"24h",defaultCurrency:"UGX",multiCampusEnabled:false,branding:{},systemPreferences:{},...value};
    await this.database.query(`INSERT INTO school_profiles (organization_id,school_code,registration_number,logo_url,logo_file_id,motto,school_type,ownership_type,education_level,curriculum,phone_numbers_json,email_addresses_json,website,physical_address,postal_address,country,district_region,location_text,head_teacher_name,head_teacher_phone,head_teacher_email,language,timezone,date_format,time_format,default_currency,multi_campus_enabled,branding_json,system_preferences_json)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
      ON CONFLICT(organization_id) DO UPDATE SET school_code=excluded.school_code,registration_number=excluded.registration_number,logo_url=excluded.logo_url,logo_file_id=excluded.logo_file_id,motto=excluded.motto,school_type=excluded.school_type,ownership_type=excluded.ownership_type,education_level=excluded.education_level,curriculum=excluded.curriculum,phone_numbers_json=excluded.phone_numbers_json,email_addresses_json=excluded.email_addresses_json,website=excluded.website,physical_address=excluded.physical_address,postal_address=excluded.postal_address,country=excluded.country,district_region=excluded.district_region,location_text=excluded.location_text,head_teacher_name=excluded.head_teacher_name,head_teacher_phone=excluded.head_teacher_phone,head_teacher_email=excluded.head_teacher_email,language=excluded.language,timezone=excluded.timezone,date_format=excluded.date_format,time_format=excluded.time_format,default_currency=excluded.default_currency,multi_campus_enabled=excluded.multi_campus_enabled,branding_json=excluded.branding_json,system_preferences_json=excluded.system_preferences_json,updated_at=now()`,[
      principal.organizationId,v.schoolCode,v.registrationNumber??null,v.logoUrl??null,v.logoFileId??null,v.motto??null,v.schoolType,v.ownershipType??null,v.educationLevel??null,v.curriculum??null,JSON.stringify(v.phoneNumbers??[]),JSON.stringify(v.emailAddresses??[]),v.website??null,v.physicalAddress??null,v.postalAddress??null,v.country,v.districtRegion??null,v.locationText??null,v.headTeacherName??null,v.headTeacherPhone??null,v.headTeacherEmail??null,v.language,v.timezone,v.dateFormat,v.timeFormat,v.defaultCurrency,Boolean(v.multiCampusEnabled),JSON.stringify(v.branding??{}),JSON.stringify(v.systemPreferences??{})]);
    await audit(this.auditService,principal,requestId,"school.profile.updated","school_profile",principal.organizationId,v);
    return this.profile(principal.organizationId);
  }

  spec(key) { const spec=SPECS[key]; if (!spec) fail(404,"SCHOOL_SETUP_RESOURCE_NOT_FOUND","Unknown school setup resource"); return spec; }

  async list({ organizationId, key, limit=100, offset=0 }) {
    const spec=this.spec(key), boundedLimit=boundedInt(limit,100,1,500), boundedOffset=boundedInt(offset,0,0,1_000_000);
    const result=await this.database.query(`SELECT * FROM ${spec.table} WHERE organization_id=$1 ORDER BY ${spec.order} LIMIT $2 OFFSET $3`,[organizationId,boundedLimit,boundedOffset]);
    return result.rows.map(camelizeRow);
  }

  async get({ organizationId, key, recordId }) {
    const spec=this.spec(key), result=await this.database.query(`SELECT * FROM ${spec.table} WHERE id=$1 AND organization_id=$2`,[recordId,organizationId]);
    if (!result.rowCount) fail(404,"NOT_FOUND",`${key} record not found`);
    return camelizeRow(result.rows[0]);
  }

  async create({ principal, requestId, key, record }) {
    const spec=this.spec(key); if (!record || typeof record!=="object") fail(422,"VALIDATION_ERROR","A configuration record is required");
    await ensureUniqueCurrent(this.database,spec,principal.organizationId,record);
    const entries=Object.entries(spec.columns).filter(([name])=>Object.prototype.hasOwnProperty.call(record,name));
    if (!entries.length) fail(422,"VALIDATION_ERROR","No supported fields were supplied");
    const recordId=id(spec.prefix), columns=entries.map(([,column])=>column), values=entries.map(([name])=>dbValue(spec,name,record[name]));
    const placeholders=values.map((_,index)=>`$${index+3}`);
    const extraColumns=key==="templates"?["created_by"]:[], extraValues=key==="templates"?[principal.userId]:[];
    const allColumns=[...columns,...extraColumns],allValues=[...values,...extraValues],allPlaceholders=allValues.map((_,index)=>`$${index+3}`);
    try { await this.database.query(`INSERT INTO ${spec.table} (id,organization_id,${allColumns.join(",")}) VALUES ($1,$2,${allPlaceholders.join(",")})`,[recordId,principal.organizationId,...allValues]); }
    catch (error) { if (String(error?.code)==="23505") fail(409,"DUPLICATE_RECORD","That school setup value is already in use"); throw error; }
    await audit(this.auditService,principal,requestId,`school.${key}.created`,spec.table,recordId,record);
    return this.get({organizationId:principal.organizationId,key,recordId});
  }

  async update({ principal, requestId, key, recordId, record }) {
    const spec=this.spec(key); if (!record || typeof record!=="object") fail(422,"VALIDATION_ERROR","Changes are required");
    const before=await this.get({organizationId:principal.organizationId,key,recordId});
    await ensureUniqueCurrent(this.database,spec,principal.organizationId,record);
    const entries=Object.entries(spec.columns).filter(([name])=>Object.prototype.hasOwnProperty.call(record,name));
    if (!entries.length) fail(422,"VALIDATION_ERROR","No supported changes were supplied");
    const values=entries.map(([name])=>dbValue(spec,name,record[name])), sets=entries.map(([,column],index)=>`${column}=$${index+1}`);
    try { const result=await this.database.query(`UPDATE ${spec.table} SET ${sets.join(",")},updated_at=now() WHERE id=$${values.length+1} AND organization_id=$${values.length+2}`,[...values,recordId,principal.organizationId]); if (!result.rowCount) fail(404,"NOT_FOUND",`${key} record not found`); }
    catch (error) { if (String(error?.code)==="23505") fail(409,"DUPLICATE_RECORD","That school setup value is already in use"); throw error; }
    const after=await this.get({organizationId:principal.organizationId,key,recordId});
    await audit(this.auditService,principal,requestId,`school.${key}.updated`,spec.table,recordId,after,before);
    return after;
  }

  async remove({ principal, requestId, key, recordId }) {
    const spec=this.spec(key), before=await this.get({organizationId:principal.organizationId,key,recordId});
    try { const result=await this.database.query(`DELETE FROM ${spec.table} WHERE id=$1 AND organization_id=$2`,[recordId,principal.organizationId]); if (!result.rowCount) fail(404,"NOT_FOUND",`${key} record not found`); }
    catch (error) { if (String(error?.code)==="23503") fail(409,"RECORD_IN_USE","This configuration record is already in use and cannot be deleted"); throw error; }
    await audit(this.auditService,principal,requestId,`school.${key}.deleted`,spec.table,recordId,null,before);
  }

  async settings(organizationId) {
    const result=await this.database.query(`SELECT setting_group,setting_key,value_json,updated_at FROM school_settings WHERE organization_id=$1 ORDER BY setting_group,setting_key`,[organizationId]);
    return result.rows.map(row=>({group:row.setting_group,key:row.setting_key,value:parseJson(row.value_json,null),updatedAt:row.updated_at}));
  }

  async saveSetting({ principal, requestId, value }) {
    if (!value?.group || !value?.key) fail(422,"VALIDATION_ERROR","Setting group and key are required");
    await this.database.query(`INSERT INTO school_settings (organization_id,setting_group,setting_key,value_json,updated_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(organization_id,setting_group,setting_key) DO UPDATE SET value_json=excluded.value_json,updated_by=excluded.updated_by,updated_at=now()`,[principal.organizationId,value.group,value.key,JSON.stringify(value.value),principal.userId]);
    await audit(this.auditService,principal,requestId,"school.setting.updated","school_setting",`${value.group}:${value.key}`,value);
    return value;
  }

  async bootstrapStatus(organizationId) {
    const tables={profile:"school_profiles",academicYear:"school_academic_years",term:"school_terms",classLevels:"school_class_levels",subjects:"school_subjects",feeCategories:"school_fee_categories",roles:"school_roles"};
    const status={}; for (const [key,table] of Object.entries(tables)) { const r=await this.database.query(`SELECT COUNT(*)::int AS count FROM ${table} WHERE organization_id=$1`,[organizationId]); status[key]=Number(r.rows[0]?.count??0)>0; }
    const countTables={academicYears:"school_academic_years",terms:"school_terms",classLevels:"school_class_levels",classes:"school_classes",subjects:"school_subjects",classSubjects:"school_class_subjects",feeCategories:"school_fee_categories",paymentMethods:"school_payment_methods",offenceTypes:"school_discipline_offence_types"};
    const counts={}; for (const [key,table] of Object.entries(countTables)) { const r=await this.database.query(`SELECT COUNT(*)::int AS count FROM ${table} WHERE organization_id=$1`,[organizationId]); counts[key]=Number(r.rows[0]?.count??0); }
    const accounts=await this.database.query(`SELECT COUNT(*)::int AS count FROM accounts WHERE organization_id=$1 AND (subtype='school_fee' OR name='School Fees Receivable')`,[organizationId]).catch(()=>({rows:[{count:0}]}));
    counts.schoolAccounts=Number(accounts.rows[0]?.count??0);
    return {...status,complete:Object.values(status).every(Boolean),smartDefaults:{version:1,currentYear:new Date().getUTCFullYear(),counts}};
  }

  async ensureDefaults({ principal, requestId }) {
    const orgResult=await this.database.query(`SELECT name,base_currency FROM organizations WHERE id=$1`,[principal.organizationId]);
    if (!orgResult.rowCount) fail(404,"ORGANIZATION_NOT_FOUND","Organization not found");
    const org=orgResult.rows[0], year=new Date().getUTCFullYear(), month=new Date().getUTCMonth()+1, created={};
    const bump=(key)=>created[key]=(created[key]??0)+1;
    await this.database.transaction(async(tx)=>{
      const profile=await tx.query(`SELECT 1 FROM school_profiles WHERE organization_id=$1`,[principal.organizationId]);
      if(!profile.rowCount){let code=`SCH-${principal.organizationId.replace(/[^A-Za-z0-9]/g,"").slice(-8).toUpperCase()}`;await tx.query(`INSERT INTO school_profiles(organization_id,school_code,school_type,education_level,curriculum,country,language,timezone,date_format,time_format,default_currency,phone_numbers_json,email_addresses_json,branding_json,system_preferences_json) VALUES ($1,$2,'day','nursery_primary','Uganda Nursery & Primary','Uganda','en','Africa/Kampala','DD/MM/YYYY','24h',$3,'[]','[]','{}','{}') ON CONFLICT(organization_id) DO NOTHING`,[principal.organizationId,code,org.base_currency||"UGX"]);bump("profile");}
      let main=(await tx.query(`SELECT id FROM school_branches WHERE organization_id=$1 AND (is_main=true OR code='MAIN') ORDER BY is_main DESC LIMIT 1`,[principal.organizationId])).rows[0];
      if(!main){main={id:id("brn")};await tx.query(`INSERT INTO school_branches(id,organization_id,code,name,is_main,active) VALUES ($1,$2,'MAIN','Main Campus',true,true)`,[main.id,principal.organizationId]);bump("branches");}
      let yr=(await tx.query(`SELECT id FROM school_academic_years WHERE organization_id=$1 AND code=$2`,[principal.organizationId,String(year)])).rows[0];
      if(!yr){yr={id:id("acy")};await tx.query(`UPDATE school_academic_years SET is_current=false WHERE organization_id=$1`,[principal.organizationId]);await tx.query(`INSERT INTO school_academic_years(id,organization_id,code,name,starts_on,ends_on,status,is_current) VALUES ($1,$2,$3,$3,$4,$5,'active',true)`,[yr.id,principal.organizationId,String(year),`${year}-01-01`,`${year}-12-31`]);bump("academicYears");}
      const currentSeq=month<=4?1:month<=8?2:3; for(const term of [{code:"T1",name:"Term 1",seq:1,start:`${year}-01-01`,end:`${year}-04-30`},{code:"T2",name:"Term 2",seq:2,start:`${year}-05-01`,end:`${year}-08-31`},{code:"T3",name:"Term 3",seq:3,start:`${year}-09-01`,end:`${year}-12-31`}]){const exists=await tx.query(`SELECT 1 FROM school_terms WHERE organization_id=$1 AND academic_year_id=$2 AND code=$3`,[principal.organizationId,yr.id,term.code]);if(!exists.rowCount){await tx.query(`INSERT INTO school_terms(id,organization_id,academic_year_id,code,name,sequence_no,starts_on,ends_on,status,is_current) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[id("trm"),principal.organizationId,yr.id,term.code,term.name,term.seq,term.start,term.end,term.seq<currentSeq?"closed":term.seq===currentSeq?"active":"planned",term.seq===currentSeq]);bump("terms");}}
      const levelIds=new Map(); for(const [code,name,sequence,education,next,terminal] of LEVELS){let row=(await tx.query(`SELECT id FROM school_class_levels WHERE organization_id=$1 AND code=$2`,[principal.organizationId,code])).rows[0];if(!row){row={id:id("lvl")};await tx.query(`INSERT INTO school_class_levels(id,organization_id,code,name,sequence_no,education_level,terminal,active) VALUES ($1,$2,$3,$4,$5,$6,$7,true)`,[row.id,principal.organizationId,code,name,sequence,education,terminal]);bump("classLevels");}levelIds.set(code,row.id);}
      for(const [code,,,,next] of LEVELS){if(next)await tx.query(`UPDATE school_class_levels SET promotion_level_id=COALESCE(promotion_level_id,$1),updated_at=now() WHERE id=$2 AND organization_id=$3`,[levelIds.get(next),levelIds.get(code),principal.organizationId]);}
      const subjectIds=new Map(); for(const [code,name,shortName] of SUBJECTS){let row=(await tx.query(`SELECT id FROM school_subjects WHERE organization_id=$1 AND code=$2`,[principal.organizationId,code])).rows[0];if(!row){row={id:id("sub")};await tx.query(`INSERT INTO school_subjects(id,organization_id,code,name,short_name,subject_type,pass_mark,max_mark,active,metadata_json) VALUES ($1,$2,$3,$4,$5,'compulsory',50,100,true,$6)`,[row.id,principal.organizationId,code,name,shortName,JSON.stringify({source:"ledgerly-smart-defaults",country:"Uganda"})]);bump("subjects");}subjectIds.set(code,row.id);}
      for(const [code,name] of [["admin","School Administrator"],["teacher","Teacher"],["bursar","Bursar / Accounts"],["student","Student"],["guardian","Guardian"]]){const exists=await tx.query(`SELECT 1 FROM school_roles WHERE organization_id=$1 AND code=$2`,[principal.organizationId,code]);if(!exists.rowCount){await tx.query(`INSERT INTO school_roles(id,organization_id,code,name,role_category,system_role,active,created_by) VALUES ($1,$2,$3,$4,'builtin',true,true,$5)`,[id("rol"),principal.organizationId,code,name,principal.userId]);bump("roles");}}
      for(const [code,name,mandatory] of [["TUITION","Tuition Fees",true],["ADMISSION","Admission Fees",false],["REGISTRATION","Registration Fees",false],["MEALS","Meals / Feeding",false],["TRANSPORT","Transport Fees",false],["EXAM","Examination Fees",false]]){const exists=await tx.query(`SELECT 1 FROM school_fee_categories WHERE organization_id=$1 AND code=$2`,[principal.organizationId,code]);if(!exists.rowCount){await tx.query(`INSERT INTO school_fee_categories(id,organization_id,code,name,mandatory,active,metadata_json) VALUES ($1,$2,$3,$4,$5,true,$6)`,[id("fee"),principal.organizationId,code,name,mandatory,JSON.stringify({source:"ledgerly-smart-defaults"})]);bump("feeCategories");}}
      for(const [code,name,type] of [["CASH","Cash","cash"],["BANK","Bank Transfer / Deposit","bank"],["MOMO","Mobile Money","mobile_money"],["CHEQUE","Cheque","cheque"]]){const exists=await tx.query(`SELECT 1 FROM school_payment_methods WHERE organization_id=$1 AND code=$2`,[principal.organizationId,code]);if(!exists.rowCount){await tx.query(`INSERT INTO school_payment_methods(id,organization_id,code,name,method_type,configuration_json,active) VALUES ($1,$2,$3,$4,$5,$6,true)`,[id("pmt"),principal.organizationId,code,name,type,JSON.stringify({source:"ledgerly-smart-defaults"})]);bump("paymentMethods");}}
      const settings=[["student_format",{prefix:"STD-",width:5,year:true}],["admission_format",{prefix:"ADM-",width:5,year:true}],["application_format",{prefix:"APP-",width:5,year:true}],["staff_format",{prefix:"STF-",width:4,year:true}]];for(const [key,value] of settings)await tx.query(`INSERT INTO school_settings(organization_id,setting_group,setting_key,value_json,updated_by) VALUES ($1,'numbering',$2,$3,$4) ON CONFLICT DO NOTHING`,[principal.organizationId,key,JSON.stringify(value),principal.userId]);
    });
    await audit(this.auditService,principal,requestId,"school.smart_defaults.restored","school_setup",principal.organizationId,created);
    return {changed:Object.values(created).some(v=>v>0),version:1,currentYear:year,created};
  }

  async closeTerm({ principal, requestId, termId }) {
    const termResult=await this.database.query(`SELECT * FROM school_terms WHERE id=$1 AND organization_id=$2`,[termId,principal.organizationId]); if(!termResult.rowCount)fail(404,"NOT_FOUND","Term not found"); const term=termResult.rows[0]; if(term.status==="closed")fail(409,"TERM_ALREADY_CLOSED","This term is already closed");
    const next=(await this.database.query(`SELECT id,name FROM school_terms WHERE organization_id=$1 AND academic_year_id=$2 AND sequence_no>$3 AND status<>'closed' ORDER BY sequence_no LIMIT 1`,[principal.organizationId,term.academic_year_id,term.sequence_no])).rows[0]??null;
    await this.database.transaction(async tx=>{await tx.query(`UPDATE school_terms SET status='closed',is_current=false,updated_at=now() WHERE id=$1 AND organization_id=$2`,[termId,principal.organizationId]);if(next){await tx.query(`UPDATE school_terms SET is_current=false WHERE organization_id=$1`,[principal.organizationId]);await tx.query(`UPDATE school_terms SET status='active',is_current=true,updated_at=now() WHERE id=$1 AND organization_id=$2`,[next.id,principal.organizationId]);}});
    const students=await this.database.query(`SELECT COUNT(*)::int count FROM school_students WHERE organization_id=$1 AND current_academic_year_id=$2 AND status='active' AND deleted_at IS NULL`,[principal.organizationId,term.academic_year_id]).catch(()=>({rows:[{count:0}]}));
    const impact={activeStudents:Number(students.rows[0]?.count??0),postedJournalEntries:0,outstandingFeesMinor:0,financeAccountsChanged:0,studentPlacementsChanged:0,nextTerm:next?.name??null};
    await audit(this.auditService,principal,requestId,"school.term.closed","school_term",termId,impact);
    return {id:termId,status:"closed",impact};
  }
}

export function createSchoolSetupService(input){return new SchoolSetupService(input);}
