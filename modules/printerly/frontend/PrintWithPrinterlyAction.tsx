import { useEffect,useMemo,useState } from "react";
import { Printer,X,ShieldCheck,Gauge,Workflow } from "lucide-react";
import { jsPDF } from "jspdf";
import { authStore,errorText } from "../../../web/api";
import { estimateCost,loadQuickPrintContext,previewPrinterlyPolicy,sendBlobToPrinterly,type CostingOptions,type PolicyPreview,type PrinterlyPrinter } from "./client";

async function captureActiveView(activePath:string){
  const root=document.querySelector("main"),heading=root?.querySelector("h1")?.textContent?.trim()||document.title||"Ledgerly document";
  const raw=(root instanceof HTMLElement?root.innerText:document.body.innerText).replace(/\t/g,"    ").replace(/\u00a0/g," ").replace(/\n{4,}/g,"\n\n\n");
  const maxChars=140_000,text=raw.slice(0,maxChars),truncated=raw.length>maxChars;
  const pdf=new jsPDF({orientation:"portrait",unit:"pt",format:"a4",compress:true}),width=pdf.internal.pageSize.getWidth(),height=pdf.internal.pageSize.getHeight(),left=46,right=46,top=54,bottom=48,lineHeight=13;
  const addHeader=()=>{pdf.setFont("helvetica","bold");pdf.setFontSize(9);pdf.text("LEDGERLY · PRINT WITH PRINTERLY",left,28);pdf.setFont("helvetica","normal");pdf.setTextColor(100);pdf.text(activePath||"workspace",width-right,28,{align:"right"});pdf.setTextColor(0)};
  addHeader();pdf.setFont("helvetica","bold");pdf.setFontSize(18);pdf.text(pdf.splitTextToSize(heading,width-left-right),left,top);let y=top+30;
  pdf.setFont("helvetica","normal");pdf.setFontSize(9);pdf.setTextColor(95);pdf.text(`Captured ${new Date().toLocaleString()} · ${location.pathname}${location.search}`,left,y);pdf.setTextColor(0);y+=20;
  for(const paragraph of text.split("\n")){if(!paragraph.trim()){y+=lineHeight*.55;continue}const isHeading=/^[A-Z][^\n]{0,80}$/.test(paragraph.trim())&&paragraph.trim().length<80&&!paragraph.includes("    ");pdf.setFont("helvetica",isHeading?"bold":"normal");pdf.setFontSize(isHeading?11:9.5);const lines=pdf.splitTextToSize(paragraph.trim(),width-left-right) as string[];for(const line of lines){if(y>height-bottom){pdf.addPage();addHeader();y=top}pdf.text(line,left,y);y+=isHeading?15:lineHeight}y+=isHeading?3:1}
  if(truncated){if(y>height-bottom-30){pdf.addPage();addHeader();y=top}pdf.setFont("helvetica","italic");pdf.setFontSize(8);pdf.text("This workspace view was very large; Printerly captured the first 140,000 visible characters.",left,y+10)}
  const pages=pdf.getNumberOfPages();for(let page=1;page<=pages;page++){pdf.setPage(page);pdf.setFont("helvetica","normal");pdf.setFontSize(8);pdf.setTextColor(120);pdf.text(`Page ${page} of ${pages}`,width-right,height-22,{align:"right"});pdf.setTextColor(0)}
  return {blob:pdf.output("blob"),pages,title:heading,truncated};
}

export function PrintWithPrinterlyAction({activePath}:{activePath:string}){
  const principal=authStore.principal(),canPrint=!!principal&&(["owner","admin","manager","accountant"].includes(principal.role)||principal.scopes.some(s=>["school:write","documents:write","reports:write","journals:write"].includes(s)));
  const[open,setOpen]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(""),[success,setSuccess]=useState(""),[snapshot,setSnapshot]=useState<{blob:Blob;pages:number;title:string;truncated:boolean}|null>(null),[printers,setPrinters]=useState<PrinterlyPrinter[]>([]),[costing,setCosting]=useState<CostingOptions|null>(null);
  const[copies,setCopies]=useState(1),[duplex,setDuplex]=useState(false),[colorMode,setColorMode]=useState<"monochrome"|"color">("monochrome"),[projectId,setProjectId]=useState(""),[department,setDepartment]=useState(""),[priority,setPriority]=useState<"urgent"|"high"|"normal"|"bulk">("normal"),[pageSize,setPageSize]=useState<"A4"|"A5"|"Letter"|"Legal">("A4"),[printerId,setPrinterId]=useState(""),[secureRelease,setSecureRelease]=useState(false),[preview,setPreview]=useState<PolicyPreview|null>(null),[previewBusy,setPreviewBusy]=useState(false);
  const estimate=useMemo(()=>snapshot&&costing?estimateCost(costing.profile,snapshot.pages,copies,duplex,colorMode):null,[snapshot,costing,copies,duplex,colorMode]);
  const[departmentType,departmentId]=department?department.split(":"):[];
  useEffect(()=>{
    if(!snapshot||!open)return;let alive=true;
    const timer=setTimeout(()=>{setPreviewBusy(true);previewPrinterlyPolicy({title:snapshot.title,copies,estimatedPages:snapshot.pages,printerId:printerId||null,priority,secureRelease,pageSize,colorMode,duplex,projectId:projectId||null,departmentType:departmentType as any||null,departmentId:departmentId||null,sourceModule:activePath,sourceReference:`${location.pathname}${location.search}${location.hash}`}).then(v=>alive&&setPreview(v)).catch(()=>alive&&setPreview(null)).finally(()=>alive&&setPreviewBusy(false))},220);
    return()=>{alive=false;clearTimeout(timer)};
  },[snapshot,open,copies,duplex,colorMode,projectId,department,priority,pageSize,printerId,secureRelease,activePath]);
  const start=async()=>{setOpen(true);setLoading(true);setError("");setSuccess("");setPreview(null);try{const[shot,ctx]=await Promise.all([captureActiveView(activePath),loadQuickPrintContext()]);setSnapshot(shot);setPrinters(ctx.printers);setCosting(ctx.costing)}catch(e){setError(errorText(e))}finally{setLoading(false)}};
  const submit=async(e:React.FormEvent<HTMLFormElement>)=>{
    e.preventDefault();if(!snapshot)return;const f=new FormData(e.currentTarget);setLoading(true);setError("");
    try{
      const job=await sendBlobToPrinterly(snapshot.blob,`${snapshot.title.replace(/[^a-z0-9]+/gi,"-").replace(/^-|-$/g,"").slice(0,80)||"ledgerly"}.pdf`,{title:String(f.get("title")||snapshot.title),printerId:printerId||null,copies,estimatedPages:snapshot.pages,priority,secureRelease,pageSize,colorMode,duplex,projectId:projectId||null,departmentType:departmentType as any||null,departmentId:departmentId||null,sourceModule:activePath,sourceReference:`${location.pathname}${location.search}${location.hash}`});
      setSuccess(job.status==="approval_pending"?`Submitted ${job.jobNumber||job.id} for approval.`:`Queued ${job.jobNumber||job.id} successfully.`);
    }catch(e){setError(errorText(e))}finally{setLoading(false)}
  };
  if(!canPrint)return null;
  const blocked=Boolean(preview?.policy.blocked),quotaBlocked=Boolean(preview?.quota&&!preview.quota.allowed);
  return <><button className="prn-global-action" onClick={()=>void start()} title="Send the current Ledgerly view to Printerly"><Printer size={17}/><span>Print with Printerly</span></button>
    {open&&<div className="prn-modalback" onMouseDown={e=>{if(e.target===e.currentTarget&&!loading)setOpen(false)}}><div className="prn-modal prn-quick-modal"><div className="prn-modalhead"><div><small>GLOBAL LEDGERLY PRINT</small><h3>Print with Printerly</h3></div><button onClick={()=>setOpen(false)} disabled={loading}><X size={17}/></button></div>
      {loading&&!snapshot?<div className="prn-empty">Preparing a secure PDF snapshot of this Ledgerly view…</div>:snapshot&&costing?<form onSubmit={submit}>
        <div className="prn-capture"><ShieldCheck size={18}/><div><b>{snapshot.title}</b><small>{snapshot.pages} PDF page{snapshot.pages===1?"":"s"}{snapshot.truncated?" · very large view truncated":""}</small></div></div>
        <label>Job title<input name="title" defaultValue={snapshot.title} required/></label>
        <div className="prn-formgrid">
          <label>Printer<select value={printerId} onChange={e=>setPrinterId(e.target.value)}><option value="">Auto route to a ready printer</option>{printers.filter(p=>p.status==="ready").map(p=><option key={p.id} value={p.id}>{p.name}{p.location?` · ${p.location}`:""}</option>)}</select></label>
          <label>Priority<select value={priority} onChange={e=>setPriority(e.target.value as any)}><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option><option value="bulk">Bulk</option></select></label>
          <label>Copies<input type="number" min="1" max="1000" value={copies} onChange={e=>setCopies(Math.max(1,Number(e.target.value)||1))}/></label>
          <label>Paper<select value={pageSize} onChange={e=>setPageSize(e.target.value as any)}><option>A4</option><option>A5</option><option>Letter</option><option>Legal</option></select></label>
          <label>Colour<select value={colorMode} onChange={e=>setColorMode(e.target.value as any)}><option value="monochrome">Black & white</option><option value="color">Colour</option></select></label>
          <label>Charge project<select value={projectId} onChange={e=>setProjectId(e.target.value)}><option value="">No project</option>{costing.projects.map(p=><option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label>
        </div>
        <label>Charge department<select value={department} onChange={e=>setDepartment(e.target.value)}><option value="">No department</option><optgroup label="Finance departments">{costing.financeDepartments.map(d=><option key={`finance:${d.id}`} value={`finance:${d.id}`}>{d.code} · {d.name}</option>)}</optgroup><optgroup label="School departments">{costing.schoolDepartments.map(d=><option key={`school:${d.id}`} value={`school:${d.id}`}>{d.code} · {d.name}</option>)}</optgroup></select></label>
        <div className="prn-inlinechecks"><label className="prn-check"><input type="checkbox" checked={duplex} onChange={e=>setDuplex(e.target.checked)}/> Duplex</label><label className="prn-check"><input type="checkbox" checked={secureRelease} onChange={e=>setSecureRelease(e.target.checked)}/> Secure release</label></div>
        {estimate&&<div className="prn-estimate"><span>Requested usage <b>{estimate.impressions} impressions · {estimate.sheets} sheets</b></span><span>Requested cost <b>{estimate.currency} {estimate.total.toLocaleString()}</b></span></div>}
        {previewBusy&&<div className="prn-sync">Checking Printerly policy and monthly quotas…</div>}
        {preview?.policy.applied.length>0&&<div className={blocked?"prn-error":"prn-capture"}><Workflow size={17}/><div><b>{blocked?"Print blocked by policy":preview.policy.requiresApproval?"Approval required":"Printerly policy will adjust this job"}</b><small>{blocked?preview.policy.blockedReason:preview.policy.messages.join(" · ")}</small></div></div>}
        {preview?.quota&&preview.quota.quotas.length>0&&<div className={preview.quota.allowed?"prn-capture":"prn-error"}><Gauge size={17}/><div><b>{preview.quota.allowed?"Quota check passed":"Hard quota would be exceeded"}</b><small>{preview.quota.quotas.map(q=>`${q.name}: ${q.usage.peakPercent}%`).join(" · ")}</small></div></div>}
        {preview?.costing&&<div className="prn-estimate"><span>Effective policy usage <b>{preview.costing.estimatedImpressions} impressions · {preview.costing.estimatedSheets} sheets</b></span><span>Effective cost <b>{preview.costing.estimate.currency} {Number(preview.costing.estimate.totalCostMinor||0).toLocaleString()}</b></span></div>}
        {error&&<div className="prn-error">{error}</div>}{success&&<div className="prn-success">{success}</div>}
        <div className="prn-modal-actions"><button type="button" className="prn-secondary" onClick={()=>setOpen(false)}>Close</button><button className="prn-primary" disabled={loading||Boolean(success)||blocked||quotaBlocked||previewBusy} type="submit"><Printer size={15}/>{loading?"Sending…":success?"Submitted":preview?.policy.requiresApproval?"Submit for approval":"Send to Printerly"}</button></div>
      </form>:null}
      {error&&!snapshot&&<div className="prn-error">{error}</div>}
    </div></div>}
  </>;
}
