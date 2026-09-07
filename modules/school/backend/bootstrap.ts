import { createId } from "../../../src/lib/ids";
import { ensureBuiltinSchoolRoles } from "./iam";
import { ensureAccount, ensureFeeAccounting, provisionCategory } from "./fees/common";

const SMART_DEFAULTS_VERSION = 3;

// Ledgerly School is intentionally nursery + primary only.
const LEVELS = [
  {code:"BABY",name:"Baby Class",sequence:1,education:"nursery",next:"MIDDLE",terminal:0},
  {code:"MIDDLE",name:"Middle Class",sequence:2,education:"nursery",next:"TOP",terminal:0},
  {code:"TOP",name:"Top Class",sequence:3,education:"nursery",next:"P1",terminal:0},
  {code:"P1",name:"Primary One",sequence:10,education:"primary",next:"P2",terminal:0},
  {code:"P2",name:"Primary Two",sequence:11,education:"primary",next:"P3",terminal:0},
  {code:"P3",name:"Primary Three",sequence:12,education:"primary",next:"P4",terminal:0},
  {code:"P4",name:"Primary Four",sequence:13,education:"primary",next:"P5",terminal:0},
  {code:"P5",name:"Primary Five",sequence:14,education:"primary",next:"P6",terminal:0},
  {code:"P6",name:"Primary Six",sequence:15,education:"primary",next:"P7",terminal:0},
  {code:"P7",name:"Primary Seven",sequence:16,education:"primary",next:null,terminal:1},
] as const;

const SUBJECTS = [
  ["LA1","Learning Area 1","LA 1","compulsory"],
  ["LA2","Learning Area 2","LA 2","compulsory"],
  ["LA3","Learning Area 3","LA 3","compulsory"],
  ["LA4","Learning Area 4","LA 4","compulsory"],
  ["LA5","Learning Area 5","LA 5","compulsory"],
  ["LA6","Learning Area 6","LA 6","compulsory"],
  ["ENG","English","English","compulsory"],
  ["MATH","Mathematics","Math","compulsory"],
  ["SCI","Science","Science","compulsory"],
  ["SST","Social Studies","SST","compulsory"],
  ["CRE","Christian Religious Education","CRE","optional"],
  ["IRE","Islamic Religious Education","IRE","optional"],
  ["LUGANDA","Luganda","Luganda","compulsory"],
] as const;

const NURSERY_SUBJECTS = ["LA1","LA2","LA3","LA4","LA5","LA6"] as const;
const PRIMARY_SUBJECTS: Array<[string, boolean]> = [
  ["ENG",true],["MATH",true],["SCI",true],["SST",true],
  ["CRE",false],["IRE",false],["LUGANDA",true],
];

const LEVEL_SUBJECTS: Record<string, Array<[string, boolean, null]>> = {
  BABY:NURSERY_SUBJECTS.map(code=>[code,true,null]),
  MIDDLE:NURSERY_SUBJECTS.map(code=>[code,true,null]),
  TOP:NURSERY_SUBJECTS.map(code=>[code,true,null]),
  P1:PRIMARY_SUBJECTS.map(([code,required])=>[code,required,null]),
  P2:PRIMARY_SUBJECTS.map(([code,required])=>[code,required,null]),
  P3:PRIMARY_SUBJECTS.map(([code,required])=>[code,required,null]),
  P4:PRIMARY_SUBJECTS.map(([code,required])=>[code,required,null]),
  P5:PRIMARY_SUBJECTS.map(([code,required])=>[code,required,null]),
  P6:PRIMARY_SUBJECTS.map(([code,required])=>[code,required,null]),
  P7:PRIMARY_SUBJECTS.map(([code,required])=>[code,required,null]),
};

const FEE_CATEGORIES = [
  ["TUITION","Tuition Fees","Core tuition / school fees",1,"4100","Tuition Fees Revenue"],
  ["ADMISSION","Admission Fees","Admission and new learner processing fees",0,"4110","Admission & Registration Fees Revenue"],
  ["REGISTRATION","Registration Fees","Registration and re-registration fees",0,"4110","Admission & Registration Fees Revenue"],
  ["BOARDING","Boarding Fees","Boarding and residence fees",0,"4120","Boarding Fees Revenue"],
  ["MEALS","Meals / Feeding","Meals and feeding programme fees",0,"4130","Meals Revenue"],
  ["TRANSPORT","Transport Fees","School transport fees",0,"4140","Transport Fees Revenue"],
  ["EXAM","Examination Fees","Internal and external examination charges",0,"4150","Examination Fees Revenue"],
  ["UNIFORM","Uniform & Materials","Uniforms, stationery and learning materials",0,"4160","Uniform & Learning Materials Revenue"],
  ["ACTIVITY","Activities & Sports","Co-curricular, sports and activity charges",0,"4170","Activities & Sports Revenue"],
  ["DEVELOPMENT","Development Levy","School development and infrastructure levy",0,"4180","Development Levy Revenue"],
  ["ICT","ICT / Computer Fees","Computer laboratory and ICT programme fees",0,"4190","ICT & Computer Fees Revenue"],
  ["MEDICAL","Medical Fees","School health and medical programme fees",0,"4195","Medical Fees Revenue"],
  ["LIBRARY","Library Fees","Library and reading programme fees",0,"4196","Library Fees Revenue"],
] as const;

const OFFENCE_TYPES = [
  ["LATE","Late coming","attendance","low",-1,"Warning / counselling"],
  ["ABSENCE","Absence without permission","attendance","medium",-2,"Parent / guardian follow-up"],
  ["UNIFORM","Uniform violation","conduct","low",-1,"Warning"],
  ["DISRESPECT","Disrespect / insubordination","conduct","medium",-3,"Counselling and warning"],
  ["FIGHTING","Fighting","safety","high",-5,"Disciplinary review"],
  ["BULLYING","Bullying / harassment","safety","high",-5,"Safeguarding and disciplinary review"],
  ["DAMAGE","Damage to school property","property","high",-5,"Restitution and disciplinary review"],
  ["DISHONESTY","Academic dishonesty","academic","medium",-3,"Academic disciplinary review"],
] as const;

function datesForYear(year:number){return {start:`${year}-01-01`,end:`${year}-12-31`};}
function termsForYear(year:number){return [
  {code:"T1",name:"Term 1",seq:1,start:`${year}-01-01`,end:`${year}-04-30`},
  {code:"T2",name:"Term 2",seq:2,start:`${year}-05-01`,end:`${year}-08-31`},
  {code:"T3",name:"Term 3",seq:3,start:`${year}-09-01`,end:`${year}-12-31`},
];}
function currentTermSequence(month:number){return month<=4?1:month<=8?2:3;}
async function runBatched(db:D1Database,statements:D1PreparedStatement[]){for(let i=0;i<statements.length;i+=50)await db.batch(statements.slice(i,i+50));}

async function saveSetting(db:D1Database,org:string,key:string,value:unknown,userId?:string|null){await db.prepare(`INSERT INTO school_settings(organization_id,setting_group,setting_key,value_json,updated_by) VALUES (?,'system',?,?,?) ON CONFLICT(organization_id,setting_group,setting_key) DO UPDATE SET value_json=excluded.value_json,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`).bind(org,key,JSON.stringify(value),userId??null).run();}

export async function ensureSchoolDefaults(db:D1Database,organizationId:string,userId?:string|null,options:{force?:boolean}={}){
  const now=new Date(), currentYear=now.getUTCFullYear();
  const saved=await db.prepare("SELECT setting_key AS key,value_json AS value FROM school_settings WHERE organization_id=? AND setting_group='system' AND setting_key IN ('smart_defaults_version','smart_defaults_year')").bind(organizationId).all<{key:string;value:string}>();
  const savedMap=new Map(saved.results.map(x=>[x.key,x.value]));
  if(!options.force&&Number(JSON.parse(savedMap.get("smart_defaults_version")||"0"))>=SMART_DEFAULTS_VERSION&&Number(JSON.parse(savedMap.get("smart_defaults_year")||"0"))===currentYear)return {changed:false,version:SMART_DEFAULTS_VERSION,currentYear};
  const org=await db.prepare("SELECT name,base_currency AS currency FROM organizations WHERE id=?").bind(organizationId).first<{name:string;currency:string}>();
  if(!org)throw new Error("Organization not found");
  const created:Record<string,number>={};
  const bump=(key:string,n=1)=>created[key]=(created[key]||0)+n;

  // Minimal official profile: only defaults that are safe to infer. Users can edit all of them later.
  if(!await db.prepare("SELECT 1 FROM school_profiles WHERE organization_id=?").bind(organizationId).first()){
    let schoolCode=`SCH-${organizationId.replace(/[^A-Za-z0-9]/g,"").slice(-8).toUpperCase()}`;
    let suffix=1; while(await db.prepare("SELECT 1 FROM school_profiles WHERE school_code=?").bind(schoolCode).first())schoolCode=`${schoolCode.slice(0,50)}-${suffix++}`;
    await db.prepare(`INSERT INTO school_profiles(organization_id,school_code,school_type,education_level,curriculum,country,language,timezone,date_format,time_format,default_currency,phone_numbers_json,email_addresses_json,branding_json,system_preferences_json) VALUES (?,?,'day','nursery_primary','Uganda Nursery & Primary','Uganda','en','Africa/Kampala','DD/MM/YYYY','24h',?,'[]','[]','{}','{}')`).bind(organizationId,schoolCode,org.currency||"UGX").run(); bump("profile");
  }

  let main=await db.prepare("SELECT id FROM school_branches WHERE organization_id=? AND (is_main=1 OR code='MAIN') ORDER BY is_main DESC LIMIT 1").bind(organizationId).first<{id:string}>();
  if(!main){const id=createId("brn");await db.prepare("INSERT INTO school_branches(id,organization_id,code,name,is_main,active) VALUES (?,?,'MAIN','Main Campus',1,1)").bind(id,organizationId).run();main={id};bump("branches");}

  const departments=[
    ["ACADEMIC","Academics","Teaching, learning and academic administration"],
    ["ADMIN","Administration","General administration and school operations"],
    ["FINANCE","Finance & Accounts","Fees, accounting and financial administration"],
    ["WELFARE","Student Welfare","Student welfare, guidance and pastoral care"],
  ] as const;
  const existingDepartments=await db.prepare("SELECT id,code FROM school_departments WHERE organization_id=?").bind(organizationId).all<{id:string;code:string}>();
  const departmentIds=new Map(existingDepartments.results.map(r=>[r.code,r.id])),departmentInserts:D1PreparedStatement[]=[];
  for(const [code,name,description] of departments)if(!departmentIds.has(code)){const id=createId("dep");departmentIds.set(code,id);departmentInserts.push(db.prepare("INSERT INTO school_departments(id,organization_id,campus_id,code,name,description,active) VALUES (?,?,?,?,?,?,1)").bind(id,organizationId,main.id,code,name,description));bump("departments");}
  await runBatched(db,departmentInserts); const academicDeptId=departmentIds.get("ACADEMIC")??null;

  const startYear=2023,endYear=Math.max(2025,currentYear+1),yearIds=new Map<number,string>();
  const existingCurrentYear=await db.prepare("SELECT id,code FROM school_academic_years WHERE organization_id=? AND is_current=1 LIMIT 1").bind(organizationId).first<{id:string;code:string}>();
  const existingYears=await db.prepare("SELECT id,code FROM school_academic_years WHERE organization_id=?").bind(organizationId).all<{id:string;code:string}>(),existingYearMap=new Map(existingYears.results.map(r=>[r.code,r.id])),yearInserts:D1PreparedStatement[]=[];
  for(let year=startYear;year<=endYear;year++){let id=existingYearMap.get(String(year));if(!id){id=createId("acy");const d=datesForYear(year),isCurrent=!existingCurrentYear&&year===currentYear,status=year<currentYear?"closed":year===currentYear?"active":"planned";yearInserts.push(db.prepare("INSERT INTO school_academic_years(id,organization_id,code,name,starts_on,ends_on,status,is_current) VALUES (?,?,?,?,?,?,?,?)").bind(id,organizationId,String(year),String(year),d.start,d.end,status,isCurrent?1:0));bump("academicYears");}yearIds.set(year,id);}
  await runBatched(db,yearInserts);
  const currentYearRow=await db.prepare("SELECT id,code FROM school_academic_years WHERE organization_id=? AND is_current=1 LIMIT 1").bind(organizationId).first<{id:string;code:string}>();
  if(!currentYearRow){const yid=yearIds.get(currentYear);if(yid)await db.batch([db.prepare("UPDATE school_academic_years SET is_current=0 WHERE organization_id=?").bind(organizationId),db.prepare("UPDATE school_academic_years SET is_current=1,status='active',updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(yid,organizationId)]);}

  const existingCurrentTerm=await db.prepare("SELECT id FROM school_terms WHERE organization_id=? AND is_current=1 LIMIT 1").bind(organizationId).first<{id:string}>(),currentSeq=currentTermSequence(now.getUTCMonth()+1);
  const existingTerms=await db.prepare("SELECT academic_year_id AS yearId,code FROM school_terms WHERE organization_id=?").bind(organizationId).all<{yearId:string;code:string}>(),termKeys=new Set(existingTerms.results.map(r=>`${r.yearId}:${r.code}`)),termInserts:D1PreparedStatement[]=[];
  for(let year=startYear;year<=endYear;year++){const yid=yearIds.get(year)!;for(const term of termsForYear(year)){const key=`${yid}:${term.code}`;if(termKeys.has(key))continue;const isCurrent=!existingCurrentTerm&&year===currentYear&&term.seq===currentSeq,status=year<currentYear||year===currentYear&&term.seq<currentSeq?"closed":year===currentYear&&term.seq===currentSeq?"active":"planned";termInserts.push(db.prepare("INSERT INTO school_terms(id,organization_id,academic_year_id,code,name,sequence_no,starts_on,ends_on,status,is_current) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(createId("trm"),organizationId,yid,term.code,term.name,term.seq,term.start,term.end,status,isCurrent?1:0));bump("terms");}}
  await runBatched(db,termInserts);

  const existingLevels=await db.prepare("SELECT id,code FROM school_class_levels WHERE organization_id=?").bind(organizationId).all<{id:string;code:string}>(),levelIds=new Map(existingLevels.results.map(r=>[r.code,r.id])),levelInserts:D1PreparedStatement[]=[];
  for(const level of LEVELS)if(!levelIds.has(level.code)){const id=createId("lvl");levelIds.set(level.code,id);levelInserts.push(db.prepare("INSERT INTO school_class_levels(id,organization_id,code,name,sequence_no,education_level,terminal,active) VALUES (?,?,?,?,?,?,?,1)").bind(id,organizationId,level.code,level.name,level.sequence,level.education,level.terminal));bump("classLevels");}
  await runBatched(db,levelInserts);
  await runBatched(db,LEVELS.filter(level=>level.next).map(level=>db.prepare("UPDATE school_class_levels SET promotion_level_id=COALESCE(promotion_level_id,?),updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(levelIds.get(level.next!)!,levelIds.get(level.code)!,organizationId)));

  const existingClasses=await db.prepare("SELECT academic_year_id AS yearId,class_level_id AS levelId FROM school_classes WHERE organization_id=?").bind(organizationId).all<{yearId:string|null;levelId:string}>(),classKeys=new Set(existingClasses.results.filter(r=>r.yearId).map(r=>`${r.yearId}:${r.levelId}`)),classInserts:D1PreparedStatement[]=[];
  for(let year=startYear;year<=endYear;year++)for(const level of LEVELS){const yid=yearIds.get(year)!,lid=levelIds.get(level.code)!,key=`${yid}:${lid}`;if(classKeys.has(key))continue;classInserts.push(db.prepare("INSERT INTO school_classes(id,organization_id,academic_year_id,campus_id,class_level_id,department_id,code,name,active) VALUES (?,?,?,?,?,?,?,?,1)").bind(createId("cls"),organizationId,yid,main.id,lid,academicDeptId,`${level.code}-${year}`,`${level.name} ${year}`));bump("classes");}
  await runBatched(db,classInserts);

  const existingSubjects=await db.prepare("SELECT id,code FROM school_subjects WHERE organization_id=?").bind(organizationId).all<{id:string;code:string}>(),subjectIds=new Map(existingSubjects.results.map(r=>[r.code,r.id])),subjectInserts:D1PreparedStatement[]=[];
  for(const [code,name,shortName,type] of SUBJECTS)if(!subjectIds.has(code)){const id=createId("sub");subjectIds.set(code,id);subjectInserts.push(db.prepare("INSERT INTO school_subjects(id,organization_id,department_id,code,name,short_name,subject_type,pass_mark,max_mark,active,metadata_json) VALUES (?,?,?,?,?,?,?,50,100,1,?)").bind(id,organizationId,academicDeptId,code,name,shortName,type,JSON.stringify({source:"ledgerly-smart-defaults",country:"Uganda"})));bump("subjects");}
  await runBatched(db,subjectInserts);
  const existingClassSubjects=await db.prepare("SELECT class_level_id AS levelId,subject_id AS subjectId FROM school_class_subjects WHERE organization_id=? AND academic_year_id IS NULL").bind(organizationId).all<{levelId:string;subjectId:string}>(),classSubjectKeys=new Set(existingClassSubjects.results.map(r=>`${r.levelId}:${r.subjectId}`)),classSubjectInserts:D1PreparedStatement[]=[];
  for(const level of LEVELS)for(const [subjectCode,compulsory,periods] of LEVEL_SUBJECTS[level.code]||[]){const lid=levelIds.get(level.code)!,sid=subjectIds.get(subjectCode)!,key=`${lid}:${sid}`;if(classSubjectKeys.has(key))continue;classSubjectInserts.push(db.prepare("INSERT INTO school_class_subjects(id,organization_id,class_level_id,subject_id,academic_year_id,compulsory,periods_per_week,active) VALUES (?,?,?,?,NULL,?,?,1)").bind(createId("csu"),organizationId,lid,sid,compulsory?1:0,periods));bump("classSubjects");}
  await runBatched(db,classSubjectInserts);

  await ensureBuiltinSchoolRoles(db,organizationId,userId);
  await ensureFeeAccounting(db,organizationId);
  const revenueAccountIds=new Map<string,string>();
  for(const [, , , ,code,name] of FEE_CATEGORIES){const key=`${code}:${name}`;if(!revenueAccountIds.has(key))revenueAccountIds.set(key,await ensureAccount(db,organizationId,{code,name,type:"revenue",subtype:"school_fee",normalBalance:"credit",currency:org.currency||"UGX"}));}
  const existingFees=await db.prepare("SELECT id,code,income_account_id AS incomeAccountId FROM school_fee_categories WHERE organization_id=?").bind(organizationId).all<{id:string;code:string;incomeAccountId:string|null}>(),feeMap=new Map(existingFees.results.map(r=>[r.code,r])),feeInserts:D1PreparedStatement[]=[];
  for(const [code,name,description,mandatory,accountCode,accountName] of FEE_CATEGORIES)if(!feeMap.has(code)){const id=createId("fct"),incomeAccountId=revenueAccountIds.get(`${accountCode}:${accountName}`)!;feeMap.set(code,{id,code,incomeAccountId});feeInserts.push(db.prepare("INSERT INTO school_fee_categories(id,organization_id,code,name,description,income_account_id,mandatory,active,metadata_json) VALUES (?,?,?,?,?,?,?,1,?)").bind(id,organizationId,code,name,description,incomeAccountId,mandatory,JSON.stringify({source:"ledgerly-smart-defaults"})));bump("feeCategories");}
  await runBatched(db,feeInserts);
  for(const [code,,,,accountCode,accountName] of FEE_CATEGORIES){const row=feeMap.get(code)!,accountId=revenueAccountIds.get(`${accountCode}:${accountName}`)!;if(!row.incomeAccountId)await db.prepare("UPDATE school_fee_categories SET income_account_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(accountId,row.id,organizationId).run();await provisionCategory(db,organizationId,row.id);}
  await ensureAccount(db,organizationId,{code:"2300",name:"Advance School Fees / Unearned Revenue",type:"liability",subtype:"unearned_revenue",normalBalance:"credit",currency:org.currency||"UGX"});
  const mobileMoneyAccount=await ensureAccount(db,organizationId,{code:"1020",name:"Mobile Money Wallet",type:"asset",subtype:"cash",normalBalance:"debit",currency:org.currency||"UGX"});
  const cashAccount=await db.prepare("SELECT id FROM accounts WHERE organization_id=? AND subtype='cash' AND active=1 ORDER BY code LIMIT 1").bind(organizationId).first<{id:string}>();
  const paymentMethods=[
    ["CASH","Cash","cash",cashAccount?.id??null],
    ["BANK","Bank Transfer / Deposit","bank",cashAccount?.id??null],
    ["MOMO","Mobile Money","mobile_money",mobileMoneyAccount],
    ["CHEQUE","Cheque","cheque",cashAccount?.id??null],
  ] as const;
  const existingPayments=await db.prepare("SELECT code FROM school_payment_methods WHERE organization_id=?").bind(organizationId).all<{code:string}>(),paymentCodes=new Set(existingPayments.results.map(r=>r.code)),paymentInserts:D1PreparedStatement[]=[];
  for(const [code,name,type,accountId] of paymentMethods)if(!paymentCodes.has(code)){paymentInserts.push(db.prepare("INSERT INTO school_payment_methods(id,organization_id,code,name,method_type,account_id,configuration_json,active) VALUES (?,?,?,?,?,?,?,1)").bind(createId("pmt"),organizationId,code,name,type,accountId,JSON.stringify({source:"ledgerly-smart-defaults"})));bump("paymentMethods");}
  await runBatched(db,paymentInserts);

  const existingOffences=await db.prepare("SELECT code FROM school_discipline_offence_types WHERE organization_id=?").bind(organizationId).all<{code:string}>(),offenceCodes=new Set(existingOffences.results.map(r=>r.code)),offenceInserts:D1PreparedStatement[]=[];
  for(const [code,name,category,severity,points,action] of OFFENCE_TYPES)if(!offenceCodes.has(code)){offenceInserts.push(db.prepare("INSERT INTO school_discipline_offence_types(id,organization_id,code,name,category,default_severity,default_points,default_action,active) VALUES (?,?,?,?,?,?,?,?,1)").bind(createId("dof"),organizationId,code,name,category,severity,points,action));bump("offenceTypes");}
  await runBatched(db,offenceInserts);

  const defaultSettings:[string,unknown][]=[
    ["student_format",{prefix:"STD-",width:5,year:true}],
    ["admission_format",{prefix:"ADM-",width:5,year:true}],
    ["application_format",{prefix:"APP-",width:5,year:true}],
    ["staff_format",{prefix:"STF-",width:4,year:true}],
    ["fee_invoice_format",{prefix:"SFI-",width:6,year:true}],
    ["fee_receipt_format",{prefix:"RCPT-",width:6,year:true}],
  ];
  await runBatched(db,defaultSettings.map(([key,value])=>db.prepare("INSERT OR IGNORE INTO school_settings(organization_id,setting_group,setting_key,value_json,updated_by) VALUES (?,'numbering',?,?,?)").bind(organizationId,key,JSON.stringify(value),userId??null)));
  await saveSetting(db,organizationId,"smart_defaults_version",SMART_DEFAULTS_VERSION,userId);
  await saveSetting(db,organizationId,"smart_defaults_year",currentYear,userId);
  await saveSetting(db,organizationId,"smart_defaults_country","Uganda",userId);
  return {changed:Object.values(created).some(v=>v>0),version:SMART_DEFAULTS_VERSION,currentYear,academicYears:`${startYear}-${endYear}`,created};
}

export async function schoolDefaultsStatus(db:D1Database,organizationId:string){
  const currentYear=new Date().getUTCFullYear();
  const [years,terms,levels,classes,subjects,classSubjects,fees,payments,accounts,offences]=await Promise.all([
    db.prepare("SELECT COUNT(*) AS n FROM school_academic_years WHERE organization_id=?").bind(organizationId).first<{n:number}>(),
    db.prepare("SELECT COUNT(*) AS n FROM school_terms WHERE organization_id=?").bind(organizationId).first<{n:number}>(),
    db.prepare("SELECT COUNT(*) AS n FROM school_class_levels WHERE organization_id=?").bind(organizationId).first<{n:number}>(),
    db.prepare("SELECT COUNT(*) AS n FROM school_classes WHERE organization_id=?").bind(organizationId).first<{n:number}>(),
    db.prepare("SELECT COUNT(*) AS n FROM school_subjects WHERE organization_id=?").bind(organizationId).first<{n:number}>(),
    db.prepare("SELECT COUNT(*) AS n FROM school_class_subjects WHERE organization_id=?").bind(organizationId).first<{n:number}>(),
    db.prepare("SELECT COUNT(*) AS n FROM school_fee_categories WHERE organization_id=?").bind(organizationId).first<{n:number}>(),
    db.prepare("SELECT COUNT(*) AS n FROM school_payment_methods WHERE organization_id=?").bind(organizationId).first<{n:number}>(),
    db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE organization_id=? AND (subtype='school_fee' OR name='School Fees Receivable')").bind(organizationId).first<{n:number}>(),
    db.prepare("SELECT COUNT(*) AS n FROM school_discipline_offence_types WHERE organization_id=?").bind(organizationId).first<{n:number}>(),
  ]);
  return {version:SMART_DEFAULTS_VERSION,currentYear,counts:{academicYears:Number(years?.n||0),terms:Number(terms?.n||0),classLevels:Number(levels?.n||0),classes:Number(classes?.n||0),subjects:Number(subjects?.n||0),classSubjects:Number(classSubjects?.n||0),feeCategories:Number(fees?.n||0),paymentMethods:Number(payments?.n||0),schoolAccounts:Number(accounts?.n||0),offenceTypes:Number(offences?.n||0)}};
}
