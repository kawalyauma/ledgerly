import{useEffect,useMemo,useState}from"react";
import{Gauge,RefreshCw,ShieldAlert,Trash2,Save,Pencil}from"lucide-react";
import{del,errorText,get,post,put}from"../../../web/api";

type Option={id:string;name:string;code?:string;email?:string;role?:string};
type Options={users:Option[];projects:Option[];financeDepartments:Option[];schoolDepartments:Option[]};
type Metric={key:string;limit:number;used:number;request:number;projected:number;percent:number;exceeded:boolean};
type Quota={id:string;name:string;scope_type:string;scope_id?:string|null;scope_name?:string;mode:"soft"|"hard";max_impressions:number;max_sheets:number;max_cost_minor:number;warning_percent:number;periodKey:string;period:any;usage:{metrics:Metric[];peakPercent:number;warning:boolean;exceeded:boolean}};
const empty={id:"",name:"",scopeType:"organization",scopeId:"",mode:"soft",maxImpressions:"",maxSheets:"",maxCostMinor:"",warningPercent:"80"};

export function PrinterlyQuotaWorkspace(){
 const[quotas,setQuotas]=useState<Quota[]>([]),[options,setOptions]=useState<Options>({users:[],projects:[],financeDepartments:[],schoolDepartments:[]}),[form,setForm]=useState({...empty}),[busy,setBusy]=useState(false),[err,setErr]=useState("");
 const load=async()=>{setBusy(true);setErr("");try{const[q,o]=await Promise.all([get<Quota[]>("/printerly/quotas"),get<Options>("/printerly/quotas/options")]);setQuotas(q);setOptions(o)}catch(e){setErr(errorText(e))}finally{setBusy(false)}};
 useEffect(()=>{void load()},[]);
 const targets=useMemo(()=>form.scopeType==="user"?options.users:form.scopeType==="project"?options.projects:form.scopeType==="finance_department"?options.financeDepartments:form.scopeType==="school_department"?options.schoolDepartments:[],[form.scopeType,options]);
 const save=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setErr("");const body={name:form.name,scopeType:form.scopeType,scopeId:form.scopeType==="organization"?null:form.scopeId,mode:form.mode,maxImpressions:Number(form.maxImpressions||0),maxSheets:Number(form.maxSheets||0),maxCostMinor:Number(form.maxCostMinor||0),warningPercent:Number(form.warningPercent||80)};try{if(form.id)await put(`/printerly/quotas/${form.id}`,body);else await post("/printerly/quotas",body);setForm({...empty});await load()}catch(e){setErr(errorText(e));setBusy(false)}};
 const edit=(q:Quota)=>setForm({id:q.id,name:q.name,scopeType:q.scope_type,scopeId:q.scope_id||"",mode:q.mode,maxImpressions:String(q.max_impressions||""),maxSheets:String(q.max_sheets||""),maxCostMinor:String(q.max_cost_minor||""),warningPercent:String(q.warning_percent||80)});
 const remove=async(id:string)=>{if(!confirm("Disable this Printerly quota? Historical quota usage will remain available."))return;setBusy(true);try{await del(`/printerly/quotas/${id}`);if(form.id===id)setForm({...empty});await load()}catch(e){setErr(errorText(e));setBusy(false)}};
 return <div className="printerly">
  <header className="prn-hero"><div><div className="prn-kicker">QUOTAS · CONTROL · GOVERNANCE</div><h1>Printerly quotas</h1><p>Control monthly printing by organization, user, department or project. Soft quotas warn; hard quotas stop jobs before they enter the queue.</p></div><div className="prn-actions"><button className="prn-ghost" onClick={()=>void load()} disabled={busy}><RefreshCw size={16}/>Refresh</button></div></header>
  {err&&<div className="prn-error">{err}</div>}
  <div className="prn-grid">
   <section className="prn-card"><div className="prn-cardhead"><div><span>POLICY</span><h2>{form.id?"Edit quota":"New monthly quota"}</h2></div></div>
    <form onSubmit={save}><label>Quota name<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="e.g. Academics monthly printing" required/></label>
     <div className="prn-formgrid"><label>Scope<select value={form.scopeType} onChange={e=>setForm({...form,scopeType:e.target.value,scopeId:""})}><option value="organization">Whole organization</option><option value="user">User</option><option value="finance_department">Finance department</option><option value="school_department">School department</option><option value="project">Project</option></select></label>
      {form.scopeType!=="organization"&&<label>Target<select value={form.scopeId} onChange={e=>setForm({...form,scopeId:e.target.value})} required><option value="">Choose target</option>{targets.map(t=><option key={t.id} value={t.id}>{t.code?`${t.code} · `:""}{t.name}{t.email?` · ${t.email}`:""}</option>)}</select></label>}
      <label>Enforcement<select value={form.mode} onChange={e=>setForm({...form,mode:e.target.value})}><option value="soft">Soft · warn only</option><option value="hard">Hard · block excess jobs</option></select></label><label>Warn at %<input type="number" min="1" max="100" value={form.warningPercent} onChange={e=>setForm({...form,warningPercent:e.target.value})}/></label>
      <label>Max impressions / month<input type="number" min="0" value={form.maxImpressions} onChange={e=>setForm({...form,maxImpressions:e.target.value})} placeholder="0 = unlimited"/></label><label>Max sheets / month<input type="number" min="0" value={form.maxSheets} onChange={e=>setForm({...form,maxSheets:e.target.value})} placeholder="0 = unlimited"/></label><label>Max cost / month (minor units)<input type="number" min="0" value={form.maxCostMinor} onChange={e=>setForm({...form,maxCostMinor:e.target.value})} placeholder="0 = unlimited"/></label>
     </div><div className="prn-actions"><button className="prn-primary" disabled={busy}><Save size={15}/>{form.id?"Update quota":"Create quota"}</button>{form.id&&<button type="button" className="prn-ghost" onClick={()=>setForm({...empty})}>Cancel edit</button>}</div></form>
   </section>
   <section className="prn-card"><div className="prn-cardhead"><div><span>CURRENT MONTH</span><h2>Governance summary</h2></div></div>
    <div className="prn-row"><span><b>{quotas.length} active quota{quotas.length===1?"":"s"}</b><small>{quotas.filter(q=>q.mode==="hard").length} hard · {quotas.filter(q=>q.mode==="soft").length} soft</small></span><Gauge size={22}/></div>
    <div className="prn-row"><span><b>{quotas.filter(q=>q.usage.warning).length} near limits</b><small>At or above configured warning thresholds</small></span><ShieldAlert size={22}/></div>
   </section>
  </div>
  <section className="prn-card"><div className="prn-cardhead"><div><span>ACTIVE QUOTAS</span><h2>Monthly controls</h2></div></div>
   {quotas.map(q=><div className="prn-row" key={q.id}><span><b>{q.name}</b><small>{q.scope_name||"Whole organization"} · {q.mode==="hard"?"Hard block":"Soft warning"} · {q.periodKey}</small><small>{q.usage.metrics.map(m=>`${m.key}: ${m.used.toLocaleString()} / ${m.limit.toLocaleString()} (${m.percent}%)`).join(" · ")||"No bounded metric"}</small></span><span className="prn-actions"><b>{q.usage.peakPercent}%</b><button className="prn-ghost" onClick={()=>edit(q)}><Pencil size={14}/>Edit</button><button className="prn-ghost" onClick={()=>void remove(q.id)}><Trash2 size={14}/>Disable</button></span></div>)}
   {!quotas.length&&<div className="prn-empty">No Printerly quotas yet. Add a monthly organization, user, department or project quota above.</div>}
  </section>{busy&&<div className="prn-sync">Updating Printerly governance…</div>}
 </div>
}
