import{useEffect,useMemo,useState}from"react";
import{Download,RefreshCw,Users,Building2,FolderKanban,Printer,FileText,Coins}from"lucide-react";
import{downloadFile,errorText,get}from"../../../web/api";

type Row=Record<string,any>;
type Usage={range:{from:string;to:string};currency:string;summary:Row;daily:Row[];byRequester:Row[];byProject:Row[];byDepartment:Row[];byPrinter:Row[]};
const iso=(d:Date)=>d.toISOString().slice(0,10);
const firstOfMonth=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`};
const money=(currency:string,value:any)=>`${currency||"UGX"} ${Number(value||0).toLocaleString()}`;

export function PrinterlyReportsWorkspace(){
 const[from,setFrom]=useState(firstOfMonth()),[to,setTo]=useState(iso(new Date())),[data,setData]=useState<Usage|null>(null),[busy,setBusy]=useState(false),[err,setErr]=useState("");
 const load=async()=>{setBusy(true);setErr("");try{setData(await get<Usage>(`/printerly/reports/usage?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`))}catch(e){setErr(errorText(e))}finally{setBusy(false)}};
 useEffect(()=>{void load()},[]);
 const successRate=useMemo(()=>{const total=Number(data?.summary?.totalJobs||0);return total?Math.round(Number(data?.summary?.completedJobs||0)*1000/total)/10:0},[data]);
 const exportCsv=()=>void downloadFile(`/printerly/reports/usage.csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,`printerly-usage-${from}-to-${to}.csv`);
 return <div className="printerly">
  <header className="prn-hero"><div><div className="prn-kicker">USAGE · COST · ACCOUNTABILITY</div><h1>Printerly usage reports</h1><p>Measure printing demand and actual cost by requester, department, project, printer and day.</p></div><div className="prn-actions"><button className="prn-ghost" onClick={()=>void load()} disabled={busy}><RefreshCw size={16}/>Refresh</button><button className="prn-primary" onClick={exportCsv} disabled={!data}><Download size={16}/>Export CSV</button></div></header>
  {err&&<div className="prn-error">{err}</div>}
  <section className="prn-card"><div className="prn-cardhead"><div><span>REPORT PERIOD</span><h2>Date range</h2></div></div><div className="prn-formgrid"><label>From<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>To<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label><label><span>&nbsp;</span><button className="prn-primary" type="button" onClick={()=>void load()} disabled={busy}>Run report</button></label></div></section>
  {data&&<>
   <div className="prn-stats prn-stats-six"><Stat icon={<FileText/>} label="Jobs" value={data.summary.totalJobs}/><Stat icon={<Printer/>} label="Completed" value={data.summary.completedJobs}/><Stat icon={<FileText/>} label="Success rate" value={`${successRate}%`}/><Stat icon={<FileText/>} label="Impressions" value={Number(data.summary.impressions||0).toLocaleString()}/><Stat icon={<FileText/>} label="Sheets" value={Number(data.summary.sheets||0).toLocaleString()}/><Stat icon={<Coins/>} label="Actual cost" value={money(data.currency,data.summary.totalCostMinor)}/></div>
   <div className="prn-grid"><Breakdown title="Departments" kicker="WHO CONSUMES PRINTING" icon={<Building2 size={16}/>} rows={data.byDepartment} nameKey="departmentName" currency={data.currency}/><Breakdown title="Projects" kicker="PROJECT CHARGE" icon={<FolderKanban size={16}/>} rows={data.byProject} nameKey="projectName" currency={data.currency}/><Breakdown title="Printers" kicker="DEVICE UTILIZATION" icon={<Printer size={16}/>} rows={data.byPrinter} nameKey="printerName" currency={data.currency}/><Breakdown title="Requesters" kicker="USER DEMAND" icon={<Users size={16}/>} rows={data.byRequester} nameKey="requesterId" currency={data.currency}/></div>
   <section className="prn-card"><div className="prn-cardhead"><div><span>DAILY TREND</span><h2>Daily usage</h2></div></div><div className="prn-report-table"><div className="prn-report-head"><span>Date</span><span>Jobs</span><span>Completed</span><span>Impressions</span><span>Sheets</span><span>Cost</span></div>{data.daily.map(r=><div className="prn-report-line" key={r.day}><span><b>{r.day}</b></span><span>{r.jobs}</span><span>{r.completed}</span><span>{Number(r.impressions||0).toLocaleString()}</span><span>{Number(r.sheets||0).toLocaleString()}</span><span>{money(data.currency,r.totalCostMinor)}</span></div>)}{!data.daily.length&&<div className="prn-empty">No Printerly activity in this period.</div>}</div></section>
  </>}
  {busy&&<div className="prn-sync">Building Printerly usage report…</div>}
 </div>
}
function Stat({icon,label,value}:{icon:any;label:string;value:any}){return <div className="prn-stat"><div>{icon}</div><span>{label}</span><b>{value}</b></div>}
function Breakdown({title,kicker,icon,rows,nameKey,currency}:{title:string;kicker:string;icon:any;rows:Row[];nameKey:string;currency:string}){return <section className="prn-card"><div className="prn-cardhead"><div><span>{kicker}</span><h2>{icon} {title}</h2></div></div>{rows.slice(0,12).map((r,i)=><div className="prn-row" key={`${r[nameKey]}-${i}`}><span><b>{r[nameKey]||"Unallocated"}</b><small>{Number(r.jobs||0).toLocaleString()} jobs · {Number(r.impressions||0).toLocaleString()} impressions · {Number(r.sheets||0).toLocaleString()} sheets</small></span><b>{money(currency,r.totalCostMinor)}</b></div>)}{!rows.length&&<div className="prn-empty">No usage in this period.</div>}</section>}
