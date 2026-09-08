// @ts-nocheck
import { AppError } from "../../../src/lib/errors";

function isoDate(value:any,fallback:string){const s=String(value||"").slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:fallback}
function defaultRange(){const d=new Date(),to=d.toISOString().slice(0,10),from=`${to.slice(0,7)}-01`;return {from,to}}
export function normalizeUsageRange(fromRaw:any,toRaw:any){const d=defaultRange(),from=isoDate(fromRaw,d.from),to=isoDate(toRaw,d.to);const a=Date.parse(`${from}T00:00:00Z`),b=Date.parse(`${to}T00:00:00Z`);if(!Number.isFinite(a)||!Number.isFinite(b)||a>b)throw new AppError(422,"INVALID_REPORT_RANGE","Choose a valid Printerly report date range");if((b-a)/86400000>366)throw new AppError(422,"REPORT_RANGE_TOO_LARGE","Printerly usage reports are limited to 366 days at a time");return {from,to}}
const rows=(r:any)=>r?.results||[];

export async function usageReport(db:any,organizationId:string,fromRaw:any,toRaw:any){
  const {from,to}=normalizeUsageRange(fromRaw,toRaw),args=[organizationId,from,to];
  const [summary,daily,users,projects,departments,printers,profile]=await Promise.all([
    db.prepare(`SELECT COUNT(*) totalJobs,
      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) completedJobs,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failedJobs,
      SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) cancelledJobs,
      SUM(COALESCE(actual_impressions,0)) impressions,
      SUM(COALESCE(actual_sheets,total_sheets,0)) sheets,
      SUM(COALESCE(actual_cost_minor,0)) totalCostMinor
      FROM prn_jobs WHERE organization_id=? AND date(created_at) BETWEEN date(?) AND date(?)`).bind(...args).first<any>(),
    db.prepare(`SELECT date(created_at) day,COUNT(*) jobs,SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed,
      SUM(COALESCE(actual_impressions,0)) impressions,SUM(COALESCE(actual_sheets,total_sheets,0)) sheets,SUM(COALESCE(actual_cost_minor,0)) totalCostMinor
      FROM prn_jobs WHERE organization_id=? AND date(created_at) BETWEEN date(?) AND date(?) GROUP BY date(created_at) ORDER BY day`).bind(...args).all<any>(),
    db.prepare(`SELECT COALESCE(NULLIF(created_by,''),'unknown') requesterId,COUNT(*) jobs,SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed,
      SUM(COALESCE(actual_impressions,0)) impressions,SUM(COALESCE(actual_sheets,total_sheets,0)) sheets,SUM(COALESCE(actual_cost_minor,0)) totalCostMinor
      FROM prn_jobs WHERE organization_id=? AND date(created_at) BETWEEN date(?) AND date(?) GROUP BY COALESCE(NULLIF(created_by,''),'unknown') ORDER BY totalCostMinor DESC,jobs DESC LIMIT 100`).bind(...args).all<any>(),
    db.prepare(`SELECT COALESCE(p.id,'unallocated') projectId,COALESCE(p.name,'Unallocated') projectName,COUNT(*) jobs,SUM(CASE WHEN j.status='completed' THEN 1 ELSE 0 END) completed,
      SUM(COALESCE(j.actual_impressions,0)) impressions,SUM(COALESCE(j.actual_sheets,j.total_sheets,0)) sheets,SUM(COALESCE(j.actual_cost_minor,0)) totalCostMinor
      FROM prn_jobs j LEFT JOIN projects p ON p.id=j.charge_project_id AND p.organization_id=j.organization_id WHERE j.organization_id=? AND date(j.created_at) BETWEEN date(?) AND date(?) GROUP BY COALESCE(p.id,'unallocated'),COALESCE(p.name,'Unallocated') ORDER BY totalCostMinor DESC,jobs DESC`).bind(...args).all<any>(),
    db.prepare(`SELECT COALESCE(j.charge_department_type,'none') departmentType,COALESCE(j.charge_department_id,'unallocated') departmentId,
      COALESCE(CASE WHEN j.charge_department_type='finance' THEN fd.name WHEN j.charge_department_type='school' THEN sd.name END,'Unallocated') departmentName,
      COUNT(*) jobs,SUM(CASE WHEN j.status='completed' THEN 1 ELSE 0 END) completed,SUM(COALESCE(j.actual_impressions,0)) impressions,
      SUM(COALESCE(j.actual_sheets,j.total_sheets,0)) sheets,SUM(COALESCE(j.actual_cost_minor,0)) totalCostMinor
      FROM prn_jobs j LEFT JOIN dimensions fd ON fd.id=j.charge_department_id AND fd.organization_id=j.organization_id AND fd.type='department'
      LEFT JOIN school_departments sd ON sd.id=j.charge_department_id AND sd.organization_id=j.organization_id
      WHERE j.organization_id=? AND date(j.created_at) BETWEEN date(?) AND date(?) GROUP BY j.charge_department_type,j.charge_department_id,departmentName ORDER BY totalCostMinor DESC,jobs DESC`).bind(...args).all<any>(),
    db.prepare(`SELECT COALESCE(p.id,'auto') printerId,COALESCE(p.name,'Auto / unassigned') printerName,COUNT(*) jobs,SUM(CASE WHEN j.status='completed' THEN 1 ELSE 0 END) completed,
      SUM(COALESCE(j.actual_impressions,0)) impressions,SUM(COALESCE(j.actual_sheets,j.total_sheets,0)) sheets,SUM(COALESCE(j.actual_cost_minor,0)) totalCostMinor
      FROM prn_jobs j LEFT JOIN prn_printers p ON p.id=j.printer_id AND p.organization_id=j.organization_id WHERE j.organization_id=? AND date(j.created_at) BETWEEN date(?) AND date(?) GROUP BY COALESCE(p.id,'auto'),COALESCE(p.name,'Auto / unassigned') ORDER BY totalCostMinor DESC,jobs DESC`).bind(...args).all<any>(),
    db.prepare("SELECT currency FROM prn_cost_profiles WHERE organization_id=?").bind(organizationId).first<any>()
  ]);
  return {range:{from,to},currency:String(profile?.currency||"UGX"),summary:{totalJobs:Number(summary?.totalJobs||0),completedJobs:Number(summary?.completedJobs||0),failedJobs:Number(summary?.failedJobs||0),cancelledJobs:Number(summary?.cancelledJobs||0),impressions:Number(summary?.impressions||0),sheets:Number(summary?.sheets||0),totalCostMinor:Number(summary?.totalCostMinor||0)},daily:rows(daily),byRequester:rows(users),byProject:rows(projects),byDepartment:rows(departments),byPrinter:rows(printers)};
}

function csvCell(value:any){const s=String(value??"");return /[",\n\r]/.test(s)?`"${s.replaceAll('"','""')}"`:s}
export async function usageCsv(db:any,organizationId:string,fromRaw:any,toRaw:any){
  const {from,to}=normalizeUsageRange(fromRaw,toRaw);
  const result=await db.prepare(`SELECT j.job_number jobNumber,j.title,j.status,j.priority,j.created_by requesterId,j.created_at createdAt,j.completed_at completedAt,
    COALESCE(p.name,'') printer,COALESCE(pr.name,'') project,
    COALESCE(CASE WHEN j.charge_department_type='finance' THEN fd.name WHEN j.charge_department_type='school' THEN sd.name END,'') department,
    j.source_module sourceModule,j.copies,j.page_size pageSize,j.color_mode colorMode,j.duplex,
    COALESCE(j.actual_impressions,0) impressions,COALESCE(j.actual_sheets,j.total_sheets,0) sheets,COALESCE(j.actual_cost_minor,0) totalCostMinor
    FROM prn_jobs j LEFT JOIN prn_printers p ON p.id=j.printer_id AND p.organization_id=j.organization_id LEFT JOIN projects pr ON pr.id=j.charge_project_id AND pr.organization_id=j.organization_id
    LEFT JOIN dimensions fd ON fd.id=j.charge_department_id AND fd.organization_id=j.organization_id AND fd.type='department' LEFT JOIN school_departments sd ON sd.id=j.charge_department_id AND sd.organization_id=j.organization_id
    WHERE j.organization_id=? AND date(j.created_at) BETWEEN date(?) AND date(?) ORDER BY j.created_at DESC LIMIT 5000`).bind(organizationId,from,to).all<any>();
  const header=["job_number","title","status","priority","requester_id","created_at","completed_at","printer","project","department","source_module","copies","page_size","color_mode","duplex","impressions","sheets","total_cost_minor"];
  const body=rows(result).map((r:any)=>[r.jobNumber,r.title,r.status,r.priority,r.requesterId,r.createdAt,r.completedAt,r.printer,r.project,r.department,r.sourceModule,r.copies,r.pageSize,r.colorMode,r.duplex?"yes":"no",r.impressions,r.sheets,r.totalCostMinor].map(csvCell).join(","));
  return {from,to,csv:[header.join(","),...body].join("\n")+"\n"};
}
