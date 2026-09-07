import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import * as XLSX from "xlsx";
import {
  Activity, AppWindow, BookOpen, Building2, CalendarDays, Check, ChevronRight, ClipboardCheck,
  FileText, GraduationCap, IdCard, KeyRound, LayoutDashboard, LockKeyhole, Plus, RefreshCw,
  School, Search, Settings2, ShieldCheck, Trash2, UserCog, UserPlus, Users, X, BriefcaseBusiness, ArrowLeft,
  CircleDollarSign, ChevronDown, ReceiptText, FileSpreadsheet, BarChart3, WalletCards, Printer, Gavel
} from "lucide-react";
import { ApiError, can, del, downloadFile, errorText, get, post, put } from "../../../web/api";
import { SchoolFileUpload } from "../../../web/components/SchoolFileUpload";
import { StaffWorkspace } from "./SchoolStaffPages";
import { SchoolFeesWorkspace, type FeeView } from "./SchoolFeesPages";
import { DisciplineWorkspace, PromotionWorkspace } from "./PromotionDisciplinePages";
import { useAuth } from "../../../web/auth";
import { Badge, Button, Card, EmptyState, Field, Modal, Notice, Pagination, SearchableSelect, Spinner } from "../../../web/components/ui";
import { downloadTableCsv, printReportElement } from "../../../web/reporting";

type R = Record<string, any>;
type SchoolView = "overview" | "students" | "admissions" | "staff" | "fees" | "promotion" | "discipline" | "people" | "setup";
type FieldKind = "text" | "textarea" | "number" | "date" | "datetime-local" | "time" | "select" | "checkbox" | "settings" | "email" | "url" | "file";
type Option = { value: string; label: string };
type SetupField = {
  key: string;
  label: string;
  type?: FieldKind;
  required?: boolean;
  options?: Option[];
  source?: string;
  filter?: (row: R) => boolean;
  placeholder?: string;
  hint?: string;
  defaultValue?: unknown;
  full?: boolean;
};
type SetupConfig = {
  key: string;
  title: string;
  singular: string;
  description: string;
  group: "school" | "academic" | "assessment" | "calendar" | "finance" | "documents";
  fields: SetupField[];
  columns: Array<{ key: string; label: string }>;
};

const today = () => new Date().toISOString().slice(0, 10);
const schoolBase = "/school";
const bool = (v: unknown) => v === true || v === 1 || v === "1";
const words = (v: unknown) => String(v ?? "—").replaceAll("_", " ");
const fullName = (r: R) => [r.firstName, r.middleName, r.lastName].filter(Boolean).join(" ");
const safeJson = (v: unknown, fallback: any = {}) => {
  if (v == null || v === "") return fallback;
  if (typeof v === "object") return v;
  try { return JSON.parse(String(v)); } catch { return fallback; }
};
const prettyKey = (key: string) => key
  .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
  .replaceAll("_", " ")
  .replace(/\b\w/g, c => c.toUpperCase());

const simpleSettingValue = (v: unknown): string => {
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (v && typeof v === "object") return Object.entries(v as R).map(([k, x]) => `${prettyKey(k)}: ${simpleSettingValue(x)}`).join(" · ");
  return String(v ?? "");
};

const displayValue = (v: unknown) => {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") return simpleSettingValue(v) || "—";
  return words(v);
};

const settingsSummary = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return simpleSettingValue(value) || "Not configured";
  const entries = Object.entries(value as R);
  if (!entries.length) return "No additional settings";
  return entries.slice(0, 3).map(([k, v]) => `${prettyKey(k)}: ${simpleSettingValue(v)}`).join(" · ") + (entries.length > 3 ? ` · +${entries.length - 3} more` : "");
};

function SettingsEditor({ value, onChange, disabled = false, emptyText = "No additional settings have been added." }: { value: R; onChange: (next: R) => void; disabled?: boolean; emptyText?: string }) {
  const entries = Object.entries(value || {});
  const inferType = (v: unknown) => Array.isArray(v) ? "list" : typeof v === "boolean" ? "boolean" : typeof v === "number" ? "number" : "text";
  const setKey = (oldKey: string, newKey: string) => {
    const next: R = {};
    for (const [k, v] of Object.entries(value || {})) next[k === oldKey ? newKey : k] = v;
    onChange(next);
  };
  const setValue = (key: string, raw: string, type: string) => {
    let nextValue: unknown = raw;
    if (type === "number") nextValue = raw === "" ? 0 : Number(raw);
    if (type === "boolean") nextValue = raw === "true";
    if (type === "list") nextValue = raw.split(",").map(x => x.trim()).filter(Boolean);
    onChange({ ...(value || {}), [key]: nextValue });
  };
  const changeType = (key: string, type: string) => {
    const current = value?.[key];
    const next = type === "boolean" ? Boolean(current) : type === "number" ? Number(current || 0) : type === "list" ? (Array.isArray(current) ? current : String(current ?? "").split(",").map(x => x.trim()).filter(Boolean)) : String(current ?? "");
    onChange({ ...(value || {}), [key]: next });
  };
  const remove = (key: string) => {
    const next = { ...(value || {}) };
    delete next[key];
    onChange(next);
  };
  const add = () => {
    let i = entries.length + 1, key = `setting_${i}`;
    while (Object.prototype.hasOwnProperty.call(value || {}, key)) key = `setting_${++i}`;
    onChange({ ...(value || {}), [key]: "" });
  };
  return <div className="school-settings-editor">
    {entries.length ? entries.map(([key, current]) => {
      const type = inferType(current);
      const shown = type === "list" ? (current as unknown[]).join(", ") : type === "boolean" ? String(current) : String(current ?? "");
      return <div className="school-settings-row" key={key}>
        <input aria-label="Setting name" value={key} disabled={disabled} onChange={e => setKey(key, e.target.value.replace(/\s+/g, "_"))} placeholder="Setting name"/>
        <select aria-label="Setting type" disabled={disabled} value={type} onChange={e => changeType(key, e.target.value)}>
          <option value="text">Text</option><option value="number">Number</option><option value="boolean">Yes / No</option><option value="list">List</option>
        </select>
        {type === "boolean" ? <select aria-label={prettyKey(key)} disabled={disabled} value={shown} onChange={e => setValue(key, e.target.value, type)}><option value="true">Yes</option><option value="false">No</option></select> :
          <input aria-label={prettyKey(key)} disabled={disabled} type={type === "number" ? "number" : "text"} value={shown} onChange={e => setValue(key, e.target.value, type)} placeholder={type === "list" ? "Separate items with commas" : `Enter ${prettyKey(key).toLowerCase()}`}/>}
        {!disabled && <button type="button" className="school-settings-remove" onClick={() => remove(key)} aria-label={`Remove ${prettyKey(key)}`}><X size={14}/></button>}
      </div>;
    }) : <p className="school-muted">{emptyText}</p>}
    {!disabled && <Button type="button" variant="secondary" onClick={add}><Plus size={14}/> Add setting</Button>}
  </div>;
}

function useLoad<T>(path: string | null, seed: T) {
  const [data, setData] = useState<T>(seed);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState("");
  const load = async () => {
    if (!path) return;
    setLoading(true); setError("");
    try { setData(await get<T>(path)); }
    catch (e) { setError(errorText(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [path]);
  return { data, setData, loading, error, load };
}

function Status({ value }: { value: unknown }) {
  const v = String(value ?? "unknown");
  const good = ["active", "approved", "enrolled", "success", "completed", "verified", "current"].includes(v);
  const warn = ["draft", "submitted", "screening", "waitlisted", "planned", "suspended", "locked", "inactive"].includes(v);
  const bad = ["rejected", "withdrawn", "deceased", "failed", "revoked"].includes(v);
  return <Badge tone={good ? "success" : bad ? "danger" : warn ? "warning" : "neutral"}>{words(v)}</Badge>;
}

function SchoolPageHeader({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return <div className="school-page-head"><div><span className="eyebrow">School management</span><h1>{title}</h1><p>{text}</p></div>{action && <div className="heading-actions">{action}</div>}</div>;
}

const schoolNav: Array<{ key: SchoolView; label: string; icon: any }> = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "students", label: "Students", icon: GraduationCap },
  { key: "admissions", label: "Admissions", icon: ClipboardCheck },
  { key: "staff", label: "Staff & teachers", icon: BriefcaseBusiness },
  { key: "promotion", label: "Promotion engine", icon: GraduationCap },
  { key: "discipline", label: "Discipline & behaviour", icon: Gavel },
  { key: "people", label: "People & access", icon: Users },
  { key: "setup", label: "School setup", icon: Settings2 },
];

const feeNavGroups: Array<{key:string;label:string;icon:any;items:Array<{key:FeeView;label:string}>}> = [
  {key:"configuration",label:"Configuration",icon:Settings2,items:[
    {key:"structures",label:"Fee structures"},{key:"discounts",label:"Discounts & awards"},{key:"late-fees",label:"Late-fee rules"},{key:"accounting",label:"Accounting setup"}
  ]},
  {key:"transactions",label:"Transactions",icon:WalletCards,items:[
    {key:"billing",label:"Billing & charges"},{key:"receipts",label:"Receipts & payments"},{key:"refunds",label:"Refunds & credits"},{key:"plans",label:"Payment plans"},{key:"holds",label:"Holds & clearance"}
  ]},
  {key:"reports",label:"Reports",icon:BarChart3,items:[
    {key:"balances",label:"Student balances"},{key:"defaulters",label:"Defaulters"},{key:"class-summary",label:"Class summary"},{key:"collections",label:"Collections"},{key:"aging",label:"Ageing"},{key:"statements",label:"Statements"}
  ]},
  {key:"imports",label:"Data import",icon:FileSpreadsheet,items:[
    {key:"opening-import",label:"Opening balances"},{key:"payment-import",label:"Payment import"}
  ]},
];

export function SchoolManagementPage() {
  const { principal } = useAuth();
  const [view, setView] = useState<SchoolView>(() => { const saved=sessionStorage.getItem("ledgerly.school.view"); return saved==="attendance"?"overview":(saved as SchoolView)||"overview"; });
  const [feeView, setFeeView] = useState<FeeView>(() => (sessionStorage.getItem("ledgerly.school.fees.view") as FeeView) || "overview");
  const [feesOpen, setFeesOpen] = useState(() => view === "fees");
  const [feeGroupsOpen, setFeeGroupsOpen] = useState<Record<string, boolean>>({configuration:true,transactions:true,reports:false,imports:false});
  const [disabled, setDisabled] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [moduleError, setModuleError] = useState("");
  const check = async () => {
    try { await get(`${schoolBase}/setup/bootstrap/status`); setDisabled(false); setModuleError(""); }
    catch (e) {
      if (e instanceof ApiError && e.code === "MODULE_DISABLED") setDisabled(true);
      else setModuleError(errorText(e));
    }
  };
  useEffect(() => { void check(); }, [principal?.organizationId]);
  const navigate = (v: SchoolView) => { setView(v); sessionStorage.setItem("ledgerly.school.view", v); if(v === "fees") setFeesOpen(true); };
  const navigateFee = (v: FeeView) => { setFeeView(v); setView("fees"); setFeesOpen(true); sessionStorage.setItem("ledgerly.school.view", "fees"); sessionStorage.setItem("ledgerly.school.fees.view", v); };
  if (disabled) return <div className="page school-shell"><SchoolPageHeader title="School Management" text="A modular school operations workspace built on Ledgerly's existing identity and accounting engine."/><Card className="school-module-disabled"><School size={38}/><h2>School Management is not enabled</h2><p>Enable the module for this organization to configure academics, users, admissions and students.</p>{can(principal,"admin:write")?<Button disabled={enabling} onClick={async()=>{setEnabling(true);try{await Promise.race([post("/modules/school-management/enable",{configuration:{}}),new Promise(resolve=>setTimeout(resolve,6000))]);await check()}catch(e){setModuleError(errorText(e))}finally{setEnabling(false)}}}>{enabling?"Enabling…":"Enable School Management"}</Button>:<Notice tone="warning">Ask an organization owner or administrator to enable this module.</Notice>}{moduleError&&<Notice tone="danger">{moduleError}</Notice>}</Card></div>;
  return <div className="school-module-layout">
    <aside className="school-module-sidebar">
      <div className="school-module-brand"><span className="school-mark"><School size={21}/></span><div><strong>School Management</strong><small>Academic administration</small></div></div>
      <nav aria-label="School management navigation">
        {schoolNav.slice(0,4).map(item=>{const Icon=item.icon;return <button key={item.key} className={view===item.key?"active":""} onClick={()=>navigate(item.key)}><Icon size={18}/><span>{item.label}</span></button>})}
        <div className={`school-nav-tree ${view==="fees"?"is-active":""}`}>
          <button className={`school-nav-parent ${view==="fees"?"active":""}`} onClick={()=>{setFeesOpen(x=>!x);if(view!=="fees")navigateFee("overview")}} aria-expanded={feesOpen}>
            <CircleDollarSign size={18}/><span>Fees & billing</span>{feesOpen?<ChevronDown className="school-nav-chevron" size={14}/>:<ChevronRight className="school-nav-chevron" size={14}/>}
          </button>
          {feesOpen&&<div className="school-nav-branch">
            <button className={`school-nav-child ${view==="fees"&&feeView==="overview"?"active":""}`} onClick={()=>navigateFee("overview")}><span className="school-nav-dot"/>Fees overview</button>
            {feeNavGroups.map(group=>{const Icon=group.icon,open=feeGroupsOpen[group.key];return <div className="school-nav-subtree" key={group.key}>
              <button className="school-nav-group" onClick={()=>setFeeGroupsOpen(x=>({...x,[group.key]:!x[group.key]}))} aria-expanded={open}><Icon size={14}/><span>{group.label}</span>{open?<ChevronDown className="school-nav-chevron" size={12}/>:<ChevronRight className="school-nav-chevron" size={12}/>}</button>
              {open&&<div className="school-nav-subbranch">{group.items.map(item=><button key={item.key} className={`school-nav-subchild ${view==="fees"&&feeView===item.key?"active":""}`} onClick={()=>navigateFee(item.key)}>{item.label}</button>)}</div>}
            </div>})}
          </div>}
        </div>
        {schoolNav.slice(4).map(item=>{const Icon=item.icon;return <button key={item.key} className={view===item.key?"active":""} onClick={()=>navigate(item.key)}><Icon size={18}/><span>{item.label}</span></button>})}
      </nav>
      <div className="school-module-sidebar-foot"><button onClick={()=>{location.hash="#dashboards"}}><ArrowLeft size={17}/><span>Back to Ledgerly</span></button><small><Check size={12}/> School module active</small></div>
    </aside>
    <div className="page school-shell school-module-content">
      {moduleError&&<Notice tone="danger">{moduleError}</Notice>}
      {view === "overview" && <SchoolOverview onNavigate={navigate}/>} 
      {view === "students" && <StudentsWorkspace/>}
      {view === "admissions" && <AdmissionsWorkspace/>}
      {view === "staff" && <StaffWorkspace/>}
      {view === "fees" && <SchoolFeesWorkspace view={feeView} onNavigate={navigateFee}/>}
      {view === "promotion" && <PromotionWorkspace/>}
      {view === "discipline" && <DisciplineWorkspace/>}
      {view === "people" && <SchoolPeopleWorkspace/>}
      {view === "setup" && <SchoolSetupWorkspace/>}
    </div>
  </div>;
}

function SchoolOverview({ onNavigate }: { onNavigate: (v: SchoolView) => void }) {
  const status = useLoad<R>(`${schoolBase}/setup/bootstrap/status`, {});
  const profile = useLoad<R | null>(`${schoolBase}/setup/profile`, null);
  const years = useLoad<R[]>(`${schoolBase}/setup/academicYears?limit=100`, []);
  const terms = useLoad<R[]>(`${schoolBase}/setup/terms?limit=100`, []);
  const enrollment = useLoad<R[]>(`${schoolBase}/student-management/reports/enrollment`, []);
  const demographics = useLoad<R[]>(`${schoolBase}/student-management/reports/demographics`, []);
  const admissions = useLoad<R[]>(`${schoolBase}/student-management/admissions?limit=100`, []);
  const currentYear = years.data.find(x=>bool(x.isCurrent)) || years.data.find(x=>x.status==="active");
  const currentTerm = terms.data.find(x=>bool(x.isCurrent)) || terms.data.find(x=>x.status==="active");
  const students = enrollment.data.reduce((n,r)=>n+Number(r.students||0),0);
  const pending = admissions.data.filter(x=>["submitted","screening","waitlisted","approved"].includes(x.status)).length;
  const setupSteps = [
    ["School profile",status.data.profile],["Academic year",status.data.academicYear],["Current term",status.data.term],
    ["Class levels",status.data.classLevels],["Subjects",status.data.subjects],["Fee categories",status.data.feeCategories],["School roles",status.data.roles]
  ];
  return <>
    <SchoolPageHeader title={profile.data?.schoolName || "School overview"} text="A calm overview of the school, academic cycle, enrollment and setup readiness." action={<><Button variant="secondary" onClick={()=>onNavigate("admissions")}><ClipboardCheck/> Admissions</Button><Button onClick={()=>onNavigate("students")}><UserPlus/> Add student</Button></>}/>
    <div className="school-metrics">
      <Card><span className="school-metric-icon"><GraduationCap/></span><small>Students</small><strong>{students.toLocaleString()}</strong><em>Current enrollment groups</em></Card>
      <Card><span className="school-metric-icon"><ClipboardCheck/></span><small>Open admissions</small><strong>{pending}</strong><em>Awaiting enrollment or decision</em></Card>
      <Card><span className="school-metric-icon"><CalendarDays/></span><small>Academic year</small><strong>{currentYear?.name || "Not set"}</strong><em>{currentYear ? `${currentYear.startsOn} → ${currentYear.endsOn}` : "Configure the current year"}</em></Card>
      <Card><span className="school-metric-icon"><BookOpen/></span><small>Current term</small><strong>{currentTerm?.name || "Not set"}</strong><em>{currentTerm ? `${currentTerm.startsOn} → ${currentTerm.endsOn}` : "Configure the current term"}</em></Card>
    </div>
    <div className="school-two-col">
      <Card className="school-panel"><div className="school-panel-head"><div><h2>Setup readiness</h2><p>Core records required before daily school operations begin.</p></div><button onClick={()=>onNavigate("setup")}>Open setup <ChevronRight size={15}/></button></div>{status.loading?<Spinner/>:<div className="school-checks">{setupSteps.map(([label,done])=><div key={String(label)}><span className={done?"done":""}>{done?<Check size={14}/>:<span/>}</span><b>{String(label)}</b><small>{done?"Configured":"Needs attention"}</small></div>)}</div>}</Card>
      <Card className="school-panel"><div className="school-panel-head"><div><h2>Student snapshot</h2><p>Population distribution from student records.</p></div><button onClick={()=>onNavigate("students")}>View students <ChevronRight size={15}/></button></div>{demographics.loading?<Spinner/>:demographics.data.length?<div className="school-stat-list">{demographics.data.slice(0,7).map((r,i)=><div key={i}><span><b>{r.gender||"Not specified"}</b><small>{[r.nationality,r.residencyStatus,r.status].filter(Boolean).map(words).join(" · ")}</small></span><strong>{Number(r.students||0).toLocaleString()}</strong></div>)}</div>:<EmptyState title="No student statistics yet" description="Students will appear here after admission or manual enrollment."/>}</Card>
    </div>
    <Card className="school-panel school-quick"><div className="school-panel-head"><div><h2>Quick work</h2><p>Common school administration tasks without exposing a long sidebar.</p></div></div><div className="school-action-grid"><button onClick={()=>onNavigate("students")}><GraduationCap/><span><b>Student records</b><small>Profiles, guardians, medical data, transfers and promotions.</small></span></button><button onClick={()=>onNavigate("admissions")}><ClipboardCheck/><span><b>Admissions desk</b><small>Applications, screening, decisions and enrollment.</small></span></button><button onClick={()=>onNavigate("people")}><UserCog/><span><b>People & access</b><small>Users, school roles, security policy and sessions.</small></span></button><button onClick={()=>onNavigate("setup")}><Settings2/><span><b>Academic setup</b><small>Campuses, years, classes, subjects, grading and defaults.</small></span></button></div></Card>
  </>;
}

const setupConfigs: SetupConfig[] = [
  {key:"branches",title:"Branches & campuses",singular:"campus",description:"School campuses, contact details and campus leadership.",group:"school",columns:[{key:"code",label:"Code"},{key:"name",label:"Campus"},{key:"districtRegion",label:"District / region"},{key:"principalName",label:"Principal"},{key:"active",label:"Status"}],fields:[{key:"code",label:"Campus code",required:true},{key:"name",label:"Campus name",required:true},{key:"registrationNumber",label:"Registration number"},{key:"phone",label:"Telephone"},{key:"email",label:"Email",type:"email"},{key:"physicalAddress",label:"Physical address",type:"textarea",full:true},{key:"postalAddress",label:"Postal address"},{key:"districtRegion",label:"District / region"},{key:"locationText",label:"Location"},{key:"principalName",label:"Principal / head"},{key:"isMain",label:"Main campus",type:"checkbox",defaultValue:false},{key:"active",label:"Active",type:"checkbox",defaultValue:true}]},
  {key:"academicYears",title:"Academic years",singular:"academic year",description:"Opening and closing dates, current year and year lifecycle.",group:"academic",columns:[{key:"code",label:"Code"},{key:"name",label:"Year"},{key:"startsOn",label:"Opens"},{key:"endsOn",label:"Closes"},{key:"status",label:"Status"},{key:"isCurrent",label:"Current"}],fields:[{key:"code",label:"Code",required:true},{key:"name",label:"Name",required:true},{key:"startsOn",label:"Opening date",type:"date",required:true},{key:"endsOn",label:"Closing date",type:"date",required:true},{key:"status",label:"Status",type:"select",options:["planned","active","closed","archived"].map(v=>({value:v,label:words(v)})),defaultValue:"planned"},{key:"isCurrent",label:"Current academic year",type:"checkbox",defaultValue:false}]},
  {key:"terms",title:"Terms / semesters",singular:"term",description:"Academic periods within a school year.",group:"academic",columns:[{key:"code",label:"Code"},{key:"name",label:"Term"},{key:"sequenceNo",label:"Order"},{key:"startsOn",label:"Opens"},{key:"endsOn",label:"Closes"},{key:"status",label:"Status"}],fields:[{key:"academicYearId",label:"Academic year",type:"select",source:"academicYears",required:true},{key:"code",label:"Code",required:true},{key:"name",label:"Name",required:true},{key:"sequenceNo",label:"Sequence",type:"number",required:true,defaultValue:1},{key:"startsOn",label:"Opening date",type:"date",required:true},{key:"endsOn",label:"Closing date",type:"date",required:true},{key:"status",label:"Status",type:"select",options:["planned","active","closed","archived"].map(v=>({value:v,label:words(v)})),defaultValue:"planned"},{key:"isCurrent",label:"Current term",type:"checkbox",defaultValue:false}]},
  {key:"departments",title:"Departments",singular:"department",description:"Academic and administrative departments with optional heads.",group:"academic",columns:[{key:"code",label:"Code"},{key:"name",label:"Department"},{key:"campusId",label:"Campus"},{key:"active",label:"Status"}],fields:[{key:"campusId",label:"Campus",type:"select",source:"branches"},{key:"code",label:"Code",required:true},{key:"name",label:"Name",required:true},{key:"description",label:"Description",type:"textarea",full:true},{key:"headUserId",label:"Department head",type:"select",source:"users"},{key:"parentId",label:"Parent department",type:"select",source:"departments"},{key:"active",label:"Active",type:"checkbox",defaultValue:true}]},
  {key:"classLevels",title:"Class levels / grades",singular:"class level",description:"Ordered grade levels and promotion targets.",group:"academic",columns:[{key:"code",label:"Code"},{key:"name",label:"Level"},{key:"sequenceNo",label:"Order"},{key:"educationLevel",label:"Education level"},{key:"terminal",label:"Terminal"}],fields:[{key:"code",label:"Code",required:true},{key:"name",label:"Name",required:true},{key:"sequenceNo",label:"Sequence",type:"number",required:true,defaultValue:1},{key:"educationLevel",label:"Education level"},{key:"promotionLevelId",label:"Next level",type:"select",source:"classLevels"},{key:"terminal",label:"Terminal class",type:"checkbox",defaultValue:false},{key:"active",label:"Active",type:"checkbox",defaultValue:true}]},
  {key:"classes",title:"Classes",singular:"class",description:"Operational classes tied to year, level, campus and department.",group:"academic",columns:[{key:"code",label:"Code"},{key:"name",label:"Class"},{key:"classLevelId",label:"Level"},{key:"capacity",label:"Capacity"},{key:"active",label:"Status"}],fields:[{key:"academicYearId",label:"Academic year",type:"select",source:"academicYears"},{key:"campusId",label:"Campus",type:"select",source:"branches"},{key:"classLevelId",label:"Class level",type:"select",source:"classLevels",required:true},{key:"departmentId",label:"Department",type:"select",source:"departments"},{key:"code",label:"Code",required:true},{key:"name",label:"Name",required:true},{key:"capacity",label:"Capacity",type:"number"},{key:"classTeacherUserId",label:"Class teacher",type:"select",source:"users"},{key:"active",label:"Active",type:"checkbox",defaultValue:true}]},
  {key:"streams",title:"Streams / sections",singular:"stream",description:"Sections within classes with capacity and class teachers.",group:"academic",columns:[{key:"code",label:"Code"},{key:"name",label:"Stream"},{key:"classId",label:"Class"},{key:"capacity",label:"Capacity"},{key:"active",label:"Status"}],fields:[{key:"classId",label:"Class",type:"select",source:"classes",required:true},{key:"campusId",label:"Campus",type:"select",source:"branches"},{key:"code",label:"Code",required:true},{key:"name",label:"Name",required:true},{key:"capacity",label:"Capacity",type:"number"},{key:"classTeacherUserId",label:"Class teacher",type:"select",source:"users"},{key:"active",label:"Active",type:"checkbox",defaultValue:true}]},
  {key:"subjects",title:"Subjects",singular:"subject",description:"Curriculum subjects, subject codes, pass marks and subject types.",group:"academic",columns:[{key:"code",label:"Code"},{key:"name",label:"Subject"},{key:"subjectType",label:"Type"},{key:"passMark",label:"Pass mark"},{key:"maxMark",label:"Max mark"}],fields:[{key:"departmentId",label:"Department",type:"select",source:"departments"},{key:"code",label:"Subject code",required:true},{key:"name",label:"Subject name",required:true},{key:"shortName",label:"Short name"},{key:"subjectType",label:"Subject type",type:"select",options:["compulsory","optional","elective"].map(v=>({value:v,label:words(v)})),defaultValue:"compulsory"},{key:"curriculumCode",label:"Curriculum code"},{key:"passMark",label:"Pass mark (%)",type:"number"},{key:"maxMark",label:"Maximum mark",type:"number",defaultValue:100},{key:"metadata",label:"Additional details",type:"settings",hint:"Add optional structured details without technical code.",full:true,defaultValue:{}},{key:"active",label:"Active",type:"checkbox",defaultValue:true}]},
  {key:"classSubjects",title:"Class-subject assignments",singular:"assignment",description:"Assign subjects and teachers to class levels and academic years.",group:"academic",columns:[{key:"classLevelId",label:"Class level"},{key:"subjectId",label:"Subject"},{key:"periodsPerWeek",label:"Periods / week"},{key:"compulsory",label:"Required"}],fields:[{key:"classLevelId",label:"Class level",type:"select",source:"classLevels",required:true},{key:"subjectId",label:"Subject",type:"select",source:"subjects",required:true},{key:"academicYearId",label:"Academic year",type:"select",source:"academicYears"},{key:"teacherUserId",label:"Teacher",type:"select",source:"users"},{key:"periodsPerWeek",label:"Periods per week",type:"number"},{key:"compulsory",label:"Compulsory",type:"checkbox",defaultValue:true},{key:"active",label:"Active",type:"checkbox",defaultValue:true}]},
  {key:"gradingScales",title:"Grading scales",singular:"grading scale",description:"Named grading systems by curriculum.",group:"assessment",columns:[{key:"code",label:"Code"},{key:"name",label:"Scale"},{key:"curriculum",label:"Curriculum"},{key:"isDefault",label:"Default"},{key:"active",label:"Status"}],fields:[{key:"code",label:"Code",required:true},{key:"name",label:"Name",required:true},{key:"curriculum",label:"Curriculum"},{key:"isDefault",label:"Default grading scale",type:"checkbox",defaultValue:false},{key:"active",label:"Active",type:"checkbox",defaultValue:true}]},
  {key:"gradeBoundaries",title:"Grade boundaries",singular:"grade boundary",description:"Score ranges, points, aggregates and remarks.",group:"assessment",columns:[{key:"grade",label:"Grade"},{key:"minScore",label:"Min"},{key:"maxScore",label:"Max"},{key:"points",label:"Points"},{key:"remark",label:"Remark"}],fields:[{key:"gradingScaleId",label:"Grading scale",type:"select",source:"gradingScales",required:true},{key:"grade",label:"Grade",required:true},{key:"minScore",label:"Minimum score",type:"number",required:true},{key:"maxScore",label:"Maximum score",type:"number",required:true},{key:"points",label:"Points",type:"number"},{key:"aggregatePoints",label:"Aggregate points",type:"number"},{key:"remark",label:"Remark"},{key:"colorHex",label:"Color (hex)",placeholder:"#149B67"},{key:"sequenceNo",label:"Sequence",type:"number",defaultValue:0}]},
  {key:"divisions",title:"Divisions",singular:"division",description:"Aggregate ranges and subject requirements for final divisions.",group:"assessment",columns:[{key:"code",label:"Code"},{key:"name",label:"Division"},{key:"minAggregate",label:"Min aggregate"},{key:"maxAggregate",label:"Max aggregate"},{key:"active",label:"Status"}],fields:[{key:"gradingScaleId",label:"Grading scale",type:"select",source:"gradingScales"},{key:"code",label:"Code",required:true},{key:"name",label:"Name",required:true},{key:"minAggregate",label:"Minimum aggregate",type:"number"},{key:"maxAggregate",label:"Maximum aggregate",type:"number"},{key:"minSubjects",label:"Minimum subjects",type:"number"},{key:"sequenceNo",label:"Sequence",type:"number",defaultValue:0},{key:"rule",label:"Advanced conditions",type:"settings",hint:"Add optional conditions as clear name/value settings.",full:true,defaultValue:{}},{key:"active",label:"Active",type:"checkbox",defaultValue:true}]},
  {key:"assessmentTypes",title:"Assessment types",singular:"assessment type",description:"Tests, coursework, mocks and examination weights.",group:"assessment",columns:[{key:"code",label:"Code"},{key:"name",label:"Assessment"},{key:"weightPercent",label:"Weight %"},{key:"maxScore",label:"Max score"},{key:"active",label:"Status"}],fields:[{key:"code",label:"Code",required:true},{key:"name",label:"Name",required:true},{key:"weightPercent",label:"Weight (%)",type:"number",defaultValue:100},{key:"maxScore",label:"Maximum score",type:"number",defaultValue:100},{key:"sequenceNo",label:"Sequence",type:"number",defaultValue:0},{key:"active",label:"Active",type:"checkbox",defaultValue:true}]},
  {key:"promotionRules",title:"Promotion rules",singular:"promotion rule",description:"Automatic and manual promotion thresholds by class level.",group:"assessment",columns:[{key:"name",label:"Rule"},{key:"classLevelId",label:"Class level"},{key:"minimumAverage",label:"Min average"},{key:"minimumAttendancePercent",label:"Attendance"},{key:"active",label:"Status"}],fields:[{key:"classLevelId",label:"Class level",type:"select",source:"classLevels"},{key:"name",label:"Rule name",required:true},{key:"minimumAverage",label:"Minimum average (%)",type:"number"},{key:"maximumFailedSubjects",label:"Maximum failed subjects",type:"number"},{key:"minimumAttendancePercent",label:"Minimum attendance (%)",type:"number"},{key:"targetClassLevelId",label:"Promotion target",type:"select",source:"classLevels"},{key:"allowManualOverride",label:"Allow manual override",type:"checkbox",defaultValue:true},{key:"rule",label:"Additional conditions",type:"settings",hint:"Add optional promotion conditions.",full:true,defaultValue:{}},{key:"active",label:"Active",type:"checkbox",defaultValue:true}]},
  {key:"calendar",title:"School calendar",singular:"calendar event",description:"Holidays, school events, closures, weekends and teaching-day overrides.",group:"calendar",columns:[{key:"title",label:"Event"},{key:"eventType",label:"Type"},{key:"startsAt",label:"Starts"},{key:"endsAt",label:"Ends"},{key:"teachingDay",label:"Teaching day"}],fields:[{key:"campusId",label:"Campus",type:"select",source:"branches"},{key:"academicYearId",label:"Academic year",type:"select",source:"academicYears"},{key:"termId",label:"Term",type:"select",source:"terms"},{key:"eventType",label:"Event type",type:"select",required:true,options:["holiday","weekend","school_event","teaching_day_override","closure","other"].map(v=>({value:v,label:words(v)})),defaultValue:"school_event"},{key:"title",label:"Title",required:true},{key:"description",label:"Description",type:"textarea",full:true},{key:"startsAt",label:"Starts",type:"datetime-local",required:true},{key:"endsAt",label:"Ends",type:"datetime-local",required:true},{key:"allDay",label:"All day",type:"checkbox",defaultValue:true},{key:"teachingDay",label:"Counts as teaching day",type:"checkbox",defaultValue:false},{key:"recurrenceRule",label:"Recurrence rule",hint:"Optional RFC-style recurrence expression."}]},
  {key:"lessonPeriods",title:"Lesson periods",singular:"lesson period",description:"School opening timetable blocks, lessons, breaks and lunch periods.",group:"calendar",columns:[{key:"sequenceNo",label:"#"},{key:"code",label:"Code"},{key:"name",label:"Period"},{key:"startsAt",label:"Starts"},{key:"endsAt",label:"Ends"},{key:"periodType",label:"Type"}],fields:[{key:"campusId",label:"Campus",type:"select",source:"branches"},{key:"code",label:"Code",required:true},{key:"name",label:"Name",required:true},{key:"sequenceNo",label:"Sequence",type:"number",required:true,defaultValue:1},{key:"startsAt",label:"Start time",type:"time",required:true},{key:"endsAt",label:"End time",type:"time",required:true},{key:"periodType",label:"Period type",type:"select",options:["lesson","break","lunch","assembly","other"].map(v=>({value:v,label:words(v)})),defaultValue:"lesson"},{key:"teachingPeriod",label:"Teaching period",type:"checkbox",defaultValue:true},{key:"active",label:"Active",type:"checkbox",defaultValue:true}]},
  {key:"feeCategories",title:"Fee categories",singular:"fee category",description:"Accounting-linked fee categories used by Fees & Billing for invoices, receipts, discounts, reports and the general ledger.",group:"finance",columns:[{key:"code",label:"Code"},{key:"name",label:"Fee category"},{key:"mandatory",label:"Mandatory"},{key:"taxable",label:"Taxable"},{key:"active",label:"Status"}],fields:[{key:"code",label:"Code",required:true},{key:"name",label:"Name",required:true},{key:"description",label:"Description",type:"textarea",full:true},{key:"incomeAccountId",label:"Income account",type:"select",source:"accounts",filter:r=>r.type==="revenue"},{key:"receivableAccountId",label:"Receivable account",type:"select",source:"accounts",filter:r=>r.type==="asset"},{key:"productId",label:"Product / service",type:"select",source:"products"},{key:"taxable",label:"Taxable",type:"checkbox",defaultValue:false},{key:"taxCode",label:"Tax code"},{key:"refundable",label:"Refundable",type:"checkbox",defaultValue:false},{key:"mandatory",label:"Mandatory",type:"checkbox",defaultValue:false},{key:"metadata",label:"Additional settings",type:"settings",hint:"Optional fee-category settings.",full:true,defaultValue:{}},{key:"active",label:"Active",type:"checkbox",defaultValue:true}]},
  {key:"paymentMethods",title:"Payment methods",singular:"payment method",description:"Cash, bank, mobile money and other school collection methods.",group:"finance",columns:[{key:"code",label:"Code"},{key:"name",label:"Method"},{key:"methodType",label:"Type"},{key:"active",label:"Status"}],fields:[{key:"code",label:"Code",required:true},{key:"name",label:"Name",required:true},{key:"methodType",label:"Method type",type:"select",required:true,options:["cash","bank","mobile_money","card","cheque","online","other"].map(v=>({value:v,label:words(v)})),defaultValue:"cash"},{key:"accountId",label:"Ledger / bank account",type:"select",source:"accounts"},{key:"configuration",label:"Payment method settings",type:"settings",hint:"Optional provider or collection settings.",full:true,defaultValue:{}},{key:"active",label:"Active",type:"checkbox",defaultValue:true}]},
  {key:"templates",title:"Document templates",singular:"template",description:"Letterheads, receipts, invoices, report cards, IDs and school documents.",group:"documents",columns:[{key:"templateType",label:"Type"},{key:"name",label:"Template"},{key:"version",label:"Version"},{key:"isDefault",label:"Default"},{key:"active",label:"Status"}],fields:[{key:"campusId",label:"Campus",type:"select",source:"branches"},{key:"templateType",label:"Template type",type:"select",required:true,options:["letterhead","receipt","invoice","report_card","id_card","admission","transfer","other"].map(v=>({value:v,label:words(v)}))},{key:"name",label:"Template name",required:true},{key:"version",label:"Version",type:"number",defaultValue:1},{key:"content",label:"Template options",type:"settings",hint:"Optional template settings. Upload the actual design file below.",full:true,defaultValue:{}},{key:"fileId",label:"Template file",type:"file",full:true,hint:"Upload a PDF, Word document, image or other supported template file."},{key:"isDefault",label:"Default for this type",type:"checkbox",defaultValue:false},{key:"active",label:"Active",type:"checkbox",defaultValue:true}]},
];

const setupGroups = [
  {key:"school",label:"School & campuses",description:"Profile, identity, branches and multi-campus setup",icon:Building2},
  {key:"academic",label:"Academic structure",description:"Years, terms, classes, streams, departments and subjects",icon:BookOpen},
  {key:"assessment",label:"Assessment & promotion",description:"Grades, points, divisions, assessments and promotion rules",icon:ClipboardCheck},
  {key:"calendar",label:"Calendar & periods",description:"Teaching days, holidays, events and lesson periods",icon:CalendarDays},
  {key:"finance",label:"Finance configuration",description:"Fee categories and accepted payment methods",icon:FileText},
  {key:"documents",label:"Templates & defaults",description:"Documents, numbering, communication and system preferences",icon:Settings2},
] as const;

type LookupMap = Record<string,R[]>;
function optionLabel(source: string, row: R) {
  if (source === "users") return `${row.displayName || row.email}${row.staffNumber?` · ${row.staffNumber}`:""}`;
  if (source === "accounts") return `${row.code || ""}${row.code?" · ":""}${row.name || row.id}`;
  if (source === "products") return `${row.sku || ""}${row.sku?" · ":""}${row.name || row.id}`;
  return `${row.code || ""}${row.code?" · ":""}${row.name || row.title || row.id}`;
}

function SchoolSetupWorkspace() {
  const { principal } = useAuth();
  const write = can(principal,"school:write");
  const [section,setSection] = useState<string>("home");
  const [lookups,setLookups] = useState<LookupMap>({});
  const [lookupLoading,setLookupLoading] = useState(false);
  const defaultsStatus = useLoad<R>(`${schoolBase}/setup/bootstrap/status`,{});
  const [defaultsBusy,setDefaultsBusy]=useState(false);
  const [defaultsMessage,setDefaultsMessage]=useState("");
  const loadLookups = async () => {
    setLookupLoading(true);
    const sources: Array<[string,string]> = [
      ["branches",`${schoolBase}/setup/branches?limit=500`],["academicYears",`${schoolBase}/setup/academicYears?limit=500`],["terms",`${schoolBase}/setup/terms?limit=500`],
      ["departments",`${schoolBase}/setup/departments?limit=500`],["classLevels",`${schoolBase}/setup/classLevels?limit=500`],["classes",`${schoolBase}/setup/classes?limit=500`],
      ["streams",`${schoolBase}/setup/streams?limit=500`],["subjects",`${schoolBase}/setup/subjects?limit=500`],["gradingScales",`${schoolBase}/setup/gradingScales?limit=500`],
      ["users",`${schoolBase}/iam/users`],["accounts","/accounts?limit=500"],["products","/products?limit=500"]
    ];
    const entries = await Promise.all(sources.map(async([k,p])=>{try{return [k,await get<R[]>(p)] as const}catch{return [k,[]] as const}}));
    setLookups(Object.fromEntries(entries)); setLookupLoading(false);
  };
  useEffect(()=>{void loadLookups()},[principal?.organizationId]);
  const selected = setupConfigs.find(x=>x.key===section);
  if (section === "profile") return <SchoolProfile onBack={()=>setSection("home")}/>;
  if (section === "settings") return <SchoolSettings onBack={()=>setSection("home")} lookups={lookups}/>;
  if (selected) return <SetupResource config={selected} lookups={lookups} write={write} onBack={()=>setSection("home")} onChanged={loadLookups}/>;
  const smart=defaultsStatus.data?.smartDefaults?.counts||{};
  async function restoreDefaults(){setDefaultsBusy(true);setDefaultsMessage("");try{const r=await post<R>(`${schoolBase}/setup/bootstrap/defaults`,{});const made=r.created||{};const total=Object.values(made).reduce((n:any,v:any)=>Number(n)+Number(v||0),0);setDefaultsMessage(total?`Standard defaults restored. ${total} missing records were added.`:"Standard defaults are already complete.");await Promise.all([defaultsStatus.load(),loadLookups()])}catch(e){setDefaultsMessage(errorText(e))}finally{setDefaultsBusy(false)}}
  return <>
    <SchoolPageHeader title="School setup" text="Configure the school in logical groups. The main sidebar stays simple while detailed setup lives here."/>
    <Card className="school-panel"><div className="school-panel-head"><div><h2>Smart school defaults</h2><p>Ledgerly automatically prepares nursery and primary-school defaults so a new school can start working immediately. Nursery uses Learning Area 1–6; P1–P7 use the standard primary subject list. Existing custom records are never overwritten.</p></div>{write&&<Button variant="secondary" disabled={defaultsBusy} onClick={()=>void restoreDefaults()}><RefreshCw size={15}/>{defaultsBusy?"Restoring…":"Restore missing defaults"}</Button>}</div><div className="school-checks"><div><span className="done"><Check size={14}/></span><b>Academic calendar</b><small>{smart.academicYears||0} years · {smart.terms||0} terms</small></div><div><span className="done"><Check size={14}/></span><b>Classes & levels</b><small>{smart.classLevels||0} levels · {smart.classes||0} classes</small></div><div><span className="done"><Check size={14}/></span><b>Subjects by level</b><small>{smart.subjects||0} subjects · {smart.classSubjects||0} assignments</small></div><div><span className="done"><Check size={14}/></span><b>Fees & accounting</b><small>{smart.feeCategories||0} fee names · {smart.schoolAccounts||0} school accounts</small></div><div><span className="done"><Check size={14}/></span><b>Payment methods</b><small>{smart.paymentMethods||0} standard methods</small></div><div><span className="done"><Check size={14}/></span><b>Discipline defaults</b><small>{smart.offenceTypes||0} common offence types</small></div></div>{defaultsMessage&&<div className="ops-pad"><Notice tone={defaultsMessage.toLowerCase().includes("error")?"danger":"success"}>{defaultsMessage}</Notice></div>}<div className="ops-pad"><small>Defaults cover Nursery and P1–P7 only. No secondary classes or subjects are created. Fee amounts, stream names, lesson periods and school-specific policies remain for the school to configure.</small></div></Card>
    {lookupLoading&&<div className="school-inline-loading"><RefreshCw size={14}/> Refreshing setup references…</div>}
    <div className="school-setup-groups">{setupGroups.map(group=>{const Icon=group.icon;const configs=setupConfigs.filter(x=>x.group===group.key);return <Card key={group.key} className="school-setup-card"><div className="school-setup-card-title"><span><Icon/></span><div><h2>{group.label}</h2><p>{group.description}</p></div></div><div className="school-setup-links">{group.key==="school"&&<button onClick={()=>setSection("profile")}><b>School profile</b><small>Name, contacts, location, leadership, curriculum and branding</small><ChevronRight/></button>}{configs.map(c=><button key={c.key} onClick={()=>setSection(c.key)}><b>{c.title}</b><small>{c.description}</small><ChevronRight/></button>)}{group.key==="documents"&&<button onClick={()=>setSection("settings")}><b>System preferences</b><small>Numbering, attendance, exams, notifications, channels and imports</small><ChevronRight/></button>}</div></Card>})}</div>
  </>;
}

function BackLink({ onClick, children="Back to school setup" }: { onClick:()=>void; children?:ReactNode }) { return <button className="school-back" onClick={onClick}>← {children}</button>; }

function SchoolProfile({onBack}:{onBack:()=>void}) {
  const {principal}=useAuth(),write=can(principal,"school:write");
  const data=useLoad<R|null>(`${schoolBase}/setup/profile`,null);
  const [form,setForm]=useState<R>({}); const [saving,setSaving]=useState(false); const [message,setMessage]=useState("");
  useEffect(()=>{if(data.data)setForm({
    ...data.data,
    phoneNumbers:Array.isArray(data.data.phoneNumbers)?data.data.phoneNumbers.join(", "):data.data.phoneNumbers||"",
    emailAddresses:Array.isArray(data.data.emailAddresses)?data.data.emailAddresses.join(", "):data.data.emailAddresses||"",
    branding:data.data.branding&&typeof data.data.branding==="object"?data.data.branding:{},
    systemPreferences:data.data.systemPreferences&&typeof data.data.systemPreferences==="object"?data.data.systemPreferences:{},
  })},[data.data]);
  const change=(k:string,v:any)=>setForm(x=>({...x,[k]:v}));
  async function save(e:FormEvent){
    e.preventDefault();setSaving(true);setMessage("");
    try{
      await put(`${schoolBase}/setup/profile`,{
        schoolCode:form.schoolCode,
        registrationNumber:form.registrationNumber||null,
        logoUrl:null,
        logoFileId:form.logoFileId||null,
        motto:form.motto||null,
        schoolType:form.schoolType||"day",
        ownershipType:form.ownershipType||null,
        educationLevel:form.educationLevel||null,
        curriculum:form.curriculum||null,
        phoneNumbers:String(form.phoneNumbers||"").split(",").map(x=>x.trim()).filter(Boolean),
        emailAddresses:String(form.emailAddresses||"").split(",").map(x=>x.trim()).filter(Boolean),
        website:form.website||null,
        physicalAddress:form.physicalAddress||null,
        postalAddress:form.postalAddress||null,
        country:form.country||"Uganda",
        districtRegion:form.districtRegion||null,
        locationText:form.locationText||null,
        headTeacherName:form.headTeacherName||null,
        headTeacherPhone:form.headTeacherPhone||null,
        headTeacherEmail:form.headTeacherEmail||null,
        language:form.language||"en",
        timezone:form.timezone||"Africa/Kampala",
        dateFormat:form.dateFormat||"DD/MM/YYYY",
        timeFormat:form.timeFormat||"24h",
        defaultCurrency:String(form.defaultCurrency||"UGX").toUpperCase(),
        multiCampusEnabled:!!form.multiCampusEnabled,
        branding:form.branding||{},
        systemPreferences:form.systemPreferences||{},
      });
      setMessage("School profile saved.");await data.load();
    }catch(e){setMessage(errorText(e))}finally{setSaving(false)}
  }
  if(data.loading)return <><BackLink onClick={onBack}/><Spinner/></>;
  return <><BackLink onClick={onBack}/><SchoolPageHeader title="School profile" text="Official school identity, contact information, leadership, curriculum and localization."/><Card className="school-form-card"><form onSubmit={save}><div className="form-grid">
    <Field label="School name"><input value={form.schoolName||""} disabled/></Field>
    <Field label="School code"><input value={form.schoolCode||""} onChange={e=>change("schoolCode",e.target.value)} required disabled={!write}/></Field>
    <Field label="Registration number"><input value={form.registrationNumber||""} onChange={e=>change("registrationNumber",e.target.value)} disabled={!write}/></Field>
    <Field label="Motto"><input value={form.motto||""} onChange={e=>change("motto",e.target.value)} disabled={!write}/></Field>
    <Field label="School type"><select value={form.schoolType||"day"} onChange={e=>change("schoolType",e.target.value)} disabled={!write}><option value="day">Day</option><option value="boarding">Boarding</option><option value="day_boarding">Day & boarding</option><option value="online">Online</option><option value="other">Other</option></select></Field>
    <Field label="Ownership type"><select value={form.ownershipType||""} onChange={e=>change("ownershipType",e.target.value)} disabled={!write}><option value="">Not specified</option><option value="private">Private</option><option value="government">Government</option><option value="community">Community</option><option value="faith_based">Faith-based</option><option value="public_private">Public-private partnership</option><option value="other">Other</option></select></Field>
    <Field label="Education level"><select value={form.educationLevel||""} onChange={e=>change("educationLevel",e.target.value)} disabled={!write}><option value="nursery_primary">Nursery & Primary</option><option value="primary">Primary only</option><option value="nursery">Nursery only</option></select></Field>
    <Field label="Curriculum"><input value={form.curriculum||""} placeholder="e.g. Uganda National Curriculum" onChange={e=>change("curriculum",e.target.value)} disabled={!write}/></Field>
    <Field label="Telephone numbers" hint="Separate multiple numbers with commas"><input value={form.phoneNumbers||""} onChange={e=>change("phoneNumbers",e.target.value)} disabled={!write}/></Field>
    <Field label="Email addresses" hint="Separate multiple emails with commas"><input value={form.emailAddresses||""} onChange={e=>change("emailAddresses",e.target.value)} disabled={!write}/></Field>
    <Field label="Website"><input type="url" value={form.website||""} onChange={e=>change("website",e.target.value)} disabled={!write}/></Field>
    <Field label="School logo"><SchoolFileUpload purpose="school-logo" accept="image/*" disabled={!write} valueName={form.logoFileName||form.logoOriginalName||undefined} onChange={file=>change("logoFileId",file?.id||"")}/></Field>
    <Field label="Physical address"><textarea value={form.physicalAddress||""} onChange={e=>change("physicalAddress",e.target.value)} disabled={!write}/></Field>
    <Field label="Postal address"><textarea value={form.postalAddress||""} onChange={e=>change("postalAddress",e.target.value)} disabled={!write}/></Field>
    <Field label="Country"><input value={form.country||"Uganda"} onChange={e=>change("country",e.target.value)} disabled={!write}/></Field>
    <Field label="District / region"><input value={form.districtRegion||""} onChange={e=>change("districtRegion",e.target.value)} disabled={!write}/></Field>
    <Field label="School location"><input value={form.locationText||""} onChange={e=>change("locationText",e.target.value)} disabled={!write}/></Field>
    <Field label="Head teacher / principal"><input value={form.headTeacherName||""} onChange={e=>change("headTeacherName",e.target.value)} disabled={!write}/></Field>
    <Field label="Head teacher phone"><input value={form.headTeacherPhone||""} onChange={e=>change("headTeacherPhone",e.target.value)} disabled={!write}/></Field>
    <Field label="Head teacher email"><input type="email" value={form.headTeacherEmail||""} onChange={e=>change("headTeacherEmail",e.target.value)} disabled={!write}/></Field>
    <Field label="Timezone"><select value={form.timezone||"Africa/Kampala"} onChange={e=>change("timezone",e.target.value)} disabled={!write}><option value="Africa/Kampala">Africa/Kampala</option><option value="Africa/Nairobi">Africa/Nairobi</option><option value="UTC">UTC</option></select></Field>
    <Field label="Language"><select value={form.language||"en"} onChange={e=>change("language",e.target.value)} disabled={!write}><option value="en">English</option><option value="lg">Luganda</option><option value="sw">Swahili</option><option value="fr">French</option></select></Field>
    <Field label="Date format"><select value={form.dateFormat||"DD/MM/YYYY"} onChange={e=>change("dateFormat",e.target.value)} disabled={!write}><option>DD/MM/YYYY</option><option>MM/DD/YYYY</option><option>YYYY-MM-DD</option></select></Field>
    <Field label="Time format"><select value={form.timeFormat||"24h"} onChange={e=>change("timeFormat",e.target.value)} disabled={!write}><option value="24h">24-hour</option><option value="12h">12-hour</option></select></Field>
    <Field label="Default currency"><select value={form.defaultCurrency||"UGX"} onChange={e=>change("defaultCurrency",e.target.value)} disabled={!write}><option value="UGX">UGX — Uganda Shilling</option><option value="USD">USD — US Dollar</option><option value="KES">KES — Kenya Shilling</option><option value="TZS">TZS — Tanzania Shilling</option><option value="EUR">EUR — Euro</option><option value="GBP">GBP — Pound Sterling</option></select></Field>
    <Field label="Multi-campus"><label className="school-check"><input type="checkbox" checked={!!form.multiCampusEnabled} onChange={e=>change("multiCampusEnabled",e.target.checked)} disabled={!write}/> Enable multiple campuses / branches</label></Field>
    <div className="school-field-full"><Field label="Branding options" hint="Add optional portal or visual settings as clear name/value fields."><SettingsEditor value={form.branding||{}} onChange={v=>change("branding",v)} disabled={!write}/></Field></div>
    <div className="school-field-full"><Field label="Additional school preferences" hint="Optional organization-wide settings used by school modules."><SettingsEditor value={form.systemPreferences||{}} onChange={v=>change("systemPreferences",v)} disabled={!write}/></Field></div>
  </div>{message&&<Notice tone={message.includes("saved")?"success":"danger"}>{message}</Notice>}{write&&<div className="modal-actions"><Button disabled={saving}>{saving?"Saving…":"Save school profile"}</Button></div>}</form></Card></>;
}

function SetupResource({config,lookups,write,onBack,onChanged}:{config:SetupConfig;lookups:LookupMap;write:boolean;onBack:()=>void;onChanged:()=>void|Promise<void>}) {
  const rows=useLoad<R[]>(`${schoolBase}/setup/${config.key}?limit=500`,[]);
  const [q,setQ]=useState(""); const [edit,setEdit]=useState<R|null|undefined>(undefined); const [confirm,setConfirm]=useState<R|null>(null); const [termToClose,setTermToClose]=useState<R|null>(null); const [message,setMessage]=useState("");
  const filtered=rows.data.filter(r=>JSON.stringify(r).toLowerCase().includes(q.toLowerCase()));
  const labelFor=(fieldKey:string,v:any)=>{const f=config.fields.find(x=>x.key===fieldKey);if(!f?.source)return displayValue(v);const row=(lookups[f.source]||[]).find(x=>x.id===v);return row?optionLabel(f.source,row):displayValue(v)};
  async function remove(){if(!confirm)return;try{await del(`${schoolBase}/setup/${config.key}/${confirm.id}`);setConfirm(null);setMessage(`${config.singular} deleted.`);await rows.load();await onChanged()}catch(e){setMessage(errorText(e))}}
  async function closeTerm(){if(!termToClose)return;try{const result=await post<R>(`${schoolBase}/setup/terms/${termToClose.id}/close`,{}),impact=result.impact||{};setTermToClose(null);setMessage(`Term closed safely. ${impact.activeStudents||0} active students and ${impact.postedJournalEntries||0} posted journal entries were preserved; no finance accounts or student placements were changed.${impact.nextTerm?` ${impact.nextTerm} is now active.`:""}`);await rows.load();await onChanged()}catch(e){setMessage(errorText(e))}}
  return <><BackLink onClick={onBack}/><SchoolPageHeader title={config.title} text={config.description} action={write?<Button onClick={()=>setEdit(null)}><Plus/> New {config.singular}</Button>:undefined}/>{message&&<Notice tone={message.includes("deleted")||message.includes("saved")||message.includes("closed safely")?"success":"danger"}>{message}</Notice>}<Card className="school-panel"><div className="school-table-toolbar"><label><Search size={16}/><input placeholder={`Search ${config.title.toLowerCase()}…`} value={q} onChange={e=>setQ(e.target.value)}/></label><Button variant="secondary" onClick={()=>void rows.load()}><RefreshCw/> Refresh</Button></div>{rows.loading?<Spinner/>:rows.error?<Notice tone="danger">{rows.error}</Notice>:filtered.length?<div className="table-wrap school-table"><table><thead><tr>{config.columns.map(c=><th key={c.key}>{c.label}</th>)}{write&&<th/>}</tr></thead><tbody>{filtered.map(r=><tr key={r.id}>{config.columns.map(c=><td key={c.key}>{typeof r[c.key]==="boolean"||c.key==="active"||c.key.startsWith("is")||["terminal","mandatory","taxable","compulsory","teachingDay"].includes(c.key)?<Status value={bool(r[c.key])?"active":"inactive"}/>:labelFor(c.key,r[c.key])}</td>)}{write&&<td><div className="row-actions">{config.key==="terms"&&r.status==="active"&&<button onClick={()=>setTermToClose(r)}>End term</button>}<button onClick={()=>setEdit(r)}>Edit</button><button className="school-danger-link" onClick={()=>setConfirm(r)}>Delete</button></div></td>}</tr>)}</tbody></table></div>:<EmptyState title={`No ${config.title.toLowerCase()} yet`} description={`Create the first ${config.singular} when your school is ready.`} action={write?<Button onClick={()=>setEdit(null)}><Plus/> Add {config.singular}</Button>:undefined}/>}</Card>{edit!==undefined&&<SetupRecordModal config={config} record={edit} lookups={lookups} close={()=>setEdit(undefined)} done={async()=>{setEdit(undefined);setMessage(`${config.singular} saved.`);await rows.load();await onChanged()}}/>}{termToClose&&<ConfirmModal title={`End ${termToClose.name}?`} text="This closes the academic term and activates the next term when available. Student placements, fee balances, journal entries and finance accounts are preserved exactly as they are." close={()=>setTermToClose(null)} run={closeTerm}/>} {confirm&&<ConfirmModal title={`Delete ${config.singular}?`} text={`This permanently removes “${confirm.name||confirm.title||confirm.code||config.singular}”. Records already in use will be protected by the server.`} danger close={()=>setConfirm(null)} run={remove}/>}</>;
}

function SetupRecordModal({config,record,lookups,close,done}:{config:SetupConfig;record:R|null;lookups:LookupMap;close:()=>void;done:()=>void}) {
  const initial=Object.fromEntries(config.fields.map(f=>[f.key,record?.[f.key] ?? f.defaultValue ?? (f.type==="checkbox"?false:f.type==="settings"?{}:"")]));
  const [value,setValue]=useState<R>(initial); const [busy,setBusy]=useState(false); const [error,setError]=useState("");
  const change=(k:string,v:any)=>setValue(x=>({...x,[k]:v}));
  async function save(e:FormEvent){
    e.preventDefault();setBusy(true);setError("");
    try{
      const payload:R={};
      for(const f of config.fields){
        let v=value[f.key];
        if(f.type==="number")v=v===""||v==null?null:Number(v);
        if(f.type==="settings")v=v&&typeof v==="object"&&!Array.isArray(v)?v:{};
        if(f.type==="checkbox")v=!!v;
        if(v===""&&!f.required)v=null;
        payload[f.key]=v;
      }
      if(record)await put(`${schoolBase}/setup/${config.key}/${record.id}`,payload);else await post(`${schoolBase}/setup/${config.key}`,payload);
      done();
    }catch(e){setError(errorText(e))}finally{setBusy(false)}
  }
  return <Modal title={`${record?"Edit":"New"} ${config.singular}`} onClose={close} locked={busy}><form onSubmit={save}><div className="modal-body form-grid">{config.fields.map(f=>{
    const options=f.options || (f.source?(lookups[f.source]||[]).filter(r=>!f.filter||f.filter(r)).map(r=>({value:r.id,label:optionLabel(f.source!,r)})):[]);
    const val=value[f.key];
    return <div key={f.key} className={f.full?"school-field-full":""}><Field label={f.label} hint={f.hint}>{
      f.type==="checkbox"?<label className="school-check"><input type="checkbox" checked={!!value[f.key]} onChange={e=>change(f.key,e.target.checked)}/><span>{f.label}</span></label>:
      f.type==="select"&&f.source?<SearchableSelect value={String(val??"")} onChange={v=>change(f.key,v)} options={options} loading={!Object.prototype.hasOwnProperty.call(lookups,f.source)} placeholder={f.required?"Select…":"None / not set"} searchPlaceholder={`Search ${f.label.toLowerCase()}…`} ariaLabel={f.label}/>:
      f.type==="select"?<select value={val??""} required={f.required} onChange={e=>change(f.key,e.target.value)}><option value="">{f.required?"Select…":"None / not set"}</option>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>:
      f.type==="file"?<SchoolFileUpload purpose={`school-template-${config.key}`} valueName={record?.fileName||record?.originalName||undefined} required={f.required} onChange={file=>change(f.key,file?.id||"")}/>:
      f.type==="settings"?<SettingsEditor value={val||{}} onChange={v=>change(f.key,v)}/>:
      f.type==="textarea"?<textarea rows={4} value={val??""} placeholder={f.placeholder} required={f.required} onChange={e=>change(f.key,e.target.value)}/>:
      <input type={f.type||"text"} value={val??""} placeholder={f.placeholder} required={f.required} onChange={e=>change(f.key,e.target.value)}/>
    }</Field></div>
  })}{error&&<Notice tone="danger">{error}</Notice>}</div><div className="modal-actions"><Button type="button" variant="ghost" onClick={close}>Cancel</Button><Button disabled={busy}>{busy?"Saving…":record?"Save changes":"Create"}</Button></div></form></Modal>;
}

function SchoolSettings({onBack}:{onBack:()=>void;lookups:LookupMap}) {
  const {principal}=useAuth(),write=can(principal,"school:write"); const existing=useLoad<R[]>(`${schoolBase}/setup/settings/all`,[]); const [editing,setEditing]=useState<{group:string;key:string;label:string;value:any}|null>(null); const [message,setMessage]=useState("");
  const getValue=(group:string,key:string,def:any)=>existing.data.find(x=>x.group===group&&x.key===key)?.value??def;
  return <><BackLink onClick={onBack}/><SchoolPageHeader title="System preferences" text="Numbering, attendance, examinations, promotion, communications, report cards, imports and school-wide defaults."/>{message&&<Notice tone="success">{message}</Notice>}<div className="school-settings-grid">{settingSections.map(section=><Card key={section.group} className="school-settings-card"><div><h2>{section.title}</h2><p>{section.description}</p></div>{section.fields.map(([key,label,def])=><button key={key} onClick={()=>write&&setEditing({group:section.group,key,label,value:getValue(section.group,key,def)})}><span><b>{label}</b><small>{settingsSummary(getValue(section.group,key,def))}</small></span>{write&&<ChevronRight/>}</button>)}</Card>)}</div>{editing&&<SettingModal item={editing} close={()=>setEditing(null)} done={async()=>{setEditing(null);setMessage("School preference saved.");await existing.load()}}/>}</>;
}
function SettingModal({item,close,done}:{item:{group:string;key:string;label:string;value:any};close:()=>void;done:()=>void}){
  const[value,setValue]=useState<R>(()=>item.value&&typeof item.value==="object"&&!Array.isArray(item.value)?item.value:{}),[busy,setBusy]=useState(false),[error,setError]=useState("");
  async function save(e:FormEvent){e.preventDefault();setBusy(true);try{await put(`${schoolBase}/setup/settings/value`,{group:item.group,key:item.key,value});done()}catch(e){setError(errorText(e))}finally{setBusy(false)}}
  return <Modal title={item.label} onClose={close} locked={busy}><form onSubmit={save}><div className="modal-body"><Field label="Settings" hint="Use clear setting names and values. No technical formatting is required."><SettingsEditor value={value} onChange={setValue}/></Field>{error&&<Notice tone="danger">{error}</Notice>}</div><div className="modal-actions"><Button type="button" variant="ghost" onClick={close}>Cancel</Button><Button disabled={busy}>{busy?"Saving…":"Save setting"}</Button></div></form></Modal>
}

function SchoolPeopleWorkspace(){
  const [tab,setTab]=useState<"users"|"roles"|"security"|"history"|"mfa">("users");
  return <><SchoolPageHeader title="People & access" text="School users, multiple roles, scoped access, security policy, session controls and two-factor authentication."/><div className="school-subtabs"><button className={tab==="users"?"active":""} onClick={()=>setTab("users")}><Users/> Users</button><button className={tab==="roles"?"active":""} onClick={()=>setTab("roles")}><ShieldCheck/> Roles</button><button className={tab==="security"?"active":""} onClick={()=>setTab("security")}><LockKeyhole/> Security</button><button className={tab==="history"?"active":""} onClick={()=>setTab("history")}><Activity/> Login history</button><button className={tab==="mfa"?"active":""} onClick={()=>setTab("mfa")}><KeyRound/> My 2FA</button></div>{tab==="users"&&<SchoolUsers/>}{tab==="roles"&&<SchoolRoles/>}{tab==="security"&&<SchoolSecurity/>}{tab==="history"&&<SchoolLoginHistory/>}{tab==="mfa"&&<SchoolMfa/>}</>;
}

const schoolPermissions = ["school.communications:manage","school.communications:send","school.communications:read","attendance:read","attendance:write","attendance:manage","attendance:biometrics","attendance:devices","school.setup:read","school.setup:write","school.users:read","school.users:write","school.students:read","school.students:write","school.students:approve","school.students:export","school.finance:read","school.finance:write","school.discipline:read","school.discipline:write","school.discipline:manage"];

function SchoolRoles(){const{principal}=useAuth(),write=can(principal,"school:write"),roles=useLoad<R[]>(`${schoolBase}/iam/roles`,[]),[edit,setEdit]=useState<R|null|undefined>(undefined),[message,setMessage]=useState("");async function bootstrap(){try{await post(`${schoolBase}/iam/bootstrap`,{});setMessage("Built-in school roles initialized.");await roles.load()}catch(e){setMessage(errorText(e))}}return <Card className="school-panel"><div className="school-panel-head"><div><h2>School roles</h2><p>Built-in and custom roles with feature-level permissions.</p></div>{write&&<div className="row-actions"><Button variant="secondary" onClick={bootstrap}><RefreshCw/> Initialize defaults</Button><Button onClick={()=>setEdit(null)}><Plus/> Custom role</Button></div>}</div>{message&&<div className="ops-pad"><Notice tone={message.includes("initialized")?"success":"danger"}>{message}</Notice></div>}{roles.loading?<Spinner/>:roles.data.length?<div className="school-role-grid">{roles.data.map(r=><button key={r.id} className="school-role-card" onClick={()=>write&&setEdit(r)}><span><ShieldCheck/></span><div><b>{r.name}</b><small>{words(r.roleCategory)} · {r.systemRole?"Built-in":"Custom"}</small><p>{(r.permissions||[]).slice(0,4).map(words).join(" · ")}{(r.permissions||[]).length>4?` +${r.permissions.length-4} more`:""}</p></div><Status value={bool(r.active)?"active":"inactive"}/></button>)}</div>:<EmptyState title="No school roles" description="Initialize the professional built-in role set or create a custom role."/>}{edit!==undefined&&<RoleModal record={edit} close={()=>setEdit(undefined)} done={async()=>{setEdit(undefined);await roles.load()}}/>}</Card>}
function RoleModal({record,close,done}:{record:R|null;close:()=>void;done:()=>void}){
  const[v,setV]=useState<R>({code:record?.code||"",name:record?.name||"",description:record?.description||"",roleCategory:record?.roleCategory||"custom",active:record?bool(record.active):true,permissions:record?.permissions||[]});
  const[busy,setBusy]=useState(false),[error,setError]=useState(""),[remove,setRemove]=useState(false);
  const toggle=(p:string)=>setV(x=>({...x,permissions:x.permissions.includes(p)?x.permissions.filter((y:string)=>y!==p):[...x.permissions,p]}));
  async function save(e:FormEvent){e.preventDefault();setBusy(true);try{if(record){const payload=record.systemRole?{name:v.name,description:v.description||null,roleCategory:v.roleCategory,active:v.active,permissions:v.permissions}:v;await put(`${schoolBase}/iam/roles/${record.id}`,payload)}else await post(`${schoolBase}/iam/roles`,v);done()}catch(e){setError(errorText(e))}finally{setBusy(false)}}
  async function erase(){if(!record)return;setBusy(true);try{await del(`${schoolBase}/iam/roles/${record.id}`);done()}catch(e){setRemove(false);setError(errorText(e))}finally{setBusy(false)}}
  return <Modal title={record?`Edit ${record.name}`:"Create custom role"} onClose={close} locked={busy}><form onSubmit={save}><div className="modal-body form-grid"><Field label="Role code"><input value={v.code} disabled={!!record?.systemRole} onChange={e=>setV({...v,code:e.target.value})} required/></Field><Field label="Role name"><input value={v.name} onChange={e=>setV({...v,name:e.target.value})} required/></Field><Field label="Category"><input value={v.roleCategory} onChange={e=>setV({...v,roleCategory:e.target.value})}/></Field><Field label="Active"><label className="school-check"><input type="checkbox" checked={v.active} onChange={e=>setV({...v,active:e.target.checked})}/> Active role</label></Field><div className="school-field-full"><Field label="Description"><textarea value={v.description} onChange={e=>setV({...v,description:e.target.value})}/></Field></div><fieldset className="school-permissions school-field-full"><legend>Permissions</legend>{schoolPermissions.map(p=><label key={p}><input type="checkbox" checked={v.permissions.includes(p)} onChange={()=>toggle(p)}/><span><b>{words(p.split(":").slice(-2).join(" "))}</b><small>{p}</small></span></label>)}</fieldset>{error&&<Notice tone="danger">{error}</Notice>}</div><div className="modal-actions">{record&&!record.systemRole&&<Button type="button" variant="danger" onClick={()=>setRemove(true)}><Trash2/> Delete role</Button>}<span className="school-action-spacer"/><Button type="button" variant="ghost" onClick={close}>Cancel</Button><Button disabled={busy}>{busy?"Saving…":"Save role"}</Button></div></form>{remove&&<ConfirmModal title="Delete custom role?" text={`Delete “${record?.name}”? Users assigned to this role must be reassigned if database constraints prevent removal.`} danger close={()=>setRemove(false)} run={erase}/>}</Modal>
}

function SchoolUsers(){const{principal}=useAuth(),write=can(principal,"school:write"),users=useLoad<R[]>(`${schoolBase}/iam/users`,[]),roles=useLoad<R[]>(`${schoolBase}/iam/roles`,[]),[q,setQ]=useState(""),[edit,setEdit]=useState<R|null|undefined>(undefined),[detail,setDetail]=useState<R|null>(null),[message,setMessage]=useState("");const rows=users.data.filter(u=>`${u.displayName} ${u.email} ${u.username} ${u.phone} ${u.staffNumber}`.toLowerCase().includes(q.toLowerCase()));return <Card className="school-panel"><div className="school-panel-head"><div><h2>School users</h2><p>Administrators, teachers, finance staff, parents, students and other school users.</p></div>{write&&<Button onClick={()=>setEdit(null)}><UserPlus/> New user</Button>}</div>{message&&<div className="ops-pad"><Notice tone="success">{message}</Notice></div>}<div className="school-table-toolbar"><label><Search/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search name, email, username, phone or staff number…"/></label></div>{users.loading?<Spinner/>:rows.length?<div className="table-wrap school-table"><table><thead><tr><th>User</th><th>Login</th><th>School roles</th><th>Core access</th><th>Status</th><th/></tr></thead><tbody>{rows.map(u=><tr key={u.id}><td><b>{u.displayName}</b><small>{u.staffNumber||"No staff number"}</small></td><td>{u.email}<small>{[u.username,u.phone].filter(Boolean).join(" · ")}</small></td><td>{(u.roles||[]).map((r:R)=>r.name).join(", ")||"—"}</td><td>{words(u.coreRole)}<small>{(u.scopes||[]).join(", ")}</small></td><td><Status value={u.status||"active"}/></td><td><div className="row-actions"><button onClick={()=>setDetail(u)}>Manage</button>{write&&<button onClick={()=>setEdit(u)}>Edit</button>}</div></td></tr>)}</tbody></table></div>:<EmptyState title="No school users found" description="Create school staff, parent or student user accounts from here."/>}{edit!==undefined&&<UserModal record={edit} roles={roles.data} close={()=>setEdit(undefined)} done={async()=>{setEdit(undefined);setMessage("User saved.");await users.load()}}/>}{detail&&<UserAccessModal user={detail} roles={roles.data} write={write} close={()=>setDetail(null)} refresh={users.load}/>}</Card>}

function UserModal({record,roles,close,done}:{record:R|null;roles:R[];close:()=>void;done:()=>void}){const[v,setV]=useState<R>({email:record?.email||"",displayName:record?.displayName||"",password:"",username:record?.username||"",phone:record?.phone||"",profilePhotoFileId:record?.profilePhotoFileId||"",profilePhotoName:record?.profilePhotoFileName||record?.profilePhotoOriginalName||"",signatureFileId:record?.signatureFileId||"",signatureName:record?.signatureFileName||record?.signatureOriginalName||"",staffNumber:record?.staffNumber||"",status:record?.status||"active",forcePasswordChange:record?bool(record.forcePasswordChange):true,coreRole:record?.coreRole||"viewer",scopes:record?.scopes||["school:read"],roleIds:(record?.roles||[]).map((r:R)=>r.id),notificationPreferences:record?.notificationPreferences||{}}),[busy,setBusy]=useState(false),[error,setError]=useState("");const toggleRole=(id:string)=>setV(x=>({...x,roleIds:x.roleIds.includes(id)?x.roleIds.filter((y:string)=>y!==id):[...x.roleIds,id]}));async function save(e:FormEvent){e.preventDefault();setBusy(true);try{if(record)await put(`${schoolBase}/iam/users/${record.id}`,{displayName:v.displayName,username:v.username||null,phone:v.phone||null,profilePhotoUrl:null,profilePhotoFileId:v.profilePhotoFileId||null,signatureUrl:null,signatureFileId:v.signatureFileId||null,staffNumber:v.staffNumber||null,status:v.status,forcePasswordChange:v.forcePasswordChange,coreRole:v.coreRole,scopes:v.scopes,notificationPreferences:v.notificationPreferences});else await post(`${schoolBase}/iam/users`,{...v,password:v.password||undefined});if(record)await put(`${schoolBase}/iam/users/${record.id}/assignments`,{roleIds:v.roleIds,access:(record.access||[]).map((a:R)=>({type:a.accessType||a.type,resourceId:a.resourceId,level:a.accessLevel||a.level||"manage",startsAt:a.startsAt||null,endsAt:a.endsAt||null}))});done()}catch(e){setError(errorText(e))}finally{setBusy(false)}}return <Modal title={record?`Edit ${record.displayName}`:"Create school user"} onClose={close} locked={busy}><form onSubmit={save}><div className="modal-body form-grid"><Field label="Display name"><input value={v.displayName} onChange={e=>setV({...v,displayName:e.target.value})} required/></Field><Field label="Email"><input type="email" value={v.email} disabled={!!record} onChange={e=>setV({...v,email:e.target.value})} required/></Field>{!record&&<Field label="Initial password" hint="At least 12 characters"><input type="password" value={v.password} onChange={e=>setV({...v,password:e.target.value})} minLength={12}/></Field>}<Field label="Username"><input value={v.username} onChange={e=>setV({...v,username:e.target.value})}/></Field><Field label="Phone number"><input value={v.phone} onChange={e=>setV({...v,phone:e.target.value})}/></Field><Field label="Staff number"><input value={v.staffNumber} placeholder="Auto-generated when blank" onChange={e=>setV({...v,staffNumber:e.target.value})}/></Field><Field label="Account status"><select value={v.status} onChange={e=>setV({...v,status:e.target.value})}>{["active","inactive","suspended","locked"].map(x=><option value={x}>{words(x)}</option>)}</select></Field><Field label="Ledgerly core role"><select value={v.coreRole} onChange={e=>setV({...v,coreRole:e.target.value})}>{["admin","accountant","manager","viewer","integration"].map(x=><option key={x} value={x}>{words(x)}</option>)}</select></Field><Field label="School module access" hint="Role permissions still decide which school features this user can use."><select value={(v.scopes||[]).includes("school:write")?"manage":"read"} onChange={e=>setV({...v,scopes:e.target.value==="manage"?Array.from(new Set([...(v.scopes||[]),"school:read","school:write"])):(v.scopes||[]).filter((x:string)=>x!=="school:write").includes("school:read")?(v.scopes||[]).filter((x:string)=>x!=="school:write"):[...(v.scopes||[]).filter((x:string)=>x!=="school:write"),"school:read"]})}><option value="read">Read / portal access</option><option value="manage">Allow school changes</option></select></Field><div className="school-field-full"><Field label="Profile photo"><SchoolFileUpload purpose="school-user-profile-photo" accept="image/*" valueName={v.profilePhotoName||undefined} onChange={file=>setV({...v,profilePhotoFileId:file?.id||"",profilePhotoName:file?.originalName||""})}/></Field></div><div className="school-field-full"><Field label="Signature"><SchoolFileUpload purpose="school-user-signature" accept="image/*" valueName={v.signatureName||undefined} onChange={file=>setV({...v,signatureFileId:file?.id||"",signatureName:file?.originalName||""})}/></Field></div><Field label="Password policy"><label className="school-check"><input type="checkbox" checked={v.forcePasswordChange} onChange={e=>setV({...v,forcePasswordChange:e.target.checked})}/> Force password change</label></Field><fieldset className="school-permissions school-field-full"><legend>School roles</legend>{roles.map(r=><label key={r.id}><input type="checkbox" checked={v.roleIds.includes(r.id)} onChange={()=>toggleRole(r.id)}/><span><b>{r.name}</b><small>{words(r.roleCategory)}</small></span></label>)}</fieldset>{error&&<Notice tone="danger">{error}</Notice>}</div><div className="modal-actions"><Button type="button" variant="ghost" onClick={close}>Cancel</Button><Button disabled={busy}>{busy?"Saving…":"Save user"}</Button></div></form></Modal>}

function UserAccessModal({user,roles,write,close,refresh}:{user:R;roles:R[];write:boolean;close:()=>void;refresh:()=>void}){
  const sessions=useLoad<R[]>(`${schoolBase}/iam/users/${user.id}/sessions`,[]);
  const [roleIds,setRoleIds]=useState<string[]>((user.roles||[]).map((r:R)=>r.id));
  const [access,setAccess]=useState<Array<R>>((user.access||[]).map((a:R)=>({type:a.accessType||a.type,resourceId:a.resourceId,level:a.accessLevel||a.level||"manage",startsAt:a.startsAt||null,endsAt:a.endsAt||null})));
  const [temporary,setTemporary]=useState<R[]>((user.temporaryPermissions||[]).filter((x:R)=>!x.revokedAt));
  const [tempOpen,setTempOpen]=useState(false);
  const [temp,setTemp]=useState<R>({permission:"school.students:read",startsAt:new Date().toISOString().slice(0,16),endsAt:new Date(Date.now()+86400000).toISOString().slice(0,16),reason:""});
  const [refs,setRefs]=useState<R>({campus:[],department:[],class:[],stream:[],subject:[],student:[],parent:[]});
  const [message,setMessage]=useState(""),[reset,setReset]=useState(false);
  useEffect(()=>{void Promise.all([
    get<R[]>(`${schoolBase}/setup/branches?limit=500`).catch(()=>[]),get<R[]>(`${schoolBase}/setup/departments?limit=500`).catch(()=>[]),get<R[]>(`${schoolBase}/setup/classes?limit=500`).catch(()=>[]),get<R[]>(`${schoolBase}/setup/streams?limit=500`).catch(()=>[]),get<R[]>(`${schoolBase}/setup/subjects?limit=500`).catch(()=>[]),get<R[]>(`${schoolBase}/student-management/students?limit=500`).catch(()=>[]),get<R[]>(`${schoolBase}/student-management/guardians?limit=500`).catch(()=>[])
  ]).then(([campus,department,klass,stream,subject,student,parent])=>setRefs({campus,department,class:klass,stream,subject,student,parent}))},[]);
  const toggle=(id:string)=>setRoleIds(x=>x.includes(id)?x.filter(y=>y!==id):[...x,id]);
  const resourceOptions=(type:string)=>refs[type]||[];
  async function saveAssignments(){try{await put(`${schoolBase}/iam/users/${user.id}/assignments`,{roleIds,access});setMessage("Role and access assignments saved.");refresh()}catch(e){setMessage(errorText(e))}}
  async function grantTemporary(){try{const created=await post<R>(`${schoolBase}/iam/users/${user.id}/temporary-permissions`,{permission:temp.permission,startsAt:temp.startsAt,endsAt:temp.endsAt,reason:temp.reason||null});setTemporary([created,...temporary]);setTempOpen(false);setMessage("Temporary permission granted.")}catch(e){setMessage(errorText(e))}}
  async function revokeTemporary(id:string){try{await del(`${schoolBase}/iam/users/${user.id}/temporary-permissions/${id}`);setTemporary(temporary.filter(x=>x.id!==id));setMessage("Temporary permission revoked.")}catch(e){setMessage(errorText(e))}}
  return <Modal title={`Manage ${user.displayName}`} onClose={close}><div className="modal-body">
    <div className="summary-grid"><span><small>Email</small><b>{user.email}</b></span><span><small>Username</small><b>{user.username||"—"}</b></span><span><small>Staff number</small><b>{user.staffNumber||"—"}</b></span><span><small>Status</small><Status value={user.status||"active"}/></span></div>
    {write&&<>
      <div className="school-detail-section"><h3>Role assignments</h3><div className="school-role-pills">{roles.map(r=><label key={r.id} className={roleIds.includes(r.id)?"selected":""}><input type="checkbox" checked={roleIds.includes(r.id)} onChange={()=>toggle(r.id)}/>{r.name}</label>)}</div></div>
      <div className="school-detail-section"><div className="school-panel-head"><div><h3>Scoped access</h3><p>Restrict this user to specific campuses, departments, classes, streams, subjects or students.</p></div><Button variant="secondary" onClick={()=>setAccess([...access,{type:"campus",resourceId:"",level:"manage",startsAt:null,endsAt:null}])}><Plus/> Add restriction</Button></div>
        {access.map((a,i)=>{const options=resourceOptions(a.type);const resourceLabel=(r:R)=>a.type==="student"?`${fullName(r)} · ${r.admissionNumber||r.studentNumber||"Student"}`:a.type==="parent"?`${r.contactName||[r.firstName,r.middleName,r.lastName].filter(Boolean).join(" ")||"Guardian"}${r.phonePrimary?` · ${r.phonePrimary}`:""}`:r.name||r.code||"Unnamed record";return <div className="school-access-row" key={i}><select value={a.type} onChange={e=>setAccess(access.map((x,j)=>j===i?{...x,type:e.target.value,resourceId:""}:x))}>{["campus","department","class","stream","subject","student","parent"].map(x=><option key={x} value={x}>{words(x)}</option>)}</select><select value={a.resourceId} onChange={e=>setAccess(access.map((x,j)=>j===i?{...x,resourceId:e.target.value}:x))} disabled={!options.length}><option value="">{options.length?"Select resource…":"No matching records available"}</option>{options.map((r:R)=><option key={r.id} value={r.id}>{resourceLabel(r)}</option>)}</select><select value={a.level} onChange={e=>setAccess(access.map((x,j)=>j===i?{...x,level:e.target.value}:x))}>{["view","manage","approve","financial"].map(x=><option key={x} value={x}>{words(x)}</option>)}</select><button type="button" onClick={()=>setAccess(access.filter((_,j)=>j!==i))}><X/></button></div>})}
        <div className="row-actions"><Button onClick={saveAssignments}>Save assignments</Button><Button variant="secondary" onClick={()=>setReset(true)}>Reset password</Button></div>
      </div>
      <div className="school-detail-section"><div className="school-panel-head"><div><h3>Temporary permissions</h3><p>Time-limited access for cover duties, approvals or exceptional work.</p></div><Button variant="secondary" onClick={()=>setTempOpen(!tempOpen)}><Plus/> Grant temporary</Button></div>{tempOpen&&<div className="school-inline-editor"><div className="form-grid"><Field label="Permission"><select value={temp.permission} onChange={e=>setTemp({...temp,permission:e.target.value})}>{schoolPermissions.map(p=><option key={p} value={p}>{p}</option>)}</select></Field><Field label="Reason"><input value={temp.reason} onChange={e=>setTemp({...temp,reason:e.target.value})}/></Field><Field label="Starts at"><input type="datetime-local" value={temp.startsAt} onChange={e=>setTemp({...temp,startsAt:e.target.value})}/></Field><Field label="Ends at"><input type="datetime-local" value={temp.endsAt} onChange={e=>setTemp({...temp,endsAt:e.target.value})}/></Field></div><div className="row-actions"><Button onClick={grantTemporary}>Grant permission</Button><Button variant="ghost" onClick={()=>setTempOpen(false)}>Cancel</Button></div></div>}{temporary.length?<div className="school-session-list">{temporary.map(t=><div key={t.id}><span><b>{t.permission}</b><small>{t.startsAt} → {t.endsAt}{t.reason?` · ${t.reason}`:""}</small></span><Status value="active"/><button onClick={()=>void revokeTemporary(t.id)}>Revoke</button></div>)}</div>:<p className="school-muted">No active temporary permissions.</p>}</div>
    </>}
    {message&&<Notice tone={message.includes("saved")||message.includes("granted")||message.includes("revoked")?"success":"danger"}>{message}</Notice>}
    <div className="school-detail-section"><h3>Session history</h3>{sessions.loading?<Spinner/>:sessions.data.length?<div className="school-session-list">{sessions.data.map(s=><div key={s.id}><span><b>{s.userAgent||"Unknown device"}</b><small>{s.ipAddress||"No IP"} · {s.createdAt}</small></span><Status value={s.revokedAt?"revoked":"active"}/>{write&&!s.revokedAt&&<button onClick={async()=>{await del(`${schoolBase}/iam/users/${user.id}/sessions/${s.id}`);await sessions.load()}}>Revoke</button>}</div>)}</div>:<p className="school-muted">No recorded sessions.</p>}</div>
  </div>{reset&&<ResetPasswordModal user={user} close={()=>setReset(false)} done={()=>{setReset(false);setMessage("Temporary password set and active sessions revoked.")}}/>}</Modal>
}

function ResetPasswordModal({user,close,done}:{user:R;close:()=>void;done:()=>void}){const[pwd,setPwd]=useState(""),[force,setForce]=useState(true),[error,setError]=useState("");async function save(e:FormEvent){e.preventDefault();try{await post(`${schoolBase}/iam/users/${user.id}/reset-password`,{temporaryPassword:pwd,forceChange:force});done()}catch(e){setError(errorText(e))}}return <Modal title={`Reset password · ${user.displayName}`} onClose={close}><form onSubmit={save}><div className="modal-body"><Field label="Temporary password"><input type="password" minLength={12} value={pwd} onChange={e=>setPwd(e.target.value)} required/></Field><label className="school-check"><input type="checkbox" checked={force} onChange={e=>setForce(e.target.checked)}/> Force password change at next login</label>{error&&<Notice tone="danger">{error}</Notice>}</div><div className="modal-actions"><Button type="button" variant="ghost" onClick={close}>Cancel</Button><Button>Reset password</Button></div></form></Modal>}

function SchoolSecurity(){const{principal}=useAuth(),write=can(principal,"school:write"),x=useLoad<R|null>(`${schoolBase}/iam/security-policy`,null),[v,setV]=useState<R>({minimumPasswordLength:12,requireUppercase:true,requireLowercase:true,requireNumber:true,requireSymbol:false,passwordExpiryDays:null,passwordHistoryCount:5,maxFailedLogins:5,lockoutMinutes:15,sessionTimeoutMinutes:480,require2faForAdmins:false,allowImpersonation:false}),[message,setMessage]=useState("");useEffect(()=>{if(x.data)setV({...v,...x.data,requireUppercase:bool(x.data.requireUppercase),requireLowercase:bool(x.data.requireLowercase),requireNumber:bool(x.data.requireNumber),requireSymbol:bool(x.data.requireSymbol),require2faForAdmins:bool(x.data.require2faForAdmins),allowImpersonation:bool(x.data.allowImpersonation)})},[x.data]);async function save(e:FormEvent){e.preventDefault();try{await put(`${schoolBase}/iam/security-policy`,{...v,minimumPasswordLength:Number(v.minimumPasswordLength),passwordExpiryDays:v.passwordExpiryDays?Number(v.passwordExpiryDays):null,passwordHistoryCount:Number(v.passwordHistoryCount),maxFailedLogins:Number(v.maxFailedLogins),lockoutMinutes:Number(v.lockoutMinutes),sessionTimeoutMinutes:Number(v.sessionTimeoutMinutes)});setMessage("Security policy saved.")}catch(e){setMessage(errorText(e))}}if(x.loading)return <Card><Spinner/></Card>;return <Card className="school-form-card"><form onSubmit={save}><div className="school-panel-head"><div><h2>Security policy</h2><p>Password, lockout, session, MFA and administrative controls.</p></div></div><div className="form-grid"><Field label="Minimum password length"><input type="number" min={8} max={128} value={v.minimumPasswordLength} onChange={e=>setV({...v,minimumPasswordLength:e.target.value})} disabled={!write}/></Field><Field label="Password expiry (days)"><input type="number" min={1} value={v.passwordExpiryDays??""} onChange={e=>setV({...v,passwordExpiryDays:e.target.value})} disabled={!write}/></Field><Field label="Password history"><input type="number" min={0} max={50} value={v.passwordHistoryCount} onChange={e=>setV({...v,passwordHistoryCount:e.target.value})} disabled={!write}/></Field><Field label="Maximum failed logins"><input type="number" min={1} value={v.maxFailedLogins} onChange={e=>setV({...v,maxFailedLogins:e.target.value})} disabled={!write}/></Field><Field label="Lockout duration (minutes)"><input type="number" min={1} value={v.lockoutMinutes} onChange={e=>setV({...v,lockoutMinutes:e.target.value})} disabled={!write}/></Field><Field label="Session timeout (minutes)"><input type="number" min={5} value={v.sessionTimeoutMinutes} onChange={e=>setV({...v,sessionTimeoutMinutes:e.target.value})} disabled={!write}/></Field>{[["requireUppercase","Require uppercase letters"],["requireLowercase","Require lowercase letters"],["requireNumber","Require numbers"],["requireSymbol","Require symbols"],["require2faForAdmins","Require 2FA for administrators"],["allowImpersonation","Allow controlled impersonation"]].map(([k,label])=><Field key={k} label={label}><label className="school-check"><input type="checkbox" checked={!!v[k]} onChange={e=>setV({...v,[k]:e.target.checked})} disabled={!write}/>{label}</label></Field>)}</div>{message&&<Notice tone={message.includes("saved")?"success":"danger"}>{message}</Notice>}{write&&<div className="modal-actions"><Button>Save security policy</Button></div>}</form></Card>}
function SchoolLoginHistory(){const x=useLoad<R[]>(`${schoolBase}/iam/login-history`,[]);return <Card className="school-panel"><div className="school-panel-head"><div><h2>Login history</h2><p>Successful and failed school account access attempts.</p></div><Button variant="secondary" onClick={()=>void x.load()}><RefreshCw/> Refresh</Button></div>{x.loading?<Spinner/>:x.data.length?<div className="table-wrap school-table"><table><thead><tr><th>Time</th><th>User / identifier</th><th>Result</th><th>IP address</th><th>Device</th></tr></thead><tbody>{x.data.map((r,i)=><tr key={r.id||i}><td>{r.createdAt}</td><td>{r.identifier||r.userId||"—"}</td><td><Status value={r.success?"success":r.eventType||"failed"}/><small>{r.failureReason}</small></td><td>{r.ipAddress||"—"}</td><td>{r.userAgent||"—"}</td></tr>)}</tbody></table></div>:<EmptyState title="No login history" description="School login events will appear here."/>}</Card>}
function SchoolMfa(){const[setup,setSetup]=useState<R|null>(null),[code,setCode]=useState(""),[message,setMessage]=useState("");async function start(){try{setSetup(await post<R>(`${schoolBase}/iam/mfa/totp/setup`,{}));setMessage("")}catch(e){setMessage(errorText(e))}}async function verify(){try{await post(`${schoolBase}/iam/mfa/totp/verify`,{code});setMessage("Two-factor authentication enabled.");setSetup(null)}catch(e){setMessage(errorText(e))}}async function disable(){try{await del(`${schoolBase}/iam/mfa/totp`);setMessage("Two-factor authentication disabled for this account.")}catch(e){setMessage(errorText(e))}}return <Card className="school-panel"><div className="school-panel-head"><div><h2>My two-factor authentication</h2><p>Protect your own school account with a TOTP authenticator app and recovery codes.</p></div><Button onClick={start}><KeyRound/> Set up 2FA</Button></div>{setup&&<div className="school-mfa-box"><Notice tone="warning">Save the recovery codes now. They will not be shown again.</Notice><Field label="Authenticator secret"><input value={setup.secret||""} readOnly/></Field><Field label="Authenticator URI"><textarea value={setup.otpauthUri||""} readOnly/></Field><div className="school-recovery-codes">{(setup.recoveryCodes||[]).map((x:string)=><code key={x}>{x}</code>)}</div><div className="school-mfa-verify"><input placeholder="6-digit code" value={code} onChange={e=>setCode(e.target.value)} maxLength={6}/><Button onClick={verify}>Verify & enable</Button></div></div>}<div className="ops-pad"><Button variant="danger" onClick={disable}>Disable my 2FA</Button></div>{message&&<div className="ops-pad"><Notice tone={message.includes("enabled")||message.includes("disabled")?"success":"danger"}>{message}</Notice></div>}</Card>}

function AdmissionsWorkspace(){const{principal}=useAuth(),write=can(principal,"school:write"),[q,setQ]=useState(""),[status,setStatus]=useState(""),[create,setCreate]=useState(false),[selected,setSelected]=useState<R|null>(null),x=useLoad<R[]>(`${schoolBase}/student-management/admissions?limit=500${status?`&status=${status}`:""}${q?`&q=${encodeURIComponent(q)}`:""}`,[]);return <><SchoolPageHeader title="Admissions" text="Applications, screening, waiting lists, approval, rejection and enrollment." action={write?<Button onClick={()=>setCreate(true)}><Plus/> New application</Button>:undefined}/><Card className="school-panel"><div className="school-table-toolbar"><label><Search/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search application or applicant…"/></label><select value={status} onChange={e=>setStatus(e.target.value)}><option value="">All statuses</option>{["draft","submitted","screening","waitlisted","approved","rejected","enrolled","withdrawn"].map(s=><option value={s}>{words(s)}</option>)}</select></div>{x.loading?<Spinner/>:x.data.length?<div className="table-wrap school-table"><table><thead><tr><th>Application</th><th>Applicant</th><th>Desired level</th><th>Submitted</th><th>Status</th><th/></tr></thead><tbody>{x.data.map(a=><tr key={a.id}><td><b>{a.applicationNumber}</b></td><td>{[a.applicant?.firstName,a.applicant?.lastName].filter(Boolean).join(" ")}<small>{a.guardian?.phonePrimary||a.guardian?.email}</small></td><td>{a.desiredClassLevelId||"—"}</td><td>{a.submittedAt||a.createdAt}</td><td><Status value={a.status}/></td><td><button onClick={()=>setSelected(a)}>Review</button></td></tr>)}</tbody></table></div>:<EmptyState title="No admission applications" description="Online or manual applications will appear here." action={write?<Button onClick={()=>setCreate(true)}>Create application</Button>:undefined}/>}</Card>{create&&<AdmissionCreateModal close={()=>setCreate(false)} done={async()=>{setCreate(false);await x.load()}}/>}{selected&&<AdmissionReviewModal admission={selected} write={write} close={()=>setSelected(null)} done={async()=>{setSelected(null);await x.load()}}/>}</>}

function loadSetupRefs(){return Promise.all([get<R[]>(`${schoolBase}/setup/branches?limit=500`).catch(()=>[]),get<R[]>(`${schoolBase}/setup/academicYears?limit=500`).catch(()=>[]),get<R[]>(`${schoolBase}/setup/classLevels?limit=500`).catch(()=>[]),get<R[]>(`${schoolBase}/setup/classes?limit=500`).catch(()=>[]),get<R[]>(`${schoolBase}/setup/streams?limit=500`).catch(()=>[])]).then(([branches,years,levels,classes,streams])=>({branches,years,levels,classes,streams}))}
function AdmissionCreateModal({close,done}:{close:()=>void;done:()=>void}){const[refs,setRefs]=useState<any>({branches:[],years:[],levels:[]}),[v,setV]=useState<R>({campusId:"",academicYearId:"",desiredClassLevelId:"",status:"submitted",firstName:"",middleName:"",lastName:"",preferredName:"",gender:"",dateOfBirth:"",nationality:"Ugandan",placeOfBirth:"",religion:"",homeLanguage:"",previousSchool:"",previousClass:"",residencyStatus:"day",guardianFirstName:"",guardianMiddleName:"",guardianLastName:"",guardianPhone:"",guardianEmail:"",relationship:"parent",occupation:"",physicalAddress:""}),[error,setError]=useState(""),[busy,setBusy]=useState(false);useEffect(()=>{void loadSetupRefs().then(setRefs)},[]);const c=(k:string,val:any)=>setV(x=>({...x,[k]:val}));async function save(e:FormEvent){e.preventDefault();setBusy(true);try{await post(`${schoolBase}/student-management/admissions`,{campusId:v.campusId||null,academicYearId:v.academicYearId||null,desiredClassLevelId:v.desiredClassLevelId||null,status:v.status,applicant:{firstName:v.firstName,middleName:v.middleName||null,lastName:v.lastName,preferredName:v.preferredName||null,gender:v.gender||null,dateOfBirth:v.dateOfBirth||null,nationality:v.nationality||null,placeOfBirth:v.placeOfBirth||null,religion:v.religion||null,homeLanguage:v.homeLanguage||null,previousSchool:v.previousSchool||null,previousClass:v.previousClass||null,residencyStatus:v.residencyStatus},guardian:v.guardianFirstName&&v.guardianLastName?{firstName:v.guardianFirstName,middleName:v.guardianMiddleName||null,lastName:v.guardianLastName,phonePrimary:v.guardianPhone||null,phoneSecondary:null,email:v.guardianEmail||null,relationship:v.relationship||"guardian",occupation:v.occupation||null,physicalAddress:v.physicalAddress||null}:undefined,screening:{}});done()}catch(e){setError(errorText(e))}finally{setBusy(false)}}return <Modal title="New admission application" onClose={close} locked={busy}><form onSubmit={save}><div className="modal-body"><div className="school-form-section"><h3>Application</h3><div className="form-grid"><Field label="Campus"><select value={v.campusId} onChange={e=>c("campusId",e.target.value)}><option value="">Main / not specified</option>{refs.branches.map((r:R)=><option value={r.id}>{r.name}</option>)}</select></Field><Field label="Academic year"><select value={v.academicYearId} onChange={e=>c("academicYearId",e.target.value)}><option value="">Not selected</option>{refs.years.map((r:R)=><option value={r.id}>{r.name}</option>)}</select></Field><Field label="Desired class level"><select value={v.desiredClassLevelId} onChange={e=>c("desiredClassLevelId",e.target.value)}><option value="">Not selected</option>{refs.levels.map((r:R)=><option value={r.id}>{r.name}</option>)}</select></Field><Field label="Application status"><select value={v.status} onChange={e=>c("status",e.target.value)}>{["draft","submitted","screening","waitlisted"].map(x=><option value={x}>{words(x)}</option>)}</select></Field></div></div><div className="school-form-section"><h3>Applicant</h3><div className="form-grid"><Field label="First name"><input value={v.firstName} onChange={e=>c("firstName",e.target.value)} required/></Field><Field label="Middle name"><input value={v.middleName} onChange={e=>c("middleName",e.target.value)}/></Field><Field label="Last name"><input value={v.lastName} onChange={e=>c("lastName",e.target.value)} required/></Field><Field label="Preferred name"><input value={v.preferredName} onChange={e=>c("preferredName",e.target.value)}/></Field><Field label="Gender"><select value={v.gender} onChange={e=>c("gender",e.target.value)}><option value="">Not specified</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></select></Field><Field label="Date of birth"><input type="date" value={v.dateOfBirth} onChange={e=>c("dateOfBirth",e.target.value)}/></Field><Field label="Nationality"><input value={v.nationality} onChange={e=>c("nationality",e.target.value)}/></Field><Field label="Place of birth"><input value={v.placeOfBirth} onChange={e=>c("placeOfBirth",e.target.value)}/></Field><Field label="Religion"><input value={v.religion} onChange={e=>c("religion",e.target.value)}/></Field><Field label="Home language"><input value={v.homeLanguage} onChange={e=>c("homeLanguage",e.target.value)}/></Field><Field label="Previous school"><input value={v.previousSchool} onChange={e=>c("previousSchool",e.target.value)}/></Field><Field label="Previous class"><input value={v.previousClass} onChange={e=>c("previousClass",e.target.value)}/></Field><Field label="Day / boarding"><select value={v.residencyStatus} onChange={e=>c("residencyStatus",e.target.value)}><option value="day">Day</option><option value="boarding">Boarding</option><option value="hybrid">Hybrid</option></select></Field></div></div><div className="school-form-section"><h3>Parent / guardian</h3><div className="form-grid"><Field label="First name"><input value={v.guardianFirstName} onChange={e=>c("guardianFirstName",e.target.value)}/></Field><Field label="Middle name"><input value={v.guardianMiddleName} onChange={e=>c("guardianMiddleName",e.target.value)}/></Field><Field label="Last name"><input value={v.guardianLastName} onChange={e=>c("guardianLastName",e.target.value)}/></Field><Field label="Relationship"><select value={v.relationship} onChange={e=>c("relationship",e.target.value)}><option value="parent">Parent</option><option value="mother">Mother</option><option value="father">Father</option><option value="guardian">Guardian</option><option value="grandparent">Grandparent</option><option value="sponsor">Sponsor</option><option value="other">Other</option></select></Field><Field label="Phone"><input value={v.guardianPhone} onChange={e=>c("guardianPhone",e.target.value)}/></Field><Field label="Email"><input type="email" value={v.guardianEmail} onChange={e=>c("guardianEmail",e.target.value)}/></Field><Field label="Occupation"><input value={v.occupation} onChange={e=>c("occupation",e.target.value)}/></Field><Field label="Address"><input value={v.physicalAddress} onChange={e=>c("physicalAddress",e.target.value)}/></Field></div></div>{error&&<Notice tone="danger">{error}</Notice>}</div><div className="modal-actions"><Button type="button" variant="ghost" onClick={close}>Cancel</Button><Button disabled={busy}>{busy?"Saving…":"Create application"}</Button></div></form></Modal>}

function AdmissionReviewModal({admission,write,close,done}:{admission:R;write:boolean;close:()=>void;done:()=>void}){
  const[action,setAction]=useState<"decision"|"enroll"|null>(null),[decision,setDecision]=useState("screening"),[notes,setNotes]=useState("");
  const[refs,setRefs]=useState<any>({branches:[],years:[],levels:[],classes:[],streams:[]});
  const[enroll,setEnroll]=useState<R>({admissionDate:today(),classLevelId:admission.desiredClassLevelId||"",classId:"",streamId:"",campusId:admission.campusId||"",academicYearId:admission.academicYearId||""});
  const[error,setError]=useState("");
  useEffect(()=>{void loadSetupRefs().then(setRefs)},[]);
  const classes=refs.classes.filter((r:R)=>
    (!enroll.classLevelId||r.classLevelId===enroll.classLevelId)&&
    (!enroll.academicYearId||!r.academicYearId||r.academicYearId===enroll.academicYearId)&&
    (!enroll.campusId||!r.campusId||r.campusId===enroll.campusId)&&
    r.active!==false&&r.active!==0
  );
  const streams=refs.streams.filter((r:R)=>!!enroll.classId&&r.classId===enroll.classId&&r.active!==false&&r.active!==0);
  async function applyDecision(){try{await post(`${schoolBase}/student-management/admissions/${admission.id}/decision`,{decision,notes:notes||null,screening:admission.screening||{}});done()}catch(e){setError(errorText(e))}}
  async function performEnroll(){try{await post(`${schoolBase}/student-management/admissions/${admission.id}/enroll`,{admissionDate:enroll.admissionDate,classId:enroll.classId,streamId:enroll.streamId||null,campusId:enroll.campusId||null,academicYearId:enroll.academicYearId});done()}catch(e){setError(errorText(e))}}
  return <Modal title={`Application ${admission.applicationNumber}`} onClose={close}><div className="modal-body">
    <div className="summary-grid"><span><small>Applicant</small><b>{[admission.applicant?.firstName,admission.applicant?.lastName].filter(Boolean).join(" ")}</b></span><span><small>Status</small><Status value={admission.status}/></span><span><small>Residence</small><b>{words(admission.applicant?.residencyStatus)}</b></span><span><small>Previous school</small><b>{admission.applicant?.previousSchool||"—"}</b></span></div>
    <div className="school-detail-section"><h3>Applicant information</h3><div className="school-kv">{Object.entries(admission.applicant||{}).map(([k,v])=><span key={k}><small>{prettyKey(k)}</small><b>{displayValue(v)}</b></span>)}</div></div>
    <div className="school-detail-section"><h3>Guardian</h3><div className="school-kv">{Object.entries(admission.guardian||{}).map(([k,v])=><span key={k}><small>{prettyKey(k)}</small><b>{displayValue(v)}</b></span>)}</div></div>
    {write&&<div className="detail-actions">{admission.status==="approved"?<Button onClick={()=>setAction("enroll")}><GraduationCap/> Enroll student</Button>:!(["rejected","enrolled","withdrawn"].includes(admission.status))&&<Button onClick={()=>setAction("decision")}>Record decision</Button>}</div>}
    {error&&<Notice tone="danger">{error}</Notice>}
    {action==="decision"&&<div className="school-inline-editor"><h3>Admission decision</h3><div className="form-grid"><Field label="Decision"><select value={decision} onChange={e=>setDecision(e.target.value)}>{["screening","waitlisted","approved","rejected","withdrawn"].map(x=><option key={x} value={x}>{words(x)}</option>)}</select></Field><Field label="Notes"><textarea value={notes} onChange={e=>setNotes(e.target.value)}/></Field></div><div className="row-actions"><Button onClick={applyDecision}>Save decision</Button><Button variant="ghost" onClick={()=>setAction(null)}>Cancel</Button></div></div>}
    {action==="enroll"&&<div className="school-inline-editor"><h3>Enroll approved applicant</h3><Notice tone="info">Admission and student numbers will be generated automatically using School Setup numbering rules.</Notice><div className="form-grid">
      <Field label="Admission date"><input type="date" value={enroll.admissionDate} onChange={e=>setEnroll({...enroll,admissionDate:e.target.value})}/></Field>
      <Field label="Academic year"><select value={enroll.academicYearId} onChange={e=>setEnroll({...enroll,academicYearId:e.target.value,classId:"",streamId:""})} required><option value="">Select academic year…</option>{refs.years.filter((r:R)=>r.active!==false&&r.active!==0).map((r:R)=><option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
      <Field label="Campus"><select value={enroll.campusId} onChange={e=>setEnroll({...enroll,campusId:e.target.value,classId:"",streamId:""})}><option value="">Default campus</option>{refs.branches.filter((r:R)=>r.active!==false&&r.active!==0).map((r:R)=><option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
      <Field label="Class level"><select value={enroll.classLevelId} onChange={e=>setEnroll({...enroll,classLevelId:e.target.value,classId:"",streamId:""})} required><option value="">Select class level…</option>{refs.levels.filter((r:R)=>r.active!==false&&r.active!==0).map((r:R)=><option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
      <Field label="Class" hint="Filtered by class level, academic year and campus."><select value={enroll.classId} onChange={e=>setEnroll({...enroll,classId:e.target.value,streamId:""})} disabled={!enroll.classLevelId} required><option value="">{enroll.classLevelId?(classes.length?"Select class…":"No matching classes configured"):"Select class level first"}</option>{classes.map((r:R)=><option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
      <Field label="Stream / section"><select value={enroll.streamId} onChange={e=>setEnroll({...enroll,streamId:e.target.value})} disabled={!enroll.classId}><option value="">{enroll.classId?(streams.length?"No specific stream":"No streams configured"):"Select class first"}</option>{streams.map((r:R)=><option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
    </div><div className="row-actions"><Button onClick={performEnroll} disabled={!enroll.academicYearId||!enroll.classId}>Enroll student</Button><Button variant="ghost" onClick={()=>setAction(null)}>Cancel</Button></div></div>}
  </div></Modal>
}

function StudentsWorkspace(){
  const {principal}=useAuth();
  const write=can(principal,"school:write");
  const [q,setQ]=useState("");
  const [status,setStatus]=useState("active");
  const [classId,setClassId]=useState("");
  const [streamId,setStreamId]=useState("");
  const [campusId,setCampusId]=useState("");
  const [academicYearId,setAcademicYearId]=useState("");
  const [refs,setRefs]=useState<any>({branches:[],years:[],classes:[],streams:[]});
  const [create,setCreate]=useState(false),[detail,setDetail]=useState<string|null>(null),[report,setReport]=useState(false),[bulk,setBulk]=useState(false);
  useEffect(()=>{void loadSetupRefs().then(r=>setRefs({branches:r.branches,years:r.years,classes:r.classes,streams:r.streams}))},[principal?.organizationId]);
  const query=`${schoolBase}/student-management/students?limit=500${status?`&status=${status}`:""}${classId?`&classId=${classId}`:""}${streamId?`&streamId=${streamId}`:""}${campusId?`&campusId=${campusId}`:""}${academicYearId?`&academicYearId=${academicYearId}`:""}${q?`&q=${encodeURIComponent(q)}`:""}`;
  const x=useLoad<R[]>(query,[]);
  const visibleStreams=classId?refs.streams.filter((r:R)=>r.classId===classId):refs.streams;
  const clearFilters=()=>{setStatus("");setClassId("");setStreamId("");setCampusId("");setAcademicYearId("");setQ("")};
  return <>
    <SchoolPageHeader title="Students" text="Student profiles, guardians, enrollment history, medical/support records, status, transfers, promotion and timeline." action={<>{write&&<Button variant="secondary" onClick={()=>setBulk(true)}>Bulk import</Button>}<Button variant="secondary" onClick={()=>setReport(true)}>Reports</Button>{write&&<Button onClick={()=>setCreate(true)}><UserPlus/> Add student</Button>}</>}/>
    <Card className="school-panel">
      <div className="school-table-toolbar school-filter-wrap">
        <label><Search/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search student name, admission or student number…"/></label>
        <select aria-label="Student status" value={status} onChange={e=>setStatus(e.target.value)}><option value="">All statuses</option>{["active","inactive","graduated","transferred","withdrawn","suspended","deceased","alumni"].map(s=><option key={s} value={s}>{words(s)}</option>)}</select>
        <select aria-label="Academic year" value={academicYearId} onChange={e=>setAcademicYearId(e.target.value)}><option value="">All academic years</option>{refs.years.map((r:R)=><option key={r.id} value={r.id}>{r.name}</option>)}</select>
        <select aria-label="Class" value={classId} onChange={e=>{setClassId(e.target.value);setStreamId("")}}><option value="">All classes</option>{refs.classes.map((r:R)=><option key={r.id} value={r.id}>{r.name}</option>)}</select>
        <select aria-label="Stream" value={streamId} onChange={e=>setStreamId(e.target.value)}><option value="">All streams</option>{visibleStreams.map((r:R)=><option key={r.id} value={r.id}>{r.name}</option>)}</select>
        <select aria-label="Campus" value={campusId} onChange={e=>setCampusId(e.target.value)}><option value="">All campuses</option>{refs.branches.map((r:R)=><option key={r.id} value={r.id}>{r.name}</option>)}</select>
        {(q||status||classId||streamId||campusId||academicYearId)&&<Button type="button" variant="ghost" onClick={clearFilters}>Clear</Button>}
      </div>
      {x.loading?<Spinner/>:x.error?<Notice tone="danger">{x.error}</Notice>:x.data.length?<div className="table-wrap school-table"><table><thead><tr><th>Student</th><th>Admission / student #</th><th>Class</th><th>Stream</th><th>Campus</th><th>Status</th><th/></tr></thead><tbody>{x.data.map(s=><tr key={s.id}><td><b>{fullName(s)}</b><small>{[s.gender,s.residencyStatus].filter(Boolean).map(words).join(" · ")}</small></td><td>{s.admissionNumber}<small>{s.studentNumber}</small></td><td>{s.className||"—"}<small>{s.academicYearName}</small></td><td>{s.streamName||"—"}</td><td>{s.campusName||"—"}</td><td><Status value={s.status}/></td><td><button onClick={()=>setDetail(s.id)}>Open profile</button></td></tr>)}</tbody></table></div>:<EmptyState title="No students found" description="Adjust filters or add a student record." action={write?<Button onClick={()=>setCreate(true)}>Add student</Button>:undefined}/>} 
    </Card>
    {create&&<StudentCreateModal close={()=>setCreate(false)} done={async()=>{setCreate(false);await x.load()}}/>}
    {detail&&<StudentDetailModal studentId={detail} write={write} close={()=>setDetail(null)} changed={x.load}/>} 
    {report&&<StudentReports close={()=>setReport(false)}/>} 
    {bulk&&<StudentBulkImport close={()=>setBulk(false)} done={async()=>{setBulk(false);await x.load()}}/>}
  </>
}

function StudentCreateModal({close,done}:{close:()=>void;done:()=>void}){
  const[refs,setRefs]=useState<any>({branches:[],years:[],levels:[],classes:[],streams:[]});
  const[v,setV]=useState<R>({campusId:"",firstName:"",middleName:"",lastName:"",preferredName:"",gender:"",dateOfBirth:"",nationality:"Ugandan",placeOfBirth:"",religion:"",homeLanguage:"",phone:"",email:"",physicalAddress:"",previousSchool:"",previousClass:"",admissionDate:today(),admissionClassLevelId:"",currentAcademicYearId:"",currentClassId:"",currentStreamId:"",studentCategory:"regular",residencyStatus:"day",house:"",status:"active",profilePhotoFileId:"",profilePhotoName:"",guardianFirstName:"",guardianLastName:"",guardianPhone:"",guardianEmail:"",guardianRelationship:"parent",createPortalAccount:false,portalPassword:""});
  const[error,setError]=useState(""),[busy,setBusy]=useState(false);

  useEffect(()=>{void loadSetupRefs().then(r=>{
    setRefs(r);
    setV(x=>({
      ...x,
      campusId:x.campusId||r.branches.find((b:R)=>bool(b.isMain)||bool(b.isDefault))?.id||"",
      currentAcademicYearId:x.currentAcademicYearId||r.years.find((y:R)=>bool(y.isCurrent))?.id||"",
    }));
  })},[]);

  const classOptions=useMemo(()=>refs.classes.filter((r:R)=>
    (!v.admissionClassLevelId||r.classLevelId===v.admissionClassLevelId)&&
    (!v.currentAcademicYearId||!r.academicYearId||r.academicYearId===v.currentAcademicYearId)&&
    (!v.campusId||!r.campusId||r.campusId===v.campusId)&&
    r.active!==false&&r.active!==0
  ),[refs.classes,v.admissionClassLevelId,v.currentAcademicYearId,v.campusId]);
  const streamOptions=useMemo(()=>refs.streams.filter((r:R)=>r.active!==false&&r.active!==0&&!!v.currentClassId&&r.classId===v.currentClassId),[refs.streams,v.currentClassId]);

  const c=(k:string,val:any)=>setV(x=>({...x,[k]:val}));
  const selectLevel=(id:string)=>setV(x=>({...x,admissionClassLevelId:id,currentClassId:"",currentStreamId:""}));
  const selectYear=(id:string)=>setV(x=>({...x,currentAcademicYearId:id,currentClassId:"",currentStreamId:""}));
  const selectCampus=(id:string)=>setV(x=>({...x,campusId:id,currentClassId:"",currentStreamId:""}));
  const selectClass=(id:string)=>{
    const selected=refs.classes.find((r:R)=>r.id===id);
    setV(x=>({...x,currentClassId:id,currentStreamId:"",admissionClassLevelId:selected?.classLevelId||x.admissionClassLevelId}));
  };

  async function save(e:FormEvent){
    e.preventDefault();setBusy(true);setError("");
    try{
      await post(`${schoolBase}/student-management/students`,{
        campusId:v.campusId||null,firstName:v.firstName,middleName:v.middleName||null,lastName:v.lastName,preferredName:v.preferredName||null,
        gender:v.gender||null,dateOfBirth:v.dateOfBirth||null,nationality:v.nationality||null,placeOfBirth:v.placeOfBirth||null,religion:v.religion||null,
        homeLanguage:v.homeLanguage||null,phone:v.phone||null,email:v.email||null,physicalAddress:v.physicalAddress||null,previousSchool:v.previousSchool||null,
        previousClass:v.previousClass||null,admissionDate:v.admissionDate,admissionClassLevelId:v.admissionClassLevelId||null,currentAcademicYearId:v.currentAcademicYearId||null,
        currentClassId:v.currentClassId||null,currentStreamId:v.currentStreamId||null,studentCategory:v.studentCategory||null,residencyStatus:v.residencyStatus,house:v.house||null,
        status:v.status,profilePhotoUrl:null,profilePhotoFileId:v.profilePhotoFileId||null,customFields:{},
        guardian:v.guardianFirstName&&v.guardianLastName?{firstName:v.guardianFirstName,lastName:v.guardianLastName,middleName:null,phonePrimary:v.guardianPhone||null,phoneSecondary:null,email:v.guardianEmail||null,relationship:v.guardianRelationship||"guardian",occupation:null,physicalAddress:null}:undefined,
        createPortalAccount:!!v.createPortalAccount,portalPassword:v.createPortalAccount?v.portalPassword||undefined:undefined
      });
      done();
    }catch(e){setError(errorText(e))}finally{setBusy(false)}
  }

  return <Modal title="Add student" onClose={close} locked={busy}><form onSubmit={save}><div className="modal-body">
    <div className="school-form-section"><h3>Student identity</h3><div className="form-grid">
      <Field label="First name"><input value={v.firstName} onChange={e=>c("firstName",e.target.value)} required/></Field>
      <Field label="Middle name"><input value={v.middleName} onChange={e=>c("middleName",e.target.value)}/></Field>
      <Field label="Last name"><input value={v.lastName} onChange={e=>c("lastName",e.target.value)} required/></Field>
      <Field label="Preferred name"><input value={v.preferredName} onChange={e=>c("preferredName",e.target.value)}/></Field>
      <Field label="Gender"><select value={v.gender} onChange={e=>c("gender",e.target.value)}><option value="">Not specified</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></select></Field>
      <Field label="Date of birth"><input type="date" value={v.dateOfBirth} onChange={e=>c("dateOfBirth",e.target.value)}/></Field>
      <Field label="Nationality"><input value={v.nationality} onChange={e=>c("nationality",e.target.value)}/></Field>
      <Field label="Place of birth"><input value={v.placeOfBirth} onChange={e=>c("placeOfBirth",e.target.value)}/></Field>
      <Field label="Religion"><input value={v.religion} onChange={e=>c("religion",e.target.value)}/></Field>
      <Field label="Home language"><input value={v.homeLanguage} onChange={e=>c("homeLanguage",e.target.value)}/></Field>
      <Field label="Phone"><input value={v.phone} onChange={e=>c("phone",e.target.value)}/></Field>
      <Field label="Email"><input type="email" value={v.email} onChange={e=>c("email",e.target.value)}/></Field>
      <div className="school-field-full"><Field label="Physical address"><textarea value={v.physicalAddress} onChange={e=>c("physicalAddress",e.target.value)}/></Field></div>
      <div className="school-field-full"><Field label="Profile photo"><SchoolFileUpload purpose="student-profile-photo" accept="image/*" valueName={v.profilePhotoName||undefined} onChange={file=>setV({...v,profilePhotoFileId:file?.id||"",profilePhotoName:file?.originalName||""})}/></Field></div>
    </div></div>

    <div className="school-form-section"><h3>Enrollment</h3><Notice tone="info">Admission and student numbers are generated automatically from School Setup numbering rules.</Notice><div className="form-grid">
      <Field label="Admission date"><input type="date" value={v.admissionDate} onChange={e=>c("admissionDate",e.target.value)} required/></Field>
      <Field label="Academic year"><select value={v.currentAcademicYearId} onChange={e=>selectYear(e.target.value)}><option value="">Select academic year…</option>{refs.years.filter((r:R)=>r.active!==false&&r.active!==0).map((r:R)=><option key={r.id} value={r.id}>{r.name}{bool(r.isCurrent)?" · Current":""}</option>)}</select></Field>
      <Field label="Campus"><select value={v.campusId} onChange={e=>selectCampus(e.target.value)}><option value="">Default campus</option>{refs.branches.filter((r:R)=>r.active!==false&&r.active!==0).map((r:R)=><option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
      <Field label="Class level" hint="Choose the level first; only matching classes will be shown."><select value={v.admissionClassLevelId} onChange={e=>selectLevel(e.target.value)} required><option value="">Select class level…</option>{refs.levels.filter((r:R)=>r.active!==false&&r.active!==0).map((r:R)=><option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
      <Field label="Class" hint={v.admissionClassLevelId?"Filtered by class level, year and campus.":"Select a class level first."}><select value={v.currentClassId} onChange={e=>selectClass(e.target.value)} disabled={!v.admissionClassLevelId} required><option value="">{v.admissionClassLevelId?(classOptions.length?"Select class…":"No matching classes configured"):"Select class level first"}</option>{classOptions.map((r:R)=><option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
      <Field label="Stream / section" hint={v.currentClassId?"Only streams for the selected class are shown.":"Select a class first."}><select value={v.currentStreamId} onChange={e=>c("currentStreamId",e.target.value)} disabled={!v.currentClassId}><option value="">{v.currentClassId?(streamOptions.length?"No specific stream":"No streams configured"):"Select class first"}</option>{streamOptions.map((r:R)=><option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
      <Field label="Student category"><select value={v.studentCategory} onChange={e=>c("studentCategory",e.target.value)}><option value="regular">Regular</option><option value="scholarship">Scholarship</option><option value="sponsored">Sponsored</option><option value="staff_child">Staff child</option><option value="special_needs">Special support</option><option value="other">Other</option></select></Field>
      <Field label="Day / boarding"><select value={v.residencyStatus} onChange={e=>c("residencyStatus",e.target.value)}><option value="day">Day</option><option value="boarding">Boarding</option><option value="hybrid">Hybrid</option></select></Field>
      <Field label="House"><input value={v.house} onChange={e=>c("house",e.target.value)}/></Field>
      <Field label="Status"><select value={v.status} onChange={e=>c("status",e.target.value)}><option value="active">Active</option><option value="inactive">Inactive</option><option value="suspended">Suspended</option></select></Field>
      <Field label="Previous school"><input value={v.previousSchool} onChange={e=>c("previousSchool",e.target.value)}/></Field>
      <Field label="Previous class"><input value={v.previousClass} onChange={e=>c("previousClass",e.target.value)}/></Field>
    </div></div>

    <div className="school-form-section"><h3>Primary guardian</h3><div className="form-grid">
      <Field label="First name"><input value={v.guardianFirstName} onChange={e=>c("guardianFirstName",e.target.value)}/></Field>
      <Field label="Last name"><input value={v.guardianLastName} onChange={e=>c("guardianLastName",e.target.value)}/></Field>
      <Field label="Relationship"><select value={v.guardianRelationship} onChange={e=>c("guardianRelationship",e.target.value)}><option value="parent">Parent</option><option value="mother">Mother</option><option value="father">Father</option><option value="guardian">Guardian</option><option value="sibling">Sibling</option><option value="relative">Relative</option><option value="sponsor">Sponsor</option><option value="other">Other</option></select></Field>
      <Field label="Phone"><input value={v.guardianPhone} onChange={e=>c("guardianPhone",e.target.value)}/></Field>
      <Field label="Email"><input type="email" value={v.guardianEmail} onChange={e=>c("guardianEmail",e.target.value)}/></Field>
      <Field label="Portal"><label className="school-check"><input type="checkbox" checked={v.createPortalAccount} onChange={e=>c("createPortalAccount",e.target.checked)}/> Prepare student portal access</label></Field>
      {v.createPortalAccount&&<Field label="Temporary portal password" hint="At least 12 characters; student will be forced to change it."><input type="password" minLength={12} value={v.portalPassword||""} onChange={e=>c("portalPassword",e.target.value)} required/></Field>}
    </div></div>
    {error&&<Notice tone="danger">{error}</Notice>}
  </div><div className="modal-actions"><Button type="button" variant="ghost" onClick={close}>Cancel</Button><Button disabled={busy}>{busy?"Saving…":"Create student"}</Button></div></form></Modal>
}

function StudentDetailModal({studentId,write,close,changed}:{studentId:string;write:boolean;close:()=>void;changed:()=>void}){const x=useLoad<R|null>(`${schoolBase}/student-management/students/${studentId}`,null),[action,setAction]=useState<string|null>(null);if(x.loading)return <Modal title="Student profile" onClose={close}><Spinner/></Modal>;if(!x.data)return <Modal title="Student profile" onClose={close}><Notice tone="danger">{x.error||"Student could not be loaded"}</Notice></Modal>;const s=x.data;return <Modal title={fullName(s)} onClose={close}><div className="modal-body school-student-detail"><div className="school-student-hero"><span className="school-student-avatar">{String(s.firstName||"S").slice(0,1)}{String(s.lastName||"").slice(0,1)}</span><div><h2>{fullName(s)}</h2><p>{s.admissionNumber} · {s.studentNumber}</p><div className="row-actions"><Status value={s.status}/>{s.residencyStatus&&<Badge>{words(s.residencyStatus)}</Badge>}</div></div><div><small>Current placement</small><b>{[s.className,s.streamName].filter(Boolean).join(" · ")||"Not assigned"}</b><span>{s.academicYearName||""}</span></div></div>{write&&<div className="school-profile-actions"><Button variant="secondary" onClick={()=>setAction("edit")}>Edit profile</Button><Button variant="secondary" onClick={()=>setAction("guardian")}>Add guardian</Button><Button variant="secondary" onClick={()=>setAction("medical")}>Medical/support</Button><Button variant="secondary" onClick={()=>setAction("note")}>Add note</Button><Button variant="secondary" onClick={()=>setAction("document")}>Add document</Button><Button variant="secondary" onClick={()=>setAction("sibling")}>Link sibling</Button><Button variant="secondary" onClick={()=>setAction("transfer")}>Transfer</Button><Button variant="secondary" onClick={()=>setAction("promote")}>Promote</Button><Button variant="secondary" onClick={()=>setAction("status")}>Change status</Button></div>}<div className="school-detail-section"><h3>Student information</h3><div className="school-kv">{[["Date of birth",s.dateOfBirth],["Gender",s.gender],["Nationality",s.nationality],["Religion",s.religion],["Home language",s.homeLanguage],["Phone",s.phone],["Email",s.email],["Address",s.physicalAddress],["Previous school",s.previousSchool],["Previous class",s.previousClass],["Category",s.studentCategory],["House",s.house],["Campus",s.campusName]].map(([k,v])=><span key={String(k)}><small>{k}</small><b>{displayValue(v)}</b></span>)}</div></div><StudentSubsection title="Guardians" empty="No guardians linked.">{(s.guardians||[]).map((g:R)=><div className="school-list-item" key={g.id}><span><b>{fullName(g)}</b><small>{g.relationship} · {g.phonePrimary||g.email||"No contact"}</small></span><div>{bool(g.isPrimary)&&<Badge tone="success">Primary</Badge>}{bool(g.isFinanciallyResponsible)&&<Badge>Financial</Badge>}</div></div>)}</StudentSubsection><StudentSubsection title="Enrollment history" empty="No enrollment history.">{(s.enrollments||[]).map((r:R)=><div className="school-list-item" key={r.id}><span><b>{r.enrolledOn} · {words(r.status)}</b><small>{r.classId} {r.streamId?`· ${r.streamId}`:""}</small></span>{r.leftOn&&<small>Left {r.leftOn}</small>}</div>)}</StudentSubsection><StudentSubsection title="Medical & support" empty="No medical/support information recorded.">{s.medical&&Object.keys(s.medical).length?<div className="school-kv">{Object.entries(s.medical).filter(([k])=>!["id","organizationId","studentId"].includes(k)).map(([k,v])=><span key={k}><small>{words(k)}</small><b>{displayValue(v)}</b></span>)}</div>:null}</StudentSubsection><StudentSubsection title="Notes" empty="No student notes.">{(s.notes||[]).map((n:R)=><div className="school-list-item" key={n.id}><span><b>{words(n.noteType)}</b><small>{n.body}</small></span>{bool(n.confidential)&&<Badge tone="warning">Confidential</Badge>}</div>)}</StudentSubsection><StudentSubsection title="Documents" empty="No student documents.">{(s.documents||[]).map((d:R)=><div className="school-list-item" key={d.id}><span><b>{d.name}</b><small>{words(d.documentType)} · {d.mimeType||"file"}</small></span><div className="row-actions"><small>{d.issuedOn||d.createdAt}</small>{d.fileId&&<button type="button" className="school-file-link" onClick={()=>void downloadFile(`/school/files/${d.fileId}/content`,d.name||"student-document")}><FileText size={13}/> Download</button>}</div></div>)}</StudentSubsection><StudentSubsection title="Siblings" empty="No siblings linked.">{(s.siblings||[]).map((r:R)=><div className="school-list-item" key={r.id||r.studentId}><span><b>{fullName(r)||r.admissionNumber||r.siblingStudentId}</b><small>{r.admissionNumber||r.studentNumber}</small></span></div>)}</StudentSubsection><StudentSubsection title="Student timeline" empty="No timeline events.">{(s.timeline||[]).map((t:R)=><div className="school-timeline-item" key={t.id}><span/><div><b>{t.title}</b><small>{t.description}</small><em>{t.eventAt||t.createdAt}</em></div></div>)}</StudentSubsection></div>{action&&<StudentActionModal action={action} student={s} close={()=>setAction(null)} done={async()=>{setAction(null);await x.load();changed()}}/>}</Modal>}
function StudentSubsection({title,empty,children}:{title:string;empty:string;children:ReactNode}){const has=Array.isArray(children)?children.length>0:!!children;return <div className="school-detail-section"><h3>{title}</h3>{has?children:<p className="school-muted">{empty}</p>}</div>}

function StudentActionModal({action,student,close,done}:{action:string;student:R;close:()=>void;done:()=>void}){
  const[refs,setRefs]=useState<any>({branches:[],years:[],levels:[],classes:[],streams:[],students:[]}),[refsLoading,setRefsLoading]=useState(true),[v,setV]=useState<R>({}),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  useEffect(()=>{setRefsLoading(true);void Promise.all([loadSetupRefs(),get<R[]>(`${schoolBase}/student-management/students?limit=500&status=active`).catch(()=>[])]).then(([r,students])=>setRefs({...r,students})).finally(()=>setRefsLoading(false))},[]);
  useEffect(()=>{
    if(action==="edit")setV({...student});
    else if(action==="guardian")setV({firstName:"",middleName:"",lastName:"",phonePrimary:"",phoneSecondary:"",email:"",relationship:"guardian",occupation:"",physicalAddress:"",isPrimary:false,isEmergencyContact:false,isAuthorizedPickup:false,isFinanciallyResponsible:false});
    else if(action==="medical")setV({allergies:student.medical?.allergies||[],conditions:student.medical?.conditions||[],medications:student.medical?.medications||[],disabilities:student.medical?.disabilities||[],specialEducationNeeds:student.medical?.specialEducationNeeds||[],bloodGroup:student.medical?.bloodGroup||"",doctorName:student.medical?.doctorName||"",doctorPhone:student.medical?.doctorPhone||"",notes:student.medical?.notes||""});
    else if(action==="note")setV({noteType:"general",body:"",confidential:false});
    else if(action==="document")setV({documentType:"other",name:"",fileId:"",fileName:"",issuedOn:"",expiresOn:""});
    else if(action==="sibling")setV({siblingStudentId:""});
    else if(action==="status")setV({status:"inactive",reason:"",effectiveOn:today()});
    else if(action==="transfer")setV({transferType:"class",toClassLevelId:"",toClassId:"",toStreamId:"",toCampusId:student.campusId||"",destinationSchool:"",reason:"",effectiveOn:today()});
    else if(action==="promote")setV({toAcademicYearId:"",toClassLevelId:"",toClassId:"",toStreamId:"",decision:"promoted",reason:"",effectiveOn:today()});
  },[action,student.id]);

  const c=(k:string,val:any)=>setV(x=>({...x,[k]:val}));
  const transferClasses=refs.classes.filter((r:R)=>
    (!v.toClassLevelId||r.classLevelId===v.toClassLevelId)&&
    (!v.toCampusId||!r.campusId||r.campusId===v.toCampusId)&&
    (!student.currentAcademicYearId||!r.academicYearId||r.academicYearId===student.currentAcademicYearId)&&
    r.active!==false&&r.active!==0
  );
  const promotionClasses=refs.classes.filter((r:R)=>
    (!v.toClassLevelId||r.classLevelId===v.toClassLevelId)&&
    (!v.toAcademicYearId||!r.academicYearId||r.academicYearId===v.toAcademicYearId)&&
    (!student.campusId||!r.campusId||r.campusId===student.campusId)&&
    r.active!==false&&r.active!==0
  );
  const targetStreams=refs.streams.filter((r:R)=>!!v.toClassId&&r.classId===v.toClassId&&r.active!==false&&r.active!==0);

  async function save(e:FormEvent){
    e.preventDefault();setBusy(true);setError("");
    try{
      if(action==="edit")await put(`${schoolBase}/student-management/students/${student.id}`,Object.fromEntries(["campusId","firstName","middleName","lastName","preferredName","gender","dateOfBirth","nationality","placeOfBirth","religion","homeLanguage","phone","email","physicalAddress","previousSchool","previousClass","studentCategory","residencyStatus","house","profilePhotoFileId"].map(k=>[k,v[k]||null])));
      if(action==="guardian")await post(`${schoolBase}/student-management/students/${student.id}/guardians`,{firstName:v.firstName,middleName:v.middleName||null,lastName:v.lastName,phonePrimary:v.phonePrimary||null,phoneSecondary:v.phoneSecondary||null,email:v.email||null,relationship:v.relationship,occupation:v.occupation||null,physicalAddress:v.physicalAddress||null,isPrimary:!!v.isPrimary,isEmergencyContact:!!v.isEmergencyContact,isAuthorizedPickup:!!v.isAuthorizedPickup,isFinanciallyResponsible:!!v.isFinanciallyResponsible});
      if(action==="medical")await put(`${schoolBase}/student-management/students/${student.id}/medical`,{allergies:Array.isArray(v.allergies)?v.allergies:String(v.allergies||"").split(",").map((x:string)=>x.trim()).filter(Boolean),conditions:Array.isArray(v.conditions)?v.conditions:String(v.conditions||"").split(",").map((x:string)=>x.trim()).filter(Boolean),medications:Array.isArray(v.medications)?v.medications:String(v.medications||"").split(",").map((x:string)=>x.trim()).filter(Boolean),disabilities:Array.isArray(v.disabilities)?v.disabilities:String(v.disabilities||"").split(",").map((x:string)=>x.trim()).filter(Boolean),specialEducationNeeds:Array.isArray(v.specialEducationNeeds)?v.specialEducationNeeds:String(v.specialEducationNeeds||"").split(",").map((x:string)=>x.trim()).filter(Boolean),insurance:{},bloodGroup:v.bloodGroup||null,doctorName:v.doctorName||null,doctorPhone:v.doctorPhone||null,notes:v.notes||null});
      if(action==="note")await post(`${schoolBase}/student-management/students/${student.id}/notes`,v);
      if(action==="document")await post(`${schoolBase}/student-management/students/${student.id}/documents`,{documentType:v.documentType,name:v.name,fileId:v.fileId,issuedOn:v.issuedOn||null,expiresOn:v.expiresOn||null});
      if(action==="sibling")await post(`${schoolBase}/student-management/students/${student.id}/siblings`,{siblingStudentId:v.siblingStudentId});
      if(action==="status")await post(`${schoolBase}/student-management/students/${student.id}/status`,v);
      if(action==="transfer"){
        const {toClassLevelId:_,...payload}=v;
        await post(`${schoolBase}/student-management/students/${student.id}/transfer`,{...payload,toClassId:v.toClassId||null,toStreamId:v.toStreamId||null,toCampusId:v.toCampusId||null,destinationSchool:v.destinationSchool||null});
      }
      if(action==="promote"){
        const {toClassLevelId:_,...payload}=v;
        await post(`${schoolBase}/student-management/students/${student.id}/promote`,{...payload,toClassId:v.toClassId||null,toStreamId:v.toStreamId||null,reason:v.reason||null,ruleSnapshot:{}});
      }
      done();
    }catch(e){setError(errorText(e))}finally{setBusy(false)}
  }

  const title={edit:"Edit student profile",guardian:"Add guardian",medical:"Medical & support",note:"Add student note",document:"Add document",sibling:"Link sibling",status:"Change student status",transfer:"Transfer student",promote:"Promote / repeat / graduate"}[action]||"Student action";
  return <Modal title={title} onClose={close} locked={busy}><form onSubmit={save}><div className="modal-body form-grid">
    {action==="edit"&&<>
      <Field label="First name"><input value={v.firstName||""} onChange={e=>c("firstName",e.target.value)} required/></Field><Field label="Middle name"><input value={v.middleName||""} onChange={e=>c("middleName",e.target.value)}/></Field><Field label="Last name"><input value={v.lastName||""} onChange={e=>c("lastName",e.target.value)} required/></Field><Field label="Preferred name"><input value={v.preferredName||""} onChange={e=>c("preferredName",e.target.value)}/></Field>
      <Field label="Gender"><select value={v.gender||""} onChange={e=>c("gender",e.target.value)}><option value="">Not specified</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></select></Field><Field label="Date of birth"><input type="date" value={v.dateOfBirth||""} onChange={e=>c("dateOfBirth",e.target.value)}/></Field>
      <Field label="Nationality"><input value={v.nationality||""} onChange={e=>c("nationality",e.target.value)}/></Field><Field label="Phone"><input value={v.phone||""} onChange={e=>c("phone",e.target.value)}/></Field><Field label="Email"><input type="email" value={v.email||""} onChange={e=>c("email",e.target.value)}/></Field>
      <Field label="Residence"><select value={v.residencyStatus||"day"} onChange={e=>c("residencyStatus",e.target.value)}><option value="day">Day</option><option value="boarding">Boarding</option><option value="hybrid">Hybrid</option></select></Field>
      <Field label="House"><input value={v.house||""} onChange={e=>c("house",e.target.value)}/></Field><Field label="Student category"><select value={v.studentCategory||"regular"} onChange={e=>c("studentCategory",e.target.value)}><option value="regular">Regular</option><option value="scholarship">Scholarship</option><option value="sponsored">Sponsored</option><option value="staff_child">Staff child</option><option value="special_needs">Special support</option><option value="other">Other</option></select></Field>
      <div className="school-field-full"><Field label="Physical address"><textarea value={v.physicalAddress||""} onChange={e=>c("physicalAddress",e.target.value)}/></Field></div><div className="school-field-full"><Field label="Profile photo"><SchoolFileUpload purpose="student-profile-photo" accept="image/*" valueName={v.profilePhotoFileName||v.profilePhotoName||undefined} onChange={file=>setV({...v,profilePhotoFileId:file?.id||"",profilePhotoFileName:file?.originalName||""})}/></Field></div>
    </>}
    {action==="guardian"&&<>
      <Field label="First name"><input value={v.firstName||""} onChange={e=>c("firstName",e.target.value)} required/></Field><Field label="Middle name"><input value={v.middleName||""} onChange={e=>c("middleName",e.target.value)}/></Field><Field label="Last name"><input value={v.lastName||""} onChange={e=>c("lastName",e.target.value)} required/></Field>
      <Field label="Relationship"><select value={v.relationship||"guardian"} onChange={e=>c("relationship",e.target.value)}><option value="parent">Parent</option><option value="mother">Mother</option><option value="father">Father</option><option value="guardian">Guardian</option><option value="sibling">Sibling</option><option value="relative">Relative</option><option value="sponsor">Sponsor</option><option value="other">Other</option></select></Field>
      <Field label="Primary phone"><input value={v.phonePrimary||""} onChange={e=>c("phonePrimary",e.target.value)}/></Field><Field label="Secondary phone"><input value={v.phoneSecondary||""} onChange={e=>c("phoneSecondary",e.target.value)}/></Field><Field label="Email"><input type="email" value={v.email||""} onChange={e=>c("email",e.target.value)}/></Field><Field label="Occupation"><input value={v.occupation||""} onChange={e=>c("occupation",e.target.value)}/></Field>
      {[["isPrimary","Primary guardian"],["isEmergencyContact","Emergency contact"],["isAuthorizedPickup","Authorized pickup"],["isFinanciallyResponsible","Financially responsible"]].map(([k,l])=><Field key={k} label={l}><label className="school-check"><input type="checkbox" checked={!!v[k]} onChange={e=>c(k,e.target.checked)}/>{l}</label></Field>)}
    </>}
    {action==="medical"&&<>
      {[["allergies","Allergies"],["conditions","Medical conditions"],["medications","Medications"],["disabilities","Disabilities"],["specialEducationNeeds","Special educational needs"]].map(([k,l])=><Field key={k} label={l} hint="Separate multiple values with commas"><input value={Array.isArray(v[k])?v[k].join(", "):v[k]||""} onChange={e=>c(k,e.target.value)}/></Field>)}
      <Field label="Blood group"><select value={v.bloodGroup||""} onChange={e=>c("bloodGroup",e.target.value)}><option value="">Not recorded</option>{["A+","A-","B+","B-","AB+","AB-","O+","O-"].map(x=><option key={x}>{x}</option>)}</select></Field><Field label="Doctor / clinic"><input value={v.doctorName||""} onChange={e=>c("doctorName",e.target.value)}/></Field><Field label="Doctor phone"><input value={v.doctorPhone||""} onChange={e=>c("doctorPhone",e.target.value)}/></Field><div className="school-field-full"><Field label="Notes"><textarea value={v.notes||""} onChange={e=>c("notes",e.target.value)}/></Field></div>
    </>}
    {action==="note"&&<><Field label="Note type"><select value={v.noteType||"general"} onChange={e=>c("noteType",e.target.value)}><option value="general">General</option><option value="academic">Academic</option><option value="discipline">Discipline</option><option value="welfare">Welfare</option><option value="finance">Finance</option><option value="medical">Medical</option></select></Field><Field label="Confidential"><label className="school-check"><input type="checkbox" checked={!!v.confidential} onChange={e=>c("confidential",e.target.checked)}/> Confidential note</label></Field><div className="school-field-full"><Field label="Note"><textarea rows={7} value={v.body||""} onChange={e=>c("body",e.target.value)} required/></Field></div></>}
    {action==="document"&&<><Field label="Document type"><select value={v.documentType||"other"} onChange={e=>c("documentType",e.target.value)}><option value="birth_certificate">Birth certificate</option><option value="admission_form">Admission form</option><option value="report_card">Previous report card</option><option value="transfer_letter">Transfer letter</option><option value="identification">Identification</option><option value="medical">Medical</option><option value="other">Other</option></select></Field><Field label="Document name"><input value={v.name||""} onChange={e=>c("name",e.target.value)} required/></Field><div className="school-field-full"><Field label="File"><SchoolFileUpload purpose="student-document" valueName={v.fileName||undefined} required onChange={file=>setV({...v,fileId:file?.id||"",fileName:file?.originalName||""})}/></Field></div><Field label="Issued on"><input type="date" value={v.issuedOn||""} onChange={e=>c("issuedOn",e.target.value)}/></Field><Field label="Expires on"><input type="date" value={v.expiresOn||""} onChange={e=>c("expiresOn",e.target.value)}/></Field></>}
    {action==="sibling"&&<div className="school-field-full"><Field label="Sibling student" hint="Choose the sibling from existing student records."><SearchableSelect value={v.siblingStudentId||""} onChange={x=>c("siblingStudentId",x)} options={refs.students.filter((r:R)=>r.id!==student.id).map((r:R)=>({value:String(r.id),label:`${r.admissionNumber||r.studentNumber||"No number"} · ${fullName(r)}`,keywords:`${fullName(r)} ${r.admissionNumber||""} ${r.studentNumber||""}`}))} loading={refsLoading} placeholder="Select sibling…" searchPlaceholder="Search student name or admission number…" emptyText="No students found." ariaLabel="Sibling student"/></Field></div>}
    {action==="status"&&<><Field label="New status"><select value={v.status||"inactive"} onChange={e=>c("status",e.target.value)}>{["active","inactive","graduated","transferred","withdrawn","suspended","deceased","alumni"].map(x=><option key={x} value={x}>{words(x)}</option>)}</select></Field><Field label="Effective date"><input type="date" value={v.effectiveOn||today()} onChange={e=>c("effectiveOn",e.target.value)}/></Field><div className="school-field-full"><Field label="Reason"><textarea value={v.reason||""} onChange={e=>c("reason",e.target.value)} required/></Field></div></>}
    {action==="transfer"&&<>
      <Field label="Transfer type"><select value={v.transferType||"class"} onChange={e=>c("transferType",e.target.value)}>{["class","stream","campus","school_out","school_in"].map(x=><option key={x} value={x}>{words(x)}</option>)}</select></Field><Field label="Effective date"><input type="date" value={v.effectiveOn||today()} onChange={e=>c("effectiveOn",e.target.value)}/></Field>
      {!["school_out"].includes(v.transferType)&&<><Field label="Target campus"><select value={v.toCampusId||""} onChange={e=>setV({...v,toCampusId:e.target.value,toClassId:"",toStreamId:""})}><option value="">Current / default campus</option>{refs.branches.map((r:R)=><option key={r.id} value={r.id}>{r.name}</option>)}</select></Field><Field label="Target class level"><select value={v.toClassLevelId||""} onChange={e=>setV({...v,toClassLevelId:e.target.value,toClassId:"",toStreamId:""})}><option value="">Select level…</option>{refs.levels.map((r:R)=><option key={r.id} value={r.id}>{r.name}</option>)}</select></Field><Field label="Target class"><select value={v.toClassId||""} onChange={e=>setV({...v,toClassId:e.target.value,toStreamId:""})} disabled={!v.toClassLevelId}><option value="">{v.toClassLevelId?(transferClasses.length?"Select class…":"No matching classes"):"Select class level first"}</option>{transferClasses.map((r:R)=><option key={r.id} value={r.id}>{r.name}</option>)}</select></Field><Field label="Target stream"><select value={v.toStreamId||""} onChange={e=>c("toStreamId",e.target.value)} disabled={!v.toClassId}><option value="">No specific stream</option>{targetStreams.map((r:R)=><option key={r.id} value={r.id}>{r.name}</option>)}</select></Field></>}
      {["school_out","school_in"].includes(v.transferType)&&<Field label="Other school"><input value={v.destinationSchool||""} onChange={e=>c("destinationSchool",e.target.value)} placeholder="School name"/></Field>}
      <div className="school-field-full"><Field label="Reason"><textarea value={v.reason||""} onChange={e=>c("reason",e.target.value)} required/></Field></div>
    </>}
    {action==="promote"&&<>
      <Field label="Decision"><select value={v.decision||"promoted"} onChange={e=>c("decision",e.target.value)}>{["promoted","repeated","graduated","manual_override"].map(x=><option key={x} value={x}>{words(x)}</option>)}</select></Field>
      <Field label="Target academic year"><select value={v.toAcademicYearId||""} onChange={e=>setV({...v,toAcademicYearId:e.target.value,toClassId:"",toStreamId:""})} required><option value="">Select academic year…</option>{refs.years.map((r:R)=><option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
      {v.decision!=="graduated"&&<><Field label="Target class level"><select value={v.toClassLevelId||""} onChange={e=>setV({...v,toClassLevelId:e.target.value,toClassId:"",toStreamId:""})}><option value="">Select level…</option>{refs.levels.map((r:R)=><option key={r.id} value={r.id}>{r.name}</option>)}</select></Field><Field label="Target class"><select value={v.toClassId||""} onChange={e=>setV({...v,toClassId:e.target.value,toStreamId:""})} disabled={!v.toClassLevelId}><option value="">{v.toClassLevelId?(promotionClasses.length?"Select class…":"No matching classes"):"Select class level first"}</option>{promotionClasses.map((r:R)=><option key={r.id} value={r.id}>{r.name}</option>)}</select></Field><Field label="Target stream"><select value={v.toStreamId||""} onChange={e=>c("toStreamId",e.target.value)} disabled={!v.toClassId}><option value="">No specific stream</option>{targetStreams.map((r:R)=><option key={r.id} value={r.id}>{r.name}</option>)}</select></Field></>}
      <Field label="Effective date"><input type="date" value={v.effectiveOn||today()} onChange={e=>c("effectiveOn",e.target.value)}/></Field><div className="school-field-full"><Field label="Reason / override note"><textarea value={v.reason||""} onChange={e=>c("reason",e.target.value)}/></Field></div>
    </>}
    {error&&<Notice tone="danger">{error}</Notice>}
  </div><div className="modal-actions"><Button type="button" variant="ghost" onClick={close}>Cancel</Button><Button disabled={busy}>{busy?"Saving…":"Save"}</Button></div></form></Modal>
}

function StudentReportRows({title,rows,headers,render}:{title:string;rows:R[];headers:string[];render:(r:R)=>ReactNode}){const[page,setPage]=useState(1),[id]=useState(()=>`student-report-${crypto.randomUUID()}`),pageSize=20,pages=Math.max(1,Math.ceil(rows.length/pageSize)),safe=Math.min(page,pages),start=(safe-1)*pageSize,visible=rows.slice(start,start+pageSize);useEffect(()=>setPage(1),[rows]);return rows.length?<><div className="report-tools"><span className="report-tools__meta">{rows.length} rows · {pageSize} per page</span><div className="report-tools__actions"><Button variant="secondary" onClick={()=>downloadTableCsv(id,title)}><FileSpreadsheet size={14}/> Export CSV</Button><Button variant="secondary" onClick={()=>printReportElement(id,title)}><Printer size={14}/> Print</Button></div></div><div className="table-wrap school-table"><table><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{visible.map((r,i)=><tr key={start+i}>{render(r)}</tr>)}</tbody></table></div><div className="report-pagination"><span>Showing {start+1}–{Math.min(start+pageSize,rows.length)} of {rows.length}</span><Pagination page={safe} pages={pages} onChange={setPage}/></div><div className="report-export-source" id={id}><table><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{render(r)}</tr>)}</tbody></table></div></>:<EmptyState title="No report rows" description="No student records match this report."/>}
function StudentReports({close}:{close:()=>void}){const enrollment=useLoad<R[]>(`${schoolBase}/student-management/reports/enrollment`,[]),demographics=useLoad<R[]>(`${schoolBase}/student-management/reports/demographics`,[]);return <Modal title="Student reports" onClose={close}><div className="modal-body"><div className="school-detail-section"><h3>Enrollment by class / stream</h3>{enrollment.loading?<Spinner/>:enrollment.error?<Notice tone="danger">{enrollment.error}</Notice>:<StudentReportRows title="Student enrollment by class and stream" rows={enrollment.data} headers={["Academic year","Class","Stream","Status","Students"]} render={r=><><td>{r.academicYear}</td><td>{r.className||"—"}</td><td>{r.streamName||"—"}</td><td><Status value={r.status}/></td><td>{r.students}</td></>}/>}</div><div className="school-detail-section"><h3>Demographics</h3>{demographics.loading?<Spinner/>:demographics.error?<Notice tone="danger">{demographics.error}</Notice>:<StudentReportRows title="Student demographics" rows={demographics.data} headers={["Gender","Nationality","Residence","Status","Students"]} render={r=><><td>{r.gender||"—"}</td><td>{r.nationality||"—"}</td><td>{words(r.residencyStatus)}</td><td><Status value={r.status}/></td><td>{r.students}</td></>}/>}</div></div></Modal>}
function StudentBulkImport({close,done}:{close:()=>void;done:()=>void}){
  const[refs,setRefs]=useState<any>({branches:[],years:[],levels:[],classes:[],streams:[]}),[rows,setRows]=useState<R[]>([]),[fileName,setFileName]=useState(""),[skip,setSkip]=useState(true),[busy,setBusy]=useState(false),[result,setResult]=useState<R|null>(null),[error,setError]=useState("");
  useEffect(()=>{void loadSetupRefs().then(setRefs)},[]);

  const norm=(v:unknown)=>String(v??"").trim().toLowerCase().replace(/[\s_-]+/g," ");
  const cell=(row:R,...names:string[])=>{
    const wanted=names.map(norm);
    const key=Object.keys(row).find(k=>wanted.includes(norm(k)));
    return key?row[key]:"";
  };
  const ref=(items:R[],raw:unknown,extra?:(r:R)=>boolean)=>{
    const n=norm(raw); if(!n)return "";
    return items.find(r=>(!extra||extra(r))&&[r.id,r.code,r.name,r.studentNumber,r.admissionNumber].some(x=>norm(x)===n))?.id||"";
  };
  const dateValue=(v:unknown)=>{
    if(!v)return "";
    if(v instanceof Date)return v.toISOString().slice(0,10);
    if(typeof v==="number"){const d=XLSX.SSF.parse_date_code(v);if(d)return `${d.y}-${String(d.m).padStart(2,"0")}-${String(d.d).padStart(2,"0")}`}
    const s=String(v).trim(); const d=new Date(s); return Number.isNaN(d.getTime())?s:d.toISOString().slice(0,10);
  };
  const prepare=(source:R[])=>source.map((raw,index)=>{
    const levelId=ref(refs.levels,cell(raw,"Class Level","Level","Grade Level"));
    const yearId=ref(refs.years,cell(raw,"Academic Year","Year"));
    const campusId=ref(refs.branches,cell(raw,"Campus","Branch"));
    const classId=ref(refs.classes,cell(raw,"Class","Current Class"),r=>(!levelId||r.classLevelId===levelId)&&(!yearId||!r.academicYearId||r.academicYearId===yearId)&&(!campusId||!r.campusId||r.campusId===campusId));
    const streamId=ref(refs.streams,cell(raw,"Stream","Section"),r=>!classId||r.classId===classId);
    const guardianFirst=String(cell(raw,"Guardian First Name","Parent First Name")||"").trim();
    const guardianLast=String(cell(raw,"Guardian Last Name","Parent Last Name")||"").trim();
    return {
      __row:index+2,
      campusId:campusId||null,
      firstName:String(cell(raw,"First Name","Firstname")||"").trim(),
      middleName:String(cell(raw,"Middle Name","Middlename")||"").trim()||null,
      lastName:String(cell(raw,"Last Name","Lastname","Surname")||"").trim(),
      preferredName:String(cell(raw,"Preferred Name")||"").trim()||null,
      gender:String(cell(raw,"Gender")||"").trim().toLowerCase()||null,
      dateOfBirth:dateValue(cell(raw,"Date of Birth","DOB"))||null,
      nationality:String(cell(raw,"Nationality")||"Ugandan").trim()||null,
      placeOfBirth:String(cell(raw,"Place of Birth")||"").trim()||null,
      religion:String(cell(raw,"Religion")||"").trim()||null,
      homeLanguage:String(cell(raw,"Home Language","Language")||"").trim()||null,
      phone:String(cell(raw,"Phone","Student Phone")||"").trim()||null,
      email:String(cell(raw,"Email","Student Email")||"").trim()||null,
      physicalAddress:String(cell(raw,"Physical Address","Address")||"").trim()||null,
      previousSchool:String(cell(raw,"Previous School")||"").trim()||null,
      previousClass:String(cell(raw,"Previous Class")||"").trim()||null,
      admissionDate:dateValue(cell(raw,"Admission Date","Date Admitted"))||today(),
      admissionClassLevelId:levelId||null,
      currentAcademicYearId:yearId||null,
      currentClassId:classId||null,
      currentStreamId:streamId||null,
      studentCategory:String(cell(raw,"Student Category","Category")||"regular").trim()||null,
      residencyStatus:["day","boarding","hybrid"].includes(norm(cell(raw,"Residence","Residency Status","Day Boarding")).replace(" ","_"))?norm(cell(raw,"Residence","Residency Status","Day Boarding")).replace(" ","_"):"day",
      house:String(cell(raw,"House")||"").trim()||null,
      status:"active",
      profilePhotoUrl:null,
      profilePhotoFileId:null,
      customFields:{},
      admissionNumber:String(cell(raw,"Admission Number")||"").trim()||undefined,
      studentNumber:String(cell(raw,"Student Number")||"").trim()||undefined,
      guardian:guardianFirst&&guardianLast?{
        firstName:guardianFirst,middleName:String(cell(raw,"Guardian Middle Name","Parent Middle Name")||"").trim()||null,lastName:guardianLast,
        phonePrimary:String(cell(raw,"Guardian Phone","Parent Phone")||"").trim()||null,phoneSecondary:null,
        email:String(cell(raw,"Guardian Email","Parent Email")||"").trim()||null,
        relationship:String(cell(raw,"Guardian Relationship","Relationship")||"guardian").trim()||"guardian",
        occupation:String(cell(raw,"Guardian Occupation","Parent Occupation")||"").trim()||null,
        physicalAddress:String(cell(raw,"Guardian Address","Parent Address")||"").trim()||null
      }:undefined
    };
  });

  async function chooseFile(file:File){
    setError("");setResult(null);
    try{
      const buffer=await file.arrayBuffer();
      const book=XLSX.read(buffer,{type:"array",cellDates:true});
      const sheet=book.Sheets[book.SheetNames[0]];
      if(!sheet)throw new Error("The workbook does not contain a readable worksheet.");
      const raw=XLSX.utils.sheet_to_json<R>(sheet,{defval:"",raw:true});
      if(!raw.length)throw new Error("The selected file has no student rows.");
      setRows(prepare(raw));setFileName(file.name);
    }catch(e){setRows([]);setFileName("");setError(e instanceof Error?e.message:errorText(e))}
  }

  function downloadTemplate(){
    const sample=[{"First Name":"John","Middle Name":"","Last Name":"Kato","Gender":"male","Date of Birth":"2015-05-12","Nationality":"Ugandan","Admission Date":today(),"Academic Year":refs.years.find((r:R)=>bool(r.isCurrent))?.name||"2026","Campus":refs.branches[0]?.name||"Main Campus","Class Level":refs.levels[0]?.name||"Primary One","Class":refs.classes[0]?.name||"P1","Stream":refs.streams[0]?.name||"A","Student Category":"regular","Residence":"day","Guardian First Name":"Mary","Guardian Last Name":"Kato","Guardian Relationship":"parent","Guardian Phone":"0700000000","Guardian Email":""}];
    const ws=XLSX.utils.json_to_sheet(sample); const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,"Students"); XLSX.writeFile(wb,"ledgerly-student-import-template.xlsx");
  }

  async function run(e:FormEvent){
    e.preventDefault();setBusy(true);setError("");
    try{
      if(!rows.length)throw new Error("Choose an Excel or CSV file before importing.");
      const invalid=rows.filter(r=>!r.firstName||!r.lastName);
      if(invalid.length)throw new Error(`${invalid.length} row(s) are missing a first name or last name. Correct the file and upload it again.`);
      const clean=rows.map(({__row,...r})=>r);
      setResult(await post<R>(`${schoolBase}/student-management/students/bulk-import`,{rows:clean,skipDuplicates:skip}));
      done();
    }catch(e){setError(errorText(e))}finally{setBusy(false)}
  }

  return <Modal title="Bulk student import" onClose={close} locked={busy}><form onSubmit={run}><div className="modal-body">
    <div className="school-import-drop"><FileSpreadsheet size={30}/><div><b>Import students from Excel or CSV</b><small>Use names and codes such as “Primary Five”, “P5”, “2026” or “Main Campus”. Ledgerly resolves them to the correct school records automatically.</small></div><label className="button button--secondary">Choose file<input hidden type="file" accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={e=>{const f=e.target.files?.[0];if(f)void chooseFile(f)}}/></label></div>
    <div className="row-actions school-import-tools"><Button type="button" variant="secondary" onClick={downloadTemplate}>Download Excel template</Button>{fileName&&<Badge tone="success">{fileName} · {rows.length} rows</Badge>}</div>
    {rows.length>0&&<div className="school-import-preview"><h3>Preview</h3><div className="table-wrap school-table"><table><thead><tr><th>Student</th><th>Level</th><th>Class</th><th>Stream</th><th>Academic year</th><th>Guardian</th></tr></thead><tbody>{rows.slice(0,8).map((r:R)=><tr key={r.__row}><td><b>{r.firstName} {r.lastName}</b><small>Spreadsheet row {r.__row}</small></td><td>{refs.levels.find((x:R)=>x.id===r.admissionClassLevelId)?.name||"—"}</td><td>{refs.classes.find((x:R)=>x.id===r.currentClassId)?.name||"—"}</td><td>{refs.streams.find((x:R)=>x.id===r.currentStreamId)?.name||"—"}</td><td>{refs.years.find((x:R)=>x.id===r.currentAcademicYearId)?.name||"—"}</td><td>{r.guardian?[r.guardian.firstName,r.guardian.lastName].join(" "):"—"}</td></tr>)}</tbody></table></div>{rows.length>8&&<small className="school-muted">Showing the first 8 of {rows.length} rows.</small>}</div>}
    <label className="school-check"><input type="checkbox" checked={skip} onChange={e=>setSkip(e.target.checked)}/> Skip students whose admission number already exists</label>
    {result&&<Notice tone={result.invalid?"warning":"success"}>Processed {result.processed} of {result.total}; invalid {result.invalid}.</Notice>}
    {result?.errors?.length>0&&<div className="fees-import-errors">{result.errors.slice(0,20).map((e:R,i:number)=><small key={i}>Row {e.row}: {e.message}</small>)}</div>}
    {error&&<Notice tone="danger">{error}</Notice>}
  </div><div className="modal-actions"><Button type="button" variant="ghost" onClick={close}>Cancel</Button><Button disabled={busy||!rows.length}>{busy?"Importing…":`Import ${rows.length||""} students`}</Button></div></form></Modal>
}

function ConfirmModal({title,text,danger=false,close,run}:{title:string;text:string;danger?:boolean;close:()=>void;run:()=>void|Promise<void>}){const[busy,setBusy]=useState(false);return <Modal title={title} onClose={close} locked={busy}><div className="modal-body"><p>{text}</p></div><div className="modal-actions"><Button variant="ghost" onClick={close}>Cancel</Button><Button variant={danger?"danger":"primary"} disabled={busy} onClick={async()=>{setBusy(true);try{await run()}finally{setBusy(false)}}}>{busy?"Working…":"Confirm"}</Button></div></Modal>}

export function ModulesPage(){const{principal}=useAuth(),write=can(principal,"admin:write"),x=useLoad<R[]>("/modules",[]),[busy,setBusy]=useState(""),[message,setMessage]=useState("");async function toggle(m:R){setBusy(m.moduleKey);setMessage("");try{if(m.enabled)await post(`/modules/${m.moduleKey}/disable`,{});else await post(`/modules/${m.moduleKey}/enable`,{configuration:{}});setMessage(`${m.name} ${m.enabled?"disabled":"enabled"}.`);await x.load()}catch(e){setMessage(errorText(e))}finally{setBusy("")}}return <div className="page"><SchoolPageHeader title="Apps & modules" text="Enable optional Ledgerly capabilities per organization without crowding the main workspace."/>{message&&<Notice tone={message.includes("enabled")||message.includes("disabled")?"success":"danger"}>{message}</Notice>}<div className="module-grid">{x.loading?<Spinner/>:x.data.map(m=>{const requires=(m.manifest?.requiresModules||[]) as string[],missing=requires.filter((key:string)=>!x.data.find(z=>z.moduleKey===key)?.enabled),dependents=x.data.filter(z=>z.enabled&&((z.manifest?.requiresModules||[]) as string[]).includes(m.moduleKey));return <Card key={m.moduleKey} className="module-card"><div className="module-card-icon">{m.moduleKey==="school-management"?<School/>:<AppWindow/>}</div><div><span className="row-actions"><h2>{m.name}</h2>{m.core&&<Badge>Core</Badge>}</span><p>{m.description}</p><small>Version {m.version} · {words(m.category)}</small>{requires.length>0&&<small>Requires: {requires.map((key:string)=>x.data.find(z=>z.moduleKey===key)?.name||key).join(", ")}</small>}{missing.length>0&&<small>Enable the required module first.</small>}{dependents.length>0&&<small>Used by: {dependents.map(z=>z.name).join(", ")}</small>}</div><div className="module-card-action"><Status value={m.enabled?"active":"inactive"}/>{write&&!m.core&&<Button variant={m.enabled?"secondary":"primary"} disabled={busy===m.moduleKey||(!m.enabled&&missing.length>0)||(m.enabled&&dependents.length>0)} onClick={()=>toggle(m)}>{busy===m.moduleKey?"Working…":m.enabled?"Disable":"Enable"}</Button>}</div></Card>})}</div></div>}
