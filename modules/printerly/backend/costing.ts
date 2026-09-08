// @ts-nocheck
import { AppError } from "../../../src/lib/errors";
import { createJournal, postJournal } from "../../../src/services/ledger";

const makeId=(prefix:string)=>`${prefix}_${crypto.randomUUID().replaceAll("-","")}`;
const today=()=>new Date().toISOString().slice(0,10);
const nonNegative=(value:any,fallback=0)=>Math.max(0,Math.round(Number(value)||fallback));

export type PreparedCosting={
  projectId:string|null;
  departmentType:"finance"|"school"|null;
  departmentId:string|null;
  sourceModule:string|null;
  sourceReference:string|null;
  estimatedPages:number;
  estimatedImpressions:number;
  estimatedSheets:number;
  estimate:CostBreakdown;
};

type CostBreakdown={
  paperCostMinor:number;
  tonerCostMinor:number;
  maintenanceCostMinor:number;
  electricityCostMinor:number;
  totalCostMinor:number;
  currency:string;
};

async function ensureProfile(db:any,organizationId:string){
  const existing=await db.prepare(`SELECT organization_id organizationId,currency,paper_cost_minor paperCostMinor,bw_toner_cost_minor bwTonerCostMinor,
    color_toner_cost_minor colorTonerCostMinor,maintenance_cost_minor maintenanceCostMinor,electricity_cost_minor electricityCostMinor,
    expense_account_id expenseAccountId,offset_account_id offsetAccountId,auto_post_accounting autoPostAccounting,updated_at updatedAt
    FROM prn_cost_profiles WHERE organization_id=?`).bind(organizationId).first<any>();
  if(existing)return normalizeProfile(existing);
  const org=await db.prepare("SELECT base_currency currency FROM organizations WHERE id=?").bind(organizationId).first<any>();
  if(!org)throw new AppError(404,"ORGANIZATION_NOT_FOUND","Organization not found");
  await db.prepare(`INSERT OR IGNORE INTO prn_cost_profiles(organization_id,currency) VALUES(?,?)`).bind(organizationId,String(org.currency||"UGX")).run();
  return normalizeProfile(await db.prepare(`SELECT organization_id organizationId,currency,paper_cost_minor paperCostMinor,bw_toner_cost_minor bwTonerCostMinor,
    color_toner_cost_minor colorTonerCostMinor,maintenance_cost_minor maintenanceCostMinor,electricity_cost_minor electricityCostMinor,
    expense_account_id expenseAccountId,offset_account_id offsetAccountId,auto_post_accounting autoPostAccounting,updated_at updatedAt
    FROM prn_cost_profiles WHERE organization_id=?`).bind(organizationId).first<any>());
}

function normalizeProfile(row:any){return {...row,autoPostAccounting:Boolean(row?.autoPostAccounting)}}

export async function getCostProfile(db:any,organizationId:string){return ensureProfile(db,organizationId)}

export async function updateCostProfile(db:any,organizationId:string,userId:string,data:any){
  const current=await ensureProfile(db,organizationId);
  const accountIds=[data.expenseAccountId,data.offsetAccountId].filter(Boolean).map(String);
  if(accountIds.length){
    const placeholders=accountIds.map(()=>"?").join(",");
    const rows=(await db.prepare(`SELECT id FROM accounts WHERE organization_id=? AND active=1 AND allow_posting=1 AND id IN (${placeholders})`).bind(organizationId,...accountIds).all<any>()).results||[];
    if(new Set(rows.map((r:any)=>r.id)).size!==new Set(accountIds).size)throw new AppError(422,"INVALID_ACCOUNT","Printerly accounting accounts must be active posting accounts in this organization");
  }
  const currency=String(data.currency||current.currency||"UGX").toUpperCase().slice(0,3);
  await db.prepare(`UPDATE prn_cost_profiles SET currency=?,paper_cost_minor=?,bw_toner_cost_minor=?,color_toner_cost_minor=?,maintenance_cost_minor=?,electricity_cost_minor=?,
    expense_account_id=?,offset_account_id=?,auto_post_accounting=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE organization_id=?`)
    .bind(currency,nonNegative(data.paperCostMinor),nonNegative(data.bwTonerCostMinor),nonNegative(data.colorTonerCostMinor),nonNegative(data.maintenanceCostMinor),nonNegative(data.electricityCostMinor),
      data.expenseAccountId?String(data.expenseAccountId):null,data.offsetAccountId?String(data.offsetAccountId):null,data.autoPostAccounting?1:0,userId,organizationId).run();
  return ensureProfile(db,organizationId);
}

export async function costingOptions(db:any,organizationId:string){
  const [projects,financeDepartments,schoolDepartments,accounts,profile]=await Promise.all([
    db.prepare("SELECT id,code,name,status FROM projects WHERE organization_id=? AND status='active' ORDER BY name").bind(organizationId).all<any>(),
    db.prepare("SELECT id,code,name FROM dimensions WHERE organization_id=? AND type='department' AND active=1 ORDER BY name").bind(organizationId).all<any>(),
    db.prepare("SELECT id,code,name FROM school_departments WHERE organization_id=? AND active=1 ORDER BY name").bind(organizationId).all<any>().catch(()=>({results:[]})),
    db.prepare("SELECT id,code,name,type,subtype FROM accounts WHERE organization_id=? AND active=1 AND allow_posting=1 ORDER BY code").bind(organizationId).all<any>(),
    ensureProfile(db,organizationId),
  ]);
  return {projects:projects.results||[],financeDepartments:financeDepartments.results||[],schoolDepartments:schoolDepartments.results||[],accounts:accounts.results||[],profile};
}

async function validateProject(db:any,organizationId:string,projectId:string|null){
  if(!projectId)return;
  if(!await db.prepare("SELECT 1 FROM projects WHERE id=? AND organization_id=? AND status='active'").bind(projectId,organizationId).first())throw new AppError(422,"INVALID_PROJECT","Selected project is not an active Ledgerly project in this organization");
}
async function validateDepartment(db:any,organizationId:string,type:string|null,id:string|null){
  if(!id)return;
  if(type==="finance"){
    if(!await db.prepare("SELECT 1 FROM dimensions WHERE id=? AND organization_id=? AND type='department' AND active=1").bind(id,organizationId).first())throw new AppError(422,"INVALID_DEPARTMENT","Selected finance department is invalid");
    return;
  }
  if(type==="school"){
    if(!await db.prepare("SELECT 1 FROM school_departments WHERE id=? AND organization_id=? AND active=1").bind(id,organizationId).first())throw new AppError(422,"INVALID_DEPARTMENT","Selected school department is invalid");
    return;
  }
  throw new AppError(422,"INVALID_DEPARTMENT","Choose the department source before charging a department");
}

function breakdown(profile:any,impressions:number,sheets:number,colorMode:string):CostBreakdown{
  const paperCostMinor=sheets*nonNegative(profile.paperCostMinor);
  const tonerUnit=colorMode==="color"?nonNegative(profile.colorTonerCostMinor):nonNegative(profile.bwTonerCostMinor);
  const tonerCostMinor=impressions*tonerUnit;
  const maintenanceCostMinor=impressions*nonNegative(profile.maintenanceCostMinor);
  const electricityCostMinor=impressions*nonNegative(profile.electricityCostMinor);
  return {paperCostMinor,tonerCostMinor,maintenanceCostMinor,electricityCostMinor,totalCostMinor:paperCostMinor+tonerCostMinor+maintenanceCostMinor+electricityCostMinor,currency:String(profile.currency||"UGX")};
}

export async function prepareJobCosting(db:any,organizationId:string,data:any):Promise<PreparedCosting>{
  const projectId=data.projectId?String(data.projectId):null;
  const departmentId=data.departmentId?String(data.departmentId):null;
  const departmentType=departmentId?(String(data.departmentType)==="school"?"school":"finance"):null;
  await validateProject(db,organizationId,projectId);
  await validateDepartment(db,organizationId,departmentType,departmentId);
  const estimatedPages=Math.max(1,Math.min(10000,Math.round(Number(data.estimatedPages)||1)));
  const copies=Math.max(1,Math.min(1000,Math.round(Number(data.copies)||1)));
  const estimatedImpressions=estimatedPages*copies;
  const estimatedSheets=data.duplex?Math.ceil(estimatedImpressions/2):estimatedImpressions;
  const profile=await ensureProfile(db,organizationId);
  return {projectId,departmentType,departmentId,sourceModule:data.sourceModule?String(data.sourceModule).slice(0,80):null,sourceReference:data.sourceReference?String(data.sourceReference).slice(0,500):null,
    estimatedPages,estimatedImpressions,estimatedSheets,estimate:breakdown(profile,estimatedImpressions,estimatedSheets,String(data.colorMode||"monochrome"))};
}

export async function attachJobCosting(db:any,organizationId:string,jobId:string,prepared:PreparedCosting){
  await db.prepare(`UPDATE prn_jobs SET charge_project_id=?,charge_department_type=?,charge_department_id=?,source_module=?,source_reference=?,estimated_pages=?,estimated_impressions=?,estimated_sheets=?,estimated_cost_minor=?,total_sheets=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND organization_id=?`)
    .bind(prepared.projectId,prepared.departmentType,prepared.departmentId,prepared.sourceModule,prepared.sourceReference,prepared.estimatedPages,prepared.estimatedImpressions,prepared.estimatedSheets,prepared.estimate.totalCostMinor,prepared.estimatedSheets,jobId,organizationId).run();
  return {...prepared,jobId};
}

export async function listJobsWithCosting(db:any,organizationId:string,limit=100){
  const rows=await db.prepare(`SELECT j.id,j.job_number jobNumber,j.title,j.status,j.priority,j.copies,j.page_size pageSize,j.color_mode colorMode,j.duplex,
    j.secure_release secureRelease,j.total_sheets totalSheets,j.printer_id printerId,j.node_id nodeId,j.error_message errorMessage,j.created_at createdAt,j.completed_at completedAt,
    j.source_module sourceModule,j.source_reference sourceReference,j.charge_project_id projectId,j.charge_department_type departmentType,j.charge_department_id departmentId,
    j.estimated_pages estimatedPages,j.estimated_impressions estimatedImpressions,j.estimated_sheets estimatedSheets,j.actual_impressions actualImpressions,j.actual_sheets actualSheets,
    j.estimated_cost_minor estimatedCostMinor,j.actual_cost_minor actualCostMinor,d.original_name documentName,d.mime_type documentMime,
    p.name projectName,CASE WHEN j.charge_department_type='finance' THEN fd.name WHEN j.charge_department_type='school' THEN sd.name ELSE NULL END departmentName,
    cp.journal_entry_id journalEntryId
    FROM prn_jobs j
    LEFT JOIN prn_documents d ON d.id=j.document_id AND d.organization_id=j.organization_id
    LEFT JOIN projects p ON p.id=j.charge_project_id AND p.organization_id=j.organization_id
    LEFT JOIN dimensions fd ON fd.id=j.charge_department_id AND fd.organization_id=j.organization_id AND fd.type='department'
    LEFT JOIN school_departments sd ON sd.id=j.charge_department_id AND sd.organization_id=j.organization_id
    LEFT JOIN prn_cost_postings cp ON cp.job_id=j.id AND cp.organization_id=j.organization_id
    WHERE j.organization_id=? ORDER BY j.created_at DESC LIMIT ?`).bind(organizationId,Math.min(300,Math.max(1,limit))).all<any>();
  return rows.results||[];
}

export async function finalizeJobCost(db:any,organizationId:string,jobId:string,completion:any,actorId?:string){
  const existing=await db.prepare(`SELECT l.*,p.journal_entry_id journalEntryId FROM prn_cost_ledger l LEFT JOIN prn_cost_postings p ON p.cost_ledger_id=l.id AND p.organization_id=l.organization_id WHERE l.organization_id=? AND l.job_id=?`).bind(organizationId,jobId).first<any>();
  if(existing)return existing;
  const job=await db.prepare(`SELECT j.*,o.base_currency baseCurrency FROM prn_jobs j JOIN organizations o ON o.id=j.organization_id WHERE j.id=? AND j.organization_id=?`).bind(jobId,organizationId).first<any>();
  if(!job)throw new AppError(404,"PRINT_JOB_NOT_FOUND","Printerly job not found");
  const profile=await ensureProfile(db,organizationId);
  const impressions=Math.max(0,Math.round(Number(completion?.impressionsCompleted)||Number(job.estimated_impressions)||Number(job.estimated_pages||1)*Number(job.copies||1)));
  const sheets=Math.max(0,Math.round(Number(completion?.sheetsCompleted)||Number(job.estimated_sheets)||(job.duplex?Math.ceil(impressions/2):impressions)));
  const cost=breakdown(profile,impressions,sheets,String(job.color_mode||"monochrome"));
  const ledgerId=makeId("prncost");
  const insert=await db.prepare(`INSERT OR IGNORE INTO prn_cost_ledger(id,organization_id,job_id,project_id,department_type,department_id,impressions,sheets,paper_cost_minor,toner_cost_minor,maintenance_cost_minor,electricity_cost_minor,total_cost_minor,currency,calculation_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(ledgerId,organizationId,jobId,job.charge_project_id||null,job.charge_department_type||null,job.charge_department_id||null,impressions,sheets,cost.paperCostMinor,cost.tonerCostMinor,cost.maintenanceCostMinor,cost.electricityCostMinor,cost.totalCostMinor,cost.currency,
      JSON.stringify({profile:{paperCostMinor:profile.paperCostMinor,bwTonerCostMinor:profile.bwTonerCostMinor,colorTonerCostMinor:profile.colorTonerCostMinor,maintenanceCostMinor:profile.maintenanceCostMinor,electricityCostMinor:profile.electricityCostMinor},colorMode:job.color_mode,duplex:Boolean(job.duplex),completionSource:completion?.sheetsCompleted||completion?.impressionsCompleted?"node":"estimate-fallback"})).run();
  await db.prepare("UPDATE prn_jobs SET actual_impressions=?,actual_sheets=?,actual_cost_minor=?,total_sheets=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?")
    .bind(impressions,sheets,cost.totalCostMinor,sheets,jobId,organizationId).run();
  const ledger=insert.meta?.changes?await db.prepare("SELECT * FROM prn_cost_ledger WHERE id=?").bind(ledgerId).first<any>():await db.prepare("SELECT * FROM prn_cost_ledger WHERE organization_id=? AND job_id=?").bind(organizationId,jobId).first<any>();
  if(profile.autoPostAccounting&&cost.totalCostMinor>0&&profile.expenseAccountId&&profile.offsetAccountId){
    try{await postJobCost(db,organizationId,actorId||job.created_by||"printerly",jobId)}catch(error){console.error(JSON.stringify({level:"error",component:"printerly-costing",jobId,message:error instanceof Error?error.message:String(error)}))}
  }
  return ledger;
}

export async function postJobCost(db:any,organizationId:string,actorId:string,jobId:string){
  const prior=await db.prepare("SELECT journal_entry_id journalEntryId FROM prn_cost_postings WHERE organization_id=? AND job_id=?").bind(organizationId,jobId).first<any>();
  if(prior)return {jobId,journalEntryId:prior.journalEntryId,duplicate:true};
  const row=await db.prepare(`SELECT l.*,j.job_number jobNumber,j.title,j.created_by createdBy,j.charge_project_id projectId,j.charge_department_type departmentType,j.charge_department_id departmentId,
    p.expense_account_id expenseAccountId,p.offset_account_id offsetAccountId,p.currency
    FROM prn_cost_ledger l JOIN prn_jobs j ON j.id=l.job_id AND j.organization_id=l.organization_id JOIN prn_cost_profiles p ON p.organization_id=l.organization_id
    WHERE l.organization_id=? AND l.job_id=?`).bind(organizationId,jobId).first<any>();
  if(!row)throw new AppError(409,"COST_NOT_FINALIZED","Printerly can post accounting only after the print job has completed and its cost has been finalized");
  if(Number(row.total_cost_minor)<=0)throw new AppError(409,"ZERO_PRINT_COST","This print job has no configured cost to post");
  if(!row.expenseAccountId||!row.offsetAccountId)throw new AppError(422,"PRINTERLY_ACCOUNTS_REQUIRED","Choose a printing expense account and offset account in Printerly Costing before posting");
  const financeDepartmentId=row.departmentType==="finance"?row.departmentId:null;
  const dimensions=row.departmentType==="school"&&row.departmentId?{schoolDepartmentId:row.departmentId}:{};
  const date=today();
  const journal=await createJournal(db,organizationId,actorId,{
    transactionDate:date,postingDate:date,description:`Printerly cost · ${row.jobNumber} · ${row.title}`,reference:row.jobNumber,currency:String(row.currency||"UGX"),sourceType:"printerly",sourceId:jobId,
    lines:[
      {accountId:row.expenseAccountId,description:`Printing cost · ${row.title}`,debitMinor:Number(row.total_cost_minor),projectId:row.projectId||undefined,departmentId:financeDepartmentId||undefined,dimensions},
      {accountId:row.offsetAccountId,description:`Printerly cost allocation · ${row.title}`,creditMinor:Number(row.total_cost_minor),projectId:row.projectId||undefined,departmentId:financeDepartmentId||undefined,dimensions},
    ]
  },`printerly:cost:${jobId}`);
  const state=await db.prepare("SELECT status FROM journal_entries WHERE id=? AND organization_id=?").bind(journal.id,organizationId).first<any>();
  if(state?.status==="draft")await postJournal(db,organizationId,actorId,journal.id);
  await db.prepare(`INSERT OR IGNORE INTO prn_cost_postings(id,organization_id,job_id,cost_ledger_id,journal_entry_id,posted_by) VALUES(?,?,?,?,?,?)`)
    .bind(makeId("prnpost"),organizationId,jobId,row.id,journal.id,actorId).run();
  return {jobId,journalEntryId:journal.id,entryNumber:journal.entryNumber};
}

export async function listCostLedger(db:any,organizationId:string,limit=200){
  const rows=await db.prepare(`SELECT l.id,l.job_id jobId,j.job_number jobNumber,j.title,l.impressions,l.sheets,l.paper_cost_minor paperCostMinor,l.toner_cost_minor tonerCostMinor,
    l.maintenance_cost_minor maintenanceCostMinor,l.electricity_cost_minor electricityCostMinor,l.total_cost_minor totalCostMinor,l.currency,l.created_at createdAt,
    p.name projectName,CASE WHEN l.department_type='finance' THEN fd.name WHEN l.department_type='school' THEN sd.name END departmentName,
    cp.journal_entry_id journalEntryId,je.entry_number journalEntryNumber
    FROM prn_cost_ledger l JOIN prn_jobs j ON j.id=l.job_id AND j.organization_id=l.organization_id
    LEFT JOIN projects p ON p.id=l.project_id AND p.organization_id=l.organization_id
    LEFT JOIN dimensions fd ON fd.id=l.department_id AND fd.organization_id=l.organization_id AND fd.type='department'
    LEFT JOIN school_departments sd ON sd.id=l.department_id AND sd.organization_id=l.organization_id
    LEFT JOIN prn_cost_postings cp ON cp.cost_ledger_id=l.id AND cp.organization_id=l.organization_id
    LEFT JOIN journal_entries je ON je.id=cp.journal_entry_id AND je.organization_id=l.organization_id
    WHERE l.organization_id=? ORDER BY l.created_at DESC LIMIT ?`).bind(organizationId,Math.min(500,Math.max(1,limit))).all<any>();
  return rows.results||[];
}

export async function costSummary(db:any,organizationId:string){
  const month=new Date().toISOString().slice(0,7);
  const row=await db.prepare(`SELECT COUNT(*) completedJobs,COALESCE(SUM(impressions),0) impressions,COALESCE(SUM(sheets),0) sheets,COALESCE(SUM(total_cost_minor),0) totalCostMinor,
    COALESCE(SUM(paper_cost_minor),0) paperCostMinor,COALESCE(SUM(toner_cost_minor),0) tonerCostMinor,COALESCE(SUM(maintenance_cost_minor),0) maintenanceCostMinor,
    COALESCE(SUM(electricity_cost_minor),0) electricityCostMinor FROM prn_cost_ledger WHERE organization_id=? AND substr(created_at,1,7)=?`).bind(organizationId,month).first<any>();
  const profile=await ensureProfile(db,organizationId);
  return {...row,currency:profile.currency,month};
}
