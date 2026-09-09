import{useEffect,useMemo,useState}from"react";
import{Archive,Clock3,Database,RefreshCw,Save,Scale,ShieldCheck,Trash2,Unlock}from"lucide-react";
import{errorText,get,post,put}from"../../../web/api";

type Policy={enabled:number;staged_hours:number;completed_print_days:number;failed_print_days:number;secure_print_minutes:number;scan_inbox_days:number;scan_routed_days:number};
type Doc={documentId:string;originalName:string;sizeBytes:number;documentStatus?:string;jobId?:string;jobNumber?:string;scanNumber?:string;title?:string;jobStatus?:string;targetType?:string;targetModule?:string;schoolFileId?:string|null;held:boolean;eligible:boolean;due:boolean;reason:string;threshold?:string|null};
type Inventory={policy:Policy;summary:{objects:number;bytes:number;dueNow:number;dueBytes:number;held:number;heldBytes:number};printDocuments:Doc[];scanDocuments:Doc[]};
type Hold={id:string;entity_type:string;entity_id:string;reason:string;held_by_name?:string;held_at:string};
type Event={id:string;event_type:string;entity_type?:string;entity_id?:string;actor_name?:string;created_at:string;details?:any};
const emptyPolicy:Policy={enabled:1,staged_hours:24,completed_print_days:7,failed_print_days:7,secure_print_minutes:10,scan_inbox_days:30,scan_routed_days:7};
const size=(n:number)=>{if(!n)return"0 B";if(n<1024)return`${n} B`;if(n<1024*1024)return`${(n/1024).toFixed(1)} KB`;return`${(n/1024/1024).toFixed(1)} MB`};

export function PrinterlyRetentionWorkspace(){
 const[policy,setPolicy]=useState<Policy>(emptyPolicy),[inv,setInv]=useState<Inventory|null>(null),[holds,setHolds]=useState<Hold[]>([]),[events,setEvents]=useState<Event[]>([]),[busy,setBusy]=useState(false),[err,setErr]=useState("");
 const load=async()=>{setBusy(true);setErr("");try{const[i,h,e]=await Promise.all([get<Inventory>("/printerly/retention/inventory"),get<Hold[]>("/printerly/retention/holds"),get<Event[]>("/printerly/retention/events?limit=120")]);setInv(i);setPolicy(i.policy||emptyPolicy);setHolds(h);setEvents(e)}catch(e){setErr(errorText(e))}finally{setBusy(false)}};
 useEffect(()=>{void load()},[]);
 const docs=useMemo(()=>[...(inv?.printDocuments||[]).map(x=>({...x,entityType:"print_document"})),...(inv?.scanDocuments||[]).map(x=>({...x,entityType:"scan_document"}))],[inv]);
 const save=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setErr("");try{await put("/printerly/retention/policy",{enabled:Boolean(policy.enabled),stagedHours:policy.staged_hours,completedPrintDays:policy.completed_print_days,failedPrintDays:policy.failed_print_days,securePrintMinutes:policy.secure_print_minutes,scanInboxDays:policy.scan_inbox_days,scanRoutedDays:policy.scan_routed_days});await load()}catch(e){setErr(errorText(e));setBusy(false)}};
 const hold=async(d:any)=>{const reason=prompt("Reason for legal hold (required):");if(!reason?.trim())return;setBusy(true);setErr("");try{await post("/printerly/retention/holds",{entityType:d.entityType,entityId:d.documentId,reason});await load()}catch(e){setErr(errorText(e));setBusy(false)}};
 const release=async(id:string)=>{if(!confirm("Release this legal hold? The document can then be purged by policy."))return;setBusy(true);try{await post(`/printerly/retention/holds/${id}/release`,{});await load()}catch(e){setErr(errorText(e));setBusy(false)}};
 const purge=async(d:any)=>{if(!confirm(`Permanently delete Printerly's stored bytes for ${d.originalName}? Metadata and audit history will remain.`))return;setBusy(true);setErr("");try{await post("/printerly/retention/purge",{entityType:d.entityType,entityId:d.documentId});await load()}catch(e){setErr(errorText(e));setBusy(false)}};
 const sweep=async()=>{setBusy(true);setErr("");try{await post("/printerly/retention/sweep",{});await load()}catch(e){setErr(errorText(e));setBusy(false)}};
 const num=(key:keyof Policy,label:string,min=0,max=3650)=><label>{label}<input type="number" min={min} max={max} value={policy[key]} onChange={e=>setPolicy({...policy,[key]:Number(e.target.value)})}/></label>;
 return <div className="printerly">
  <header className="prn-hero"><div><div className="prn-kicker">PRIVACY · RETENTION · LEGAL HOLD</div><h1>Document retention</h1><p>Control how long Printerly keeps print and scan source files. Purging removes R2 bytes while preserving job metadata, accounting and audit history.</p></div><div className="prn-actions"><button className="prn-ghost" onClick={()=>void load()} disabled={busy}><RefreshCw size={16}/>Refresh</button><button className="prn-primary" onClick={()=>void sweep()} disabled={busy}><Trash2 size={16}/>Run cleanup now</button></div></header>
  {err&&<div className="prn-error">{err}</div>}
  <div className="prn-grid">
   <section className="prn-card"><div className="prn-cardhead"><div><span>POLICY</span><h2>Automatic retention</h2></div><ShieldCheck size={22}/></div>
    <form onSubmit={save}><label className="prn-check"><input type="checkbox" checked={Boolean(policy.enabled)} onChange={e=>setPolicy({...policy,enabled:e.target.checked?1:0})}/>Enable automatic Printerly cleanup</label>
     <div className="prn-formgrid">{num("staged_hours","Unattached uploads · hours",1,720)}{num("completed_print_days","Completed prints · days")}{num("failed_print_days","Failed/cancelled prints · days")}{num("secure_print_minutes","Secure prints · minutes",0,10080)}{num("scan_inbox_days","Scannerly inbox · days")}{num("scan_routed_days","Routed scans · days")}</div>
     <p className="prn-muted">Routed scan cleanup removes only Printerly's source copy. Student/staff files already filed in School Management remain preserved.</p><div className="prn-actions"><button className="prn-primary" disabled={busy}><Save size={15}/>Save privacy policy</button></div></form>
   </section>
   <section className="prn-card"><div className="prn-cardhead"><div><span>STORAGE</span><h2>Current inventory</h2></div><Database size={22}/></div>
    <div className="prn-row"><span><b>{inv?.summary.objects||0} retained objects</b><small>{size(inv?.summary.bytes||0)} currently tracked by Printerly</small></span><Archive size={20}/></div>
    <div className="prn-row"><span><b>{inv?.summary.dueNow||0} due for purge</b><small>{size(inv?.summary.dueBytes||0)} can be cleaned now</small></span><Clock3 size={20}/></div>
    <div className="prn-row"><span><b>{inv?.summary.held||0} under legal hold</b><small>{size(inv?.summary.heldBytes||0)} protected from automated/manual purge</small></span><Scale size={20}/></div>
   </section>
  </div>
  <section className="prn-card"><div className="prn-cardhead"><div><span>OBJECTS</span><h2>Retention inventory</h2></div></div>
   {docs.slice(0,120).map((d:any)=><div className="prn-row" key={`${d.entityType}:${d.documentId}`}><span><b>{d.originalName}</b><small>{d.jobNumber||d.scanNumber||d.documentId} · {d.title||""} · {size(d.sizeBytes)} · {d.jobStatus||d.documentStatus||"stored"}</small><small>{d.held?"LEGAL HOLD":d.due?`Due now · ${d.reason}`:d.eligible?`Retain ${d.threshold||"by policy"}`:"Active · not purgeable"}{d.schoolFileId?" · School file preserved":""}</small></span><span className="prn-actions">{!d.held&&<button className="prn-ghost" onClick={()=>void hold(d)}><Scale size={14}/>Hold</button>}{d.eligible&&!d.held&&<button className="prn-ghost" onClick={()=>void purge(d)}><Trash2 size={14}/>Purge</button>}</span></div>)}
   {!docs.length&&<div className="prn-empty">No retained Printerly source objects are currently tracked.</div>}
  </section>
  <div className="prn-grid">
   <section className="prn-card"><div className="prn-cardhead"><div><span>LEGAL HOLDS</span><h2>Protected records</h2></div><Scale size={22}/></div>{holds.map(h=><div className="prn-row" key={h.id}><span><b>{h.entity_type.replaceAll("_"," ")} · {h.entity_id}</b><small>{h.reason}</small><small>{h.held_by_name||"System"} · {new Date(h.held_at).toLocaleString()}</small></span><button className="prn-ghost" onClick={()=>void release(h.id)}><Unlock size={14}/>Release</button></div>)}{!holds.length&&<div className="prn-empty">No active legal holds.</div>}</section>
   <section className="prn-card"><div className="prn-cardhead"><div><span>AUDIT</span><h2>Retention events</h2></div></div>{events.slice(0,60).map(e=><div className="prn-row" key={e.id}><span><b>{e.event_type.replaceAll("_"," ")}</b><small>{e.entity_type?`${e.entity_type} · ${e.entity_id||""}`:"Policy"}</small><small>{e.actor_name||"Automated sweep"} · {new Date(e.created_at).toLocaleString()}</small></span></div>)}{!events.length&&<div className="prn-empty">No retention events yet.</div>}</section>
  </div>{busy&&<div className="prn-sync">Updating Printerly privacy controls…</div>}
 </div>
}
