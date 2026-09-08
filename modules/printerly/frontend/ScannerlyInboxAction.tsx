import { useEffect,useMemo,useState } from "react";
import { Download,RefreshCw,ScanLine,X } from "lucide-react";
import { authStore,downloadFile,errorText,get,post } from "../../../web/api";

type Destination="finance"|"academics"|"exams"|"school";
type Scanner={id:string;name:string;status:string;nodeName?:string;nodeLocation?:string};
type InboxItem={id:string;scanNumber:string;title:string;documentId:string;documentName:string;mimeType:string;sizeBytes:number;createdAt:string;completedAt?:string;scannerName?:string;notes?:string};

const destinationNames:Record<Destination,string>={finance:"Finance",academics:"Academics",exams:"Examinations",school:"School Management"};
function defaultDestination(activePath:string):Destination{
  if(activePath==="academics")return "academics";
  if(activePath==="exams")return "exams";
  if(activePath==="school")return "school";
  return "finance";
}
function bytes(value:number){if(!value)return "0 B";if(value<1024)return `${value} B`;if(value<1024*1024)return `${(value/1024).toFixed(1)} KB`;return `${(value/1024/1024).toFixed(1)} MB`}

export function ScannerlyInboxAction({activePath}:{activePath:string}){
  const principal=authStore.principal();
  const canRead=!!principal&&(["owner","admin","manager","accountant","viewer"].includes(principal.role)||principal.scopes.some(s=>["school:read","documents:read","reports:read","journals:read","accounts:read"].includes(s)));
  const canWrite=!!principal&&(["owner","admin","manager","accountant"].includes(principal.role)||principal.scopes.some(s=>["school:write","documents:write","reports:write","journals:write"].includes(s)));
  const initial=useMemo(()=>defaultDestination(activePath),[activePath]);
  const[open,setOpen]=useState(false),[destination,setDestination]=useState<Destination>(initial),[scanners,setScanners]=useState<Scanner[]>([]),[items,setItems]=useState<InboxItem[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(""),[success,setSuccess]=useState("");
  useEffect(()=>{setDestination(initial)},[initial]);
  const load=async(dest=destination)=>{setLoading(true);setError("");try{const[s,i]=await Promise.all([get<Scanner[]>("/printerly/scanners"),get<InboxItem[]>(`/printerly/scannerly/inbox?module=${encodeURIComponent(dest)}&limit=80`)]);setScanners(s);setItems(i)}catch(e){setError(errorText(e))}finally{setLoading(false)}};
  const launch=()=>{setOpen(true);setSuccess("");void load(initial)};
  const changeDestination=(next:Destination)=>{setDestination(next);setSuccess("");void load(next)};
  const create=async(e:React.FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=new FormData(e.currentTarget);setLoading(true);setError("");setSuccess("");try{const result=await post<{scanNumber:string}>("/printerly/scans",{title:String(f.get("title")||`${destinationNames[destination]} scanned document`),scannerId:String(f.get("scannerId")||""),source:String(f.get("source")||"flatbed"),colorMode:String(f.get("colorMode")||"color"),resolutionDpi:Number(f.get("resolutionDpi")||300),pageSize:String(f.get("pageSize")||"A4"),outputFormat:String(f.get("outputFormat")||"pdf"),targetType:"module",targetModule:destination,notes:String(f.get("notes")||"")});setSuccess(`${result.scanNumber} queued to ${destinationNames[destination]}.`);await load(destination)}catch(x){setError(errorText(x));setLoading(false)}};
  if(!canRead||activePath==="printerly")return null;
  return <>
    <button className="prn-global-action prn-global-scan" onClick={launch} title="Open Scannerly inbox for Ledgerly modules"><ScanLine size={17}/><span>Scannerly</span></button>
    {open&&<div className="prn-modalback" onMouseDown={e=>{if(e.target===e.currentTarget&&!loading)setOpen(false)}}><div className="prn-modal prn-scannerly-global-modal"><div className="prn-modalhead"><div><small>LEDGERLY SCAN INBOX</small><h3>Scannerly</h3></div><button onClick={()=>setOpen(false)} disabled={loading}><X size={17}/></button></div>
      <div className="prn-scannerly-toolbar"><label>Module inbox<select value={destination} onChange={e=>changeDestination(e.target.value as Destination)}><option value="finance">Finance</option><option value="academics">Academics</option><option value="exams">Examinations</option><option value="school">School Management</option></select></label><button className="prn-secondary" type="button" onClick={()=>void load()} disabled={loading}><RefreshCw size={14}/>Refresh</button></div>
      {canWrite&&<form className="prn-scannerly-quickform" onSubmit={create}><div className="prn-formgrid"><label>Scanner<select name="scannerId" required><option value="">Choose ready scanner</option>{scanners.filter(s=>s.status==="ready").map(s=><option key={s.id} value={s.id}>{s.name}{s.nodeLocation?` · ${s.nodeLocation}`:""}</option>)}</select></label><label>Document title<input name="title" placeholder={`${destinationNames[destination]} scanned document`} required/></label><label>Source<select name="source" defaultValue="flatbed"><option value="flatbed">Flatbed</option><option value="adf">Automatic feeder</option></select></label><label>Colour<select name="colorMode" defaultValue="color"><option value="color">Colour</option><option value="gray">Grayscale</option><option value="lineart">Black & white</option></select></label><label>Resolution<select name="resolutionDpi" defaultValue="300"><option value="150">150 dpi</option><option value="200">200 dpi</option><option value="300">300 dpi</option><option value="600">600 dpi</option></select></label><label>Output<select name="outputFormat" defaultValue="pdf"><option value="pdf">PDF</option><option value="png">PNG (flatbed)</option><option value="jpeg">JPEG (flatbed)</option></select></label></div><label>Notes<input name="notes" placeholder="Optional reference, voucher, exam or filing note"/></label><button className="prn-primary" disabled={loading||!scanners.some(s=>s.status==="ready")}><ScanLine size={15}/>{loading?"Working…":`Scan to ${destinationNames[destination]}`}</button></form>}
      {error&&<div className="prn-error">{error}</div>}{success&&<div className="prn-success">{success}</div>}
      <div className="prn-inbox-list"><div className="prn-cardhead"><div><span>{destination.toUpperCase()} SCAN INBOX</span><h2>{destinationNames[destination]} documents</h2></div></div>{loading&&!items.length?<div className="prn-empty">Loading Scannerly inbox…</div>:items.length?items.map(item=><div className="prn-inbox-row" key={item.id}><div><b>{item.title}</b><small>{item.scanNumber} · {item.documentName} · {bytes(item.sizeBytes)}{item.scannerName?` · ${item.scannerName}`:""}</small></div><button className="prn-secondary" onClick={()=>void downloadFile(`/printerly/scans/documents/${item.documentId}/content`,item.documentName||`${item.scanNumber}.pdf`)}><Download size={14}/>Download</button></div>):<div className="prn-empty">No completed scans routed to {destinationNames[destination]} yet.</div>}</div>
      <div className="prn-modal-actions"><button className="prn-secondary" onClick={()=>setOpen(false)}>Close</button></div>
    </div></div>}
  </>;
}
