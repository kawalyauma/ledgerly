import { useCallback,useEffect,useMemo,useState,type FormEvent } from "react";
import { BarChart3,BookOpenCheck,Boxes,Download,PackagePlus,RefreshCw,RotateCcw,UsersRound } from "lucide-react";
import { ApiError,downloadFile,errorText,get,post } from "../../../web/api";
import { useAuth } from "../../../web/auth";
import { Badge,Button,Card,EmptyState,Field,Notice,Spinner } from "../../../web/components/ui";

type R=Record<string,any>;
type View="overview"|"issue"|"stock"|"distributions"|"reports";
const B="/books";
const today=()=>new Date().toISOString().slice(0,10);
const labelType=(x:any)=>String(x)==="a4"?"A4":"Small";
const qs=(data:Record<string,any>)=>{
  const s=new URLSearchParams();
  for(const [k,v] of Object.entries(data))if(v!==undefined&&v!==null&&v!=="")s.set(k,String(v));
  return s.toString()?`?${s.toString()}`:"";
};

export function BooksWorkspace(){
  const{principal}=useAuth();
  const[disabled,setDisabled]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState("");
  const[view,setView]=useState<View>("overview"),[overview,setOverview]=useState<R>({}),[reference,setReference]=useState<R>({classes:[],streams:[],years:[],terms:[]});
  const[students,setStudents]=useState<R[]>([]),[distributions,setDistributions]=useState<R>({rows:[],total:0,limit:50,offset:0});
  const[stockMoves,setStockMoves]=useState<R>({rows:[],total:0}),[refreshKey,setRefreshKey]=useState(0);

  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const[ref,ov,stu,dist,moves]=await Promise.all([
        get<R>(`${B}/reference`),get<R>(`${B}/overview`),get<R[]>(`${B}/students?limit=300`),
        get<R>(`${B}/distributions?limit=50&offset=0`),get<R>(`${B}/stock-movements?limit=50&offset=0`)
      ]);
      setReference(ref);setOverview(ov);setStudents(stu);setDistributions(dist);setStockMoves(moves);setDisabled(false);setError("");
    }catch(x){
      if(x instanceof ApiError&&x.code==="MODULE_DISABLED")setDisabled(true);
      else setError(errorText(x));
    }finally{setLoading(false)}
  },[]);
  useEffect(()=>{void load()},[load,principal?.organizationId,refreshKey]);
  const refresh=()=>setRefreshKey(x=>x+1);

  if(disabled)return <div className="page"><div className="books-disabled"><BookOpenCheck size={48}/><h1>Writing Books</h1><p>This standalone module uses learners, classes, streams and academic periods from School Management.</p><Button onClick={async()=>{try{await post("/modules/books/enable",{configuration:{}});refresh()}catch(x){setError(errorText(x))}}}>Enable Books module</Button>{error&&<Notice tone="danger">{error}</Notice>}</div></div>;

  return <div className="page books-page">
    <div className="page-header"><div><span className="eyebrow">School operations · standalone module</span><h1>Writing Books</h1><p>Track every Small and A4 writing book received, issued to learners and remaining in stock.</p></div><Button variant="secondary" onClick={refresh}><RefreshCw size={16}/> Refresh</Button></div>
    <div className="books-dependency"><BookOpenCheck size={17}/><span>School Management is the learner and academic-data source. Books keeps only stock and issue transactions.</span></div>
    <div className="tabs">{(["overview","issue","stock","distributions","reports"] as View[]).map(x=><button className={view===x?"active":""} onClick={()=>setView(x)} key={x}>{x==="issue"?"Issue books":x[0]!.toUpperCase()+x.slice(1)}</button>)}</div>
    {error&&<Notice tone="danger">{error}</Notice>}
    {loading?<Spinner/>:view==="overview"?<Overview data={overview}/>:view==="issue"?<IssuePanel reference={reference} students={students} done={refresh}/>:view==="stock"?<StockPanel stock={overview.stock||[]} moves={stockMoves.rows||[]} done={refresh}/>:view==="distributions"?<DistributionPanel reference={reference} data={distributions} reload={setDistributions} done={refresh}/>:<ReportsPanel reference={reference} students={students}/>}  
  </div>
}

function Overview({data}:{data:R}){
  const stock=Object.fromEntries((data.stock||[]).map((x:R)=>[x.bookType,x]));
  return <><div className="metric-grid books-metrics">
    <Card><Boxes/><small>Small books available</small><strong>{Number(stock.small?.available||0).toLocaleString()}</strong><span>{Number(stock.small?.issued||0).toLocaleString()} issued</span></Card>
    <Card><Boxes/><small>A4 books available</small><strong>{Number(stock.a4?.available||0).toLocaleString()}</strong><span>{Number(stock.a4?.issued||0).toLocaleString()} issued</span></Card>
    <Card><UsersRound/><small>Learners served</small><strong>{Number(data.learnersServed||0).toLocaleString()}</strong><span>{Number(data.transactions||0).toLocaleString()} issue transactions</span></Card>
    <Card><BarChart3/><small>Current term issued</small><strong>{Number(data.currentTermIssued||0).toLocaleString()}</strong><span>{Number(data.currentTermLearners||0).toLocaleString()} learners</span></Card>
  </div>
  <Card><div className="books-card-head"><div><h2>Recent issues</h2><p>Latest active and reversed learner book transactions.</p></div></div><DistributionTable rows={data.recent||[]} compact/></Card></>
}

function IssuePanel({reference,students,done}:{reference:R;students:R[];done:()=>void}){
  const[mode,setMode]=useState<"learner"|"bulk">("learner"),[error,setError]=useState(""),[busy,setBusy]=useState(false),[classId,setClassId]=useState("");
  const currentYear=reference.current?.year?.id||"",currentTerm=reference.current?.term?.id||"";
  const classStudents=useMemo(()=>classId?students.filter(x=>x.classId===classId):students,[students,classId]);
  async function save(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setBusy(true);setError("");
    const f=new FormData(e.currentTarget);
    try{
      if(mode==="learner")await post(`${B}/distributions`,{
        studentId:f.get("studentId"),bookType:f.get("bookType"),quantity:Number(f.get("quantity")),
        academicYearId:f.get("academicYearId")||null,termId:f.get("termId")||null,distributedOn:f.get("distributedOn"),notes:f.get("notes")||null
      });
      else await post(`${B}/distributions/bulk`,{
        classId:f.get("classId"),streamId:f.get("streamId")||null,bookType:f.get("bookType"),
        quantityPerLearner:Number(f.get("quantity")),academicYearId:f.get("academicYearId")||null,termId:f.get("termId")||null,
        distributedOn:f.get("distributedOn"),notes:f.get("notes")||null
      });
      (e.currentTarget as HTMLFormElement).reset();setClassId("");done();
    }catch(x){setError(errorText(x))}finally{setBusy(false)}
  }
  return <Card><div className="books-card-head"><div><h2>Issue writing books</h2><p>Issue to one learner or to every active learner in a class/stream.</p></div><div className="books-segment"><button className={mode==="learner"?"active":""} onClick={()=>setMode("learner")} type="button">One learner</button><button className={mode==="bulk"?"active":""} onClick={()=>setMode("bulk")} type="button">Whole class / stream</button></div></div>
    <form className="books-form" onSubmit={save}>
      {mode==="learner"?<><Field label="Filter learners by class"><select value={classId} onChange={e=>setClassId(e.target.value)}><option value="">All active learners</option>{reference.classes?.map((x:R)=><option key={x.id} value={x.id}>{x.name}</option>)}</select></Field><Field label="Learner"><select name="studentId" required><option value="">Choose learner…</option>{classStudents.map(x=><option key={x.id} value={x.id}>{x.name} · {x.admissionNumber} · {x.className||"No class"}{x.streamName?` / ${x.streamName}`:""}</option>)}</select></Field></>:<ClassStreamFields reference={reference} classId={classId} setClassId={setClassId}/>}
      <div className="form-grid">
        <Field label="Book type"><select name="bookType" required><option value="small">Small book</option><option value="a4">A4 book</option></select></Field>
        <Field label={mode==="bulk"?"Quantity per learner":"Quantity"}><input name="quantity" type="number" min="1" step="1" defaultValue="1" required/></Field>
        <Field label="Academic year"><select name="academicYearId" defaultValue={currentYear}><option value="">No academic year</option>{reference.years?.map((x:R)=><option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <Field label="Term"><select name="termId" defaultValue={currentTerm}><option value="">No term</option>{reference.terms?.map((x:R)=><option key={x.id} value={x.id}>{x.name} · {reference.years?.find((y:R)=>y.id===x.academicYearId)?.name||""}</option>)}</select></Field>
        <Field label="Issue date"><input name="distributedOn" type="date" defaultValue={today()} required/></Field>
      </div>
      <Field label="Notes"><textarea name="notes" placeholder="Optional reason, teacher, exercise-book purpose or reference…"/></Field>
      {mode==="bulk"&&<Notice tone="info">Bulk issue creates one auditable transaction per active learner. The class/stream and period are preserved on every row for historical reporting.</Notice>}
      {error&&<Notice tone="danger">{error}</Notice>}<div className="books-actions"><Button disabled={busy}>{busy?"Saving…":mode==="bulk"?"Issue to class / stream":"Issue to learner"}</Button></div>
    </form>
  </Card>
}

function ClassStreamFields({reference,classId,setClassId}:{reference:R;classId:string;setClassId:(x:string)=>void}){
  const streams=(reference.streams||[]).filter((x:R)=>!classId||x.classId===classId);
  return <div className="form-grid books-span"><Field label="Class"><select name="classId" value={classId} onChange={e=>setClassId(e.target.value)} required><option value="">Choose class…</option>{reference.classes?.map((x:R)=><option key={x.id} value={x.id}>{x.name}</option>)}</select></Field><Field label="Stream (optional)"><select name="streamId"><option value="">All streams in class</option>{streams.map((x:R)=><option key={x.id} value={x.id}>{x.name}</option>)}</select></Field></div>
}

function StockPanel({stock,moves,done}:{stock:R[];moves:R[];done:()=>void}){
  const[error,setError]=useState(""),[busy,setBusy]=useState(false);
  async function save(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setError("");const f=new FormData(e.currentTarget);try{await post(`${B}/stock-movements`,{bookType:f.get("bookType"),movementType:f.get("movementType"),quantityDelta:Number(f.get("quantityDelta")),movementOn:f.get("movementOn"),referenceText:f.get("referenceText")||null,notes:f.get("notes")||null});(e.currentTarget as HTMLFormElement).reset();done()}catch(x){setError(errorText(x))}finally{setBusy(false)}}
  return <div className="books-two"><Card><h2>Add / adjust stock</h2><p>Record books received into the school store or a verified stock correction.</p><form className="books-form" onSubmit={save}><Field label="Book type"><select name="bookType"><option value="small">Small book</option><option value="a4">A4 book</option></select></Field><Field label="Movement"><select name="movementType"><option value="receipt">Stock received</option><option value="adjustment">Stock adjustment (+ or -)</option></select></Field><Field label="Quantity change"><input name="quantityDelta" type="number" step="1" defaultValue="1" required/></Field><Field label="Date"><input name="movementOn" type="date" defaultValue={today()} required/></Field><Field label="Reference"><input name="referenceText" placeholder="Delivery note / stock count reference"/></Field><Field label="Notes"><textarea name="notes"/></Field>{error&&<Notice tone="danger">{error}</Notice>}<Button disabled={busy}><PackagePlus size={16}/>{busy?"Saving…":"Record stock"}</Button></form></Card>
    <Card><h2>Current stock</h2><div className="books-stock-list">{stock.map(x=><div key={x.bookType}><span>{labelType(x.bookType)}</span><strong>{Number(x.available||0).toLocaleString()}</strong><small>{Number(x.stockIn||0).toLocaleString()} in · {Number(x.issued||0).toLocaleString()} issued</small></div>)}</div><h3>Recent stock movements</h3>{moves.length?<div className="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Movement</th><th>Qty</th><th>Status</th><th/></tr></thead><tbody>{moves.slice(0,20).map(x=><tr key={x.id}><td>{x.movementOn}</td><td>{labelType(x.bookType)}</td><td>{x.movementType}</td><td>{Number(x.quantityDelta)>0?"+":""}{x.quantityDelta}</td><td><Badge tone={x.reversedAt?"neutral":"success"}>{x.reversedAt?"Reversed":"Active"}</Badge></td><td>{!x.reversedAt&&<button type="button" className="books-link danger" onClick={async()=>{const reason=window.prompt("Reason for reversing this stock movement:");if(reason===null)return;try{await post(`${B}/stock-movements/${x.id}/reverse`,{reason:reason||"Stock correction"});done()}catch(e){setError(errorText(e))}}}><RotateCcw size={14}/> Reverse</button>}</td></tr>)}</tbody></table></div>:<EmptyState title="No stock movements" description="Record the initial Small and A4 writing-book stock to begin issuing books."/>}</Card>
  </div>
}

function DistributionPanel({reference,data,reload,done}:{reference:R;data:R;reload:(x:R)=>void;done:()=>void}){
  const[bookType,setBookType]=useState(""),[classId,setClassId]=useState(""),[termId,setTermId]=useState(""),[offset,setOffset]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const limit=50;
  async function load(next=offset){setBusy(true);setError("");try{const r=await get<R>(`${B}/distributions${qs({bookType,classId,termId,limit,offset:next})}`);reload(r);setOffset(next)}catch(x){setError(errorText(x))}finally{setBusy(false)}}
  return <Card><div className="books-card-head"><div><h2>Issue register</h2><p>{Number(data.total||0).toLocaleString()} transactions. Reversals remain visible for audit.</p></div></div><div className="books-filters"><select value={bookType} onChange={e=>setBookType(e.target.value)}><option value="">All book types</option><option value="small">Small</option><option value="a4">A4</option></select><select value={classId} onChange={e=>setClassId(e.target.value)}><option value="">All classes</option>{reference.classes?.map((x:R)=><option value={x.id} key={x.id}>{x.name}</option>)}</select><select value={termId} onChange={e=>setTermId(e.target.value)}><option value="">All terms</option>{reference.terms?.map((x:R)=><option value={x.id} key={x.id}>{x.name}</option>)}</select><Button variant="secondary" onClick={()=>void load(0)} disabled={busy}>Apply</Button></div>{error&&<Notice tone="danger">{error}</Notice>}<DistributionTable rows={data.rows||[]} onReverse={async x=>{const reason=window.prompt(`Reason for reversing ${x.quantity} ${labelType(x.bookType)} book(s) issued to ${x.studentName}:`);if(reason===null)return;try{await post(`${B}/distributions/${x.id}/reverse`,{reason:reason||"Entry correction"});done()}catch(e){setError(errorText(e))}}}/><div className="books-pager"><Button variant="secondary" disabled={offset<=0||busy} onClick={()=>void load(Math.max(0,offset-limit))}>Previous</Button><span>{data.total?`${offset+1}–${Math.min(offset+limit,data.total)} of ${data.total}`:"0 records"}</span><Button variant="secondary" disabled={offset+limit>=Number(data.total||0)||busy} onClick={()=>void load(offset+limit)}>Next</Button></div></Card>
}

function DistributionTable({rows,compact=false,onReverse}:{rows:R[];compact?:boolean;onReverse?:(x:R)=>void}){
  if(!rows.length)return <EmptyState title="No book issues yet" description="Issue Small or A4 writing books to learners and the transactions will appear here."/>;
  return <div className="table-wrap"><table><thead><tr><th>Date</th><th>Learner</th><th>Class</th><th>Book</th><th>Qty</th>{!compact&&<th>Period</th>}<th>Status</th>{onReverse&&<th/>}</tr></thead><tbody>{rows.map(x=><tr key={x.id}><td>{x.distributedOn}</td><td><b>{x.studentName}</b><small>{x.admissionNumber||x.studentNumber}</small></td><td>{x.className||"—"}<small>{x.streamName||""}</small></td><td>{labelType(x.bookType)}</td><td><b>{x.quantity}</b></td>{!compact&&<td>{x.academicYearName||"—"}<small>{x.termName||""}</small></td>}<td><Badge tone={x.reversedAt?"neutral":"success"}>{x.reversedAt?"Reversed":"Active"}</Badge></td>{onReverse&&<td>{!x.reversedAt&&<button className="books-link danger" onClick={()=>onReverse(x)}><RotateCcw size={14}/> Reverse</button>}</td>}</tr>)}</tbody></table></div>
}

function ReportsPanel({reference,students}:{reference:R;students:R[]}){
  const[kind,setKind]=useState<"class"|"learner"|"period"|"unissued"|"stock">("class"),[classId,setClassId]=useState(""),[studentId,setStudentId]=useState(""),[termId,setTermId]=useState(reference.current?.term?.id||""),[yearId,setYearId]=useState(reference.current?.year?.id||""),[report,setReport]=useState<R|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState("");
  const query={classId,studentId,termId,academicYearId:yearId};
  async function run(){setLoading(true);setError("");try{if((kind==="class"||kind==="unissued")&&!classId)throw new Error("Choose a class first.");if(kind==="learner"&&!studentId)throw new Error("Choose a learner first.");setReport(await get<R>(`${B}/reports/${kind}${qs(query)}`))}catch(x){setError(errorText(x))}finally{setLoading(false)}}
  async function exportCsv(){try{if((kind==="class"||kind==="unissued")&&!classId)throw new Error("Choose a class first.");if(kind==="learner"&&!studentId)throw new Error("Choose a learner first.");await downloadFile(`${B}/reports/export${qs({...query,report:kind})}`,`books-${kind}-${today()}.csv`)}catch(x){setError(errorText(x))}}
  return <Card><div className="books-card-head"><div><h2>Books reports</h2><p>Learner, class, unissued, period and stock reports are generated from the transaction history.</p></div><Button variant="secondary" onClick={()=>void exportCsv()}><Download size={16}/> Export CSV</Button></div><div className="books-report-tabs">{(["class","learner","period","unissued","stock"] as const).map(x=><button key={x} className={kind===x?"active":""} onClick={()=>{setKind(x);setReport(null)}}>{x==="unissued"?"Learners with no books":x[0].toUpperCase()+x.slice(1)}</button>)}</div><div className="books-filters">
    {(kind==="class"||kind==="unissued")&&<select value={classId} onChange={e=>setClassId(e.target.value)}><option value="">Choose class…</option>{reference.classes?.map((x:R)=><option key={x.id} value={x.id}>{x.name}</option>)}</select>}
    {kind==="learner"&&<select value={studentId} onChange={e=>setStudentId(e.target.value)}><option value="">Choose learner…</option>{students.map(x=><option key={x.id} value={x.id}>{x.name} · {x.admissionNumber}</option>)}</select>}
    {kind!=="stock"&&<><select value={yearId} onChange={e=>setYearId(e.target.value)}><option value="">All years</option>{reference.years?.map((x:R)=><option key={x.id} value={x.id}>{x.name}</option>)}</select><select value={termId} onChange={e=>setTermId(e.target.value)}><option value="">All terms</option>{reference.terms?.filter((x:R)=>!yearId||x.academicYearId===yearId).map((x:R)=><option key={x.id} value={x.id}>{x.name}</option>)}</select></>}
    <Button onClick={()=>void run()} disabled={loading}>{loading?"Generating…":"Generate report"}</Button>
  </div>{error&&<Notice tone="danger">{error}</Notice>}{loading?<Spinner/>:report?<ReportResult kind={kind} data={report}/>:<div className="books-report-empty"><BarChart3 size={34}/><h3>Choose filters and generate a report</h3><p>Reports use School Management learner/class identities while preserving each historic issue snapshot.</p></div>}</Card>
}

function ReportResult({kind,data}:{kind:string;data:R}){
  if(kind==="stock")return <div className="books-stock-list">{data.stock?.map((x:R)=><div key={x.bookType}><span>{labelType(x.bookType)}</span><strong>{Number(x.available||0).toLocaleString()}</strong><small>Available · {Number(x.stockIn||0).toLocaleString()} stocked · {Number(x.issued||0).toLocaleString()} issued</small></div>)}</div>;
  if(kind==="learner")return <><div className="books-summary"><b>{data.student?.name}</b><span>Small: {data.totals?.small||0}</span><span>A4: {data.totals?.a4||0}</span><span>Total: {data.totals?.total||0}</span></div><DistributionTable rows={data.transactions||[]}/></>;
  if(kind==="period")return <><div className="books-summary">{data.byType?.map((x:R)=><span key={x.bookType}><b>{labelType(x.bookType)}</b>: {x.quantity} books · {x.learners} learners</span>)}</div><div className="table-wrap"><table><thead><tr><th>Date</th><th>Books issued</th><th>Transactions</th><th>Learners</th></tr></thead><tbody>{data.byDay?.map((x:R)=><tr key={x.date}><td>{x.date}</td><td>{x.quantity}</td><td>{x.transactions}</td><td>{x.learners}</td></tr>)}</tbody></table></div></>;
  const rows=data.rows||[];
  return <>{data.totals&&<div className="books-summary"><span>Learners: <b>{data.totals.learners}</b></span><span>Served: <b>{data.totals.learnersServed}</b></span><span>Small: <b>{data.totals.small}</b></span><span>A4: <b>{data.totals.a4}</b></span><span>Total: <b>{data.totals.total}</b></span></div>}{kind==="unissued"&&<Notice tone="info">{data.total||0} learner(s) have no active book issue in the selected period.</Notice>}{rows.length?<div className="table-wrap"><table><thead><tr><th>Learner</th><th>Class</th><th>Stream</th><th>Small</th><th>A4</th><th>Total</th><th>Last issue</th></tr></thead><tbody>{rows.map((x:R)=><tr key={x.studentId}><td><b>{x.studentName}</b><small>{x.admissionNumber||x.studentNumber}</small></td><td>{x.className||"—"}</td><td>{x.streamName||"—"}</td><td>{x.small||0}</td><td>{x.a4||0}</td><td><b>{x.total||0}</b></td><td>{x.lastIssuedOn||"—"}</td></tr>)}</tbody></table></div>:<EmptyState title="No rows for this report" description="Try another class, learner or period."/>}</>;
}
