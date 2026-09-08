import { useEffect,useMemo,useState } from "react";
import { Activity,Cloud,FileText,LockKeyhole,Plus,Printer,RefreshCw,Server,ShieldCheck,Wifi } from "lucide-react";
import { del,get,post,uploadFile,errorText } from "../../../web/api";

type NodeRow={id:string;name:string;location:string;status:string;last_seen_at?:string};
type PrinterRow={id:string;name:string;location:string;status:string;nodeId:string;systemName?:string};
type Job={id:string;jobNumber:string;title:string;documentName?:string;status:string;priority:string;copies:number;totalSheets:number;createdAt:string};
type UploadedDocument={id:string;originalName:string;mimeType:string;sizeBytes:number;checksum:string};

export function PrinterlyWorkspace(){
 const[nodes,setNodes]=useState<NodeRow[]>([]),[printers,setPrinters]=useState<PrinterRow[]>([]),[jobs,setJobs]=useState<Job[]>([]),[overview,setOverview]=useState<any>({}),[busy,setBusy]=useState(false),[error,setError]=useState(""),[pair,setPair]=useState<any>(null),[showNode,setShowNode]=useState(false),[showJob,setShowJob]=useState(false);
 const load=async()=>{setBusy(true);setError("");try{const[o,n,p,j]=await Promise.all([get<any>("/printerly/overview"),get<NodeRow[]>("/printerly/nodes"),get<PrinterRow[]>("/printerly/printers"),get<Job[]>("/printerly/jobs")]);setOverview(o);setNodes(n);setPrinters(p);setJobs(j)}catch(e){setError(errorText(e))}finally{setBusy(false)}};
 useEffect(()=>{void load();const t=setInterval(()=>void load(),15000);return()=>clearInterval(t)},[]);
 const active=useMemo(()=>jobs.filter(j=>!["completed","cancelled","failed"].includes(j.status)),[jobs]);

 const addNode=async(e:React.FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=new FormData(e.currentTarget);try{const data=await post<any>("/printerly/nodes",{name:f.get("name"),location:f.get("location")});setPair(data);setShowNode(false);await load()}catch(x){setError(errorText(x))}};
 const revokeNode=async(nodeId:string)=>{if(!window.confirm("Revoke this Printerly Node? It will immediately lose access to the remote print queue."))return;try{await post(`/printerly/nodes/${nodeId}/revoke`,{});await load()}catch(x){setError(errorText(x))}};
 const jobAction=async(jobId:string,action:"release"|"cancel")=>{try{await post(`/printerly/jobs/${jobId}/${action}`,{});await load()}catch(x){setError(errorText(x))}};

 const addJob=async(e:React.FormEvent<HTMLFormElement>)=>{
   e.preventDefault();const form=e.currentTarget,f=new FormData(form),part=f.get("file");
   if(!(part instanceof File)||!part.size){setError("Choose a document to print.");return}
   let uploaded:UploadedDocument|undefined;
   setBusy(true);setError("");
   try{
     uploaded=await uploadFile<UploadedDocument>("/printerly/documents",part,"printerly-print");
     await post("/printerly/jobs",{
       title:f.get("title"),documentId:uploaded.id,printerId:f.get("printerId")||null,copies:Number(f.get("copies"))||1,
       estimatedPages:Number(f.get("estimatedPages"))||1,priority:f.get("priority"),secureRelease:f.get("secureRelease")==="on",
       pageSize:f.get("pageSize")||"A4",colorMode:f.get("colorMode")||"monochrome",duplex:f.get("duplex")==="on"
     });
     setShowJob(false);form.reset();await load();
   }catch(x){
     if(uploaded?.id)await del(`/printerly/documents/${uploaded.id}`).catch(()=>{});
     setError(errorText(x));
   }finally{setBusy(false)}
 };

 return <div className="printerly"><header className="prn-hero"><div><div className="prn-kicker"><Cloud size={14}/> LEDGERLY REMOTE PRINTING</div><h1>Printerly</h1><p>Turn one ordinary school printer into a secure global print destination through an always-online Printerly Node.</p></div><div className="prn-actions"><button className="prn-ghost" onClick={()=>void load()}><RefreshCw size={16}/>Refresh</button><button className="prn-primary" onClick={()=>setShowJob(true)}><Plus size={16}/>New print job</button></div></header>
 {error&&<div className="prn-error">{error}</div>}
 <section className="prn-stats"><Stat icon={<Server/>} label="Nodes online" value={`${overview?.nodes?.online||0}/${overview?.nodes?.total||0}`}/><Stat icon={<Printer/>} label="Printers ready" value={`${overview?.printers?.ready||0}/${overview?.printers?.total||0}`}/><Stat icon={<Activity/>} label="Active jobs" value={overview?.jobs?.active||0}/><Stat icon={<FileText/>} label="Sheets printed" value={overview?.jobs?.sheets||0}/></section>
 <div className="prn-grid"><section className="prn-card"><div className="prn-cardhead"><div><span>APPLIANCE</span><h2>Printerly Nodes</h2></div><button onClick={()=>setShowNode(true)}><Plus size={15}/>Pair node</button></div>{nodes.length?nodes.map(n=><div className="prn-row" key={n.id}><div className="prn-device"><div className="prn-deviceicon"><Server size={18}/></div><div><b>{n.name}</b><small>{n.location||"No location set"}</small></div></div><div style={{display:"flex",gap:8,alignItems:"center"}}><span className={`prn-status ${n.status}`}>{n.status==="online"?<Wifi size={12}/>:null}{n.status}</span><button style={{border:0,background:"transparent",color:"#a83f3a",cursor:"pointer",fontSize:11}} onClick={()=>void revokeNode(n.id)}>Revoke</button></div></div>):<Empty text="No Printerly Node yet. Pair the old computer beside the printer."/>}</section>
 <section className="prn-card"><div className="prn-cardhead"><div><span>HARDWARE</span><h2>Printers</h2></div></div>{printers.length?printers.map(p=><div className="prn-row" key={p.id}><div className="prn-device"><div className="prn-deviceicon"><Printer size={18}/></div><div><b>{p.name}</b><small>{p.location||"Connected through Printerly Node"}</small></div></div><span className={`prn-status ${p.status}`}>{p.status}</span></div>):<Empty text="Printers appear automatically when a paired node reports its CUPS devices."/>}</section></div>
 <section className="prn-card prn-jobs"><div className="prn-cardhead"><div><span>LIVE QUEUE</span><h2>Print jobs</h2></div><div className="prn-live"><i/> {active.length} active</div></div><div className="prn-table"><div className="prn-tr prn-th"><span>Job</span><span>Status</span><span>Priority</span><span>Copies / sheets</span><span>Actions</span></div>{jobs.length?jobs.map(j=><div className="prn-tr" key={j.id}><span><b>{j.title}</b><small>{j.jobNumber}{j.documentName?` · ${j.documentName}`:""}</small></span><span><em className={`prn-pill ${j.status}`}>{j.status}</em></span><span>{j.priority}</span><span>{j.copies} / {j.totalSheets||"—"}</span><span style={{display:"flex",gap:6}}>{j.status==="held"&&<button style={{border:0,background:"#e9f8f0",color:"#168756",borderRadius:8,padding:"6px 8px",cursor:"pointer"}} onClick={()=>void jobAction(j.id,"release")}>Release</button>}{["queued","held"].includes(j.status)&&<button style={{border:0,background:"#fff0ef",color:"#b94a45",borderRadius:8,padding:"6px 8px",cursor:"pointer"}} onClick={()=>void jobAction(j.id,"cancel")}>Cancel</button>}</span></div>):<Empty text="The queue is empty. Submit the first remote print job."/>}</div></section>
 <section className="prn-security"><ShieldCheck/><div><b>Designed for internet-wide printing without exposing the school printer.</b><p>Documents remain private in Ledgerly object storage. The Node initiates outbound HTTPS requests and can download only the document for its current authenticated claim.</p></div><LockKeyhole/></section>

 {showNode&&<Modal title="Pair a Printerly Node" close={()=>setShowNode(false)}><form onSubmit={addNode}><label>Node name<input name="name" required placeholder="Main Office Printer Node"/></label><label>Location<input name="location" placeholder="Administration block"/></label><button className="prn-primary" type="submit">Generate pairing code</button></form></Modal>}
 {showJob&&<Modal title="Send a print job" close={()=>setShowJob(false)}><form onSubmit={addJob}><label>Job title<input name="title" required placeholder="P7 report cards"/></label><label>Document<input name="file" required type="file" accept=".pdf,.png,.jpg,.jpeg,.txt,application/pdf,image/png,image/jpeg,text/plain"/><small>PDF is recommended. Maximum 50 MB.</small></label><div className="prn-formgrid"><label>Printer<select name="printerId"><option value="">Auto route</option>{printers.filter(p=>p.status==="ready").map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Priority<select name="priority" defaultValue="normal"><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option><option value="bulk">Bulk</option></select></label><label>Copies<input name="copies" type="number" min="1" max="1000" defaultValue="1"/></label><label>Estimated pages<input name="estimatedPages" type="number" min="1" max="10000" defaultValue="1"/></label><label>Paper<select name="pageSize" defaultValue="A4"><option>A4</option><option>A5</option><option>Letter</option><option>Legal</option></select></label><label>Colour<select name="colorMode" defaultValue="monochrome"><option value="monochrome">Black & white</option><option value="color">Colour</option></select></label></div><label className="prn-check"><input name="duplex" type="checkbox"/> Print on both sides</label><label className="prn-check"><input name="secureRelease" type="checkbox"/> Hold until an authorized user releases it</label><button className="prn-primary" type="submit">Upload & queue securely</button></form></Modal>}
 {pair&&<Modal title="Node pairing code" close={()=>setPair(null)}><div className="prn-pair"><small>ENTER THIS ON THE PRINTERLY COMPUTER</small><strong>{String(pair.pairingCode).replace(/(\d{3})(\d{3})/,"$1 $2")}</strong><p>Expires at {new Date(pair.pairingExpiresAt).toLocaleTimeString()}.</p><code>sudo printerly-pair {String(pair.pairingCode).replace(/\s/g,"")}</code></div></Modal>}
 {busy&&<div className="prn-sync">Synchronizing Printerly…</div>}</div>
}

function Stat({icon,label,value}:{icon:any;label:string;value:any}){return <div className="prn-stat"><div>{icon}</div><span>{label}</span><b>{value}</b></div>}
function Empty({text}:{text:string}){return <div className="prn-empty">{text}</div>}
function Modal({title,close,children}:{title:string;close:()=>void;children:any}){return <div className="prn-modalback" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}><div className="prn-modal"><div className="prn-modalhead"><h3>{title}</h3><button onClick={close}>×</button></div>{children}</div></div>}
