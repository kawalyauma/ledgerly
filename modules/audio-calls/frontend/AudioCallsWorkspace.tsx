import { useEffect, useMemo, useState } from "react";
import { Clock3, Mic, MicOff, Phone, PhoneOff, RefreshCw, Search, ShieldCheck, Wifi } from "lucide-react";
import { errorText, get } from "../../../web/api";
import { audioCallEngine, type CallState, type RecentCall, type WorkerPresence } from "./callEngine";

function initials(name:string){return name.trim().split(/\s+/).slice(0,2).map(x=>x[0]||"").join("").toUpperCase()||"?"}
function time(value?:string|null){if(!value)return "—";return new Date(value).toLocaleString([], {dateStyle:"medium",timeStyle:"short"})}
function duration(start?:string,end?:string|null){if(!start)return "—";const seconds=Math.max(0,Math.floor(((end?new Date(end).getTime():Date.now())-new Date(start).getTime())/1000));const m=Math.floor(seconds/60),s=seconds%60;return `${m}:${String(s).padStart(2,"0")}`}

export function AudioCallsWorkspace(){
 const[workers,setWorkers]=useState<WorkerPresence[]>([]),[recent,setRecent]=useState<RecentCall[]>([]),[query,setQuery]=useState(""),[loading,setLoading]=useState(true),[error,setError]=useState(""),[state,setState]=useState<CallState>(audioCallEngine.snapshot()),[tick,setTick]=useState(0);
 useEffect(()=>audioCallEngine.subscribe(setState),[]);
 useEffect(()=>{const timer=window.setInterval(()=>setTick(x=>x+1),1000);return()=>window.clearInterval(timer)},[]);
 async function load(){setLoading(true);setError("");try{const [people,calls]=await Promise.all([get<WorkerPresence[]>(`/audio-calls/directory?q=${encodeURIComponent(query.trim())}`),get<RecentCall[]>("/audio-calls/recent?limit=60")]);setWorkers(people);setRecent(calls)}catch(e){setError(errorText(e))}finally{setLoading(false)}}
 useEffect(()=>{const id=window.setTimeout(()=>void load(),query?250:0);return()=>window.clearTimeout(id)},[query]);
 useEffect(()=>{const id=window.setInterval(()=>{if(state.phase==="idle"||state.phase==="ended"||state.phase==="error")void load()},10000);return()=>window.clearInterval(id)},[state.phase,query]);
 const active=!["idle","ended","error"].includes(state.phase),connectedSeconds=useMemo(()=>state.connectedAt?Math.max(0,Math.floor((Date.now()-new Date(state.connectedAt).getTime())/1000)):0,[state.connectedAt,tick]);
 async function call(worker:WorkerPresence){setError("");try{await audioCallEngine.startCall(worker)}catch(e){setError(errorText(e))}}
 return <div className="audio-calls-page">
  <section className="audio-calls-hero">
   <div><span className="eyebrow">Ledgerly collaboration</span><h1>Audio Calls</h1><p>Call anyone in this organization securely over WebRTC. Voice media stays peer-to-peer whenever the network allows it, with TURN relay available for difficult networks.</p></div>
   <div className="audio-calls-trust"><ShieldCheck size={20}/><span><b>No recording by default</b><small>Only call metadata and signaling are stored.</small></span></div>
  </section>

  {error&&<div className="audio-call-error" role="alert">{error}</div>}

  {active&&<section className="audio-call-active-card" aria-live="polite">
   <div className="audio-call-active-avatar">{initials(state.peerName||"Worker")}</div>
   <div className="audio-call-active-copy"><small>{state.direction==="incoming"?"Incoming":"Outgoing"} call</small><h2>{state.peerName||"Ledgerly worker"}</h2><span className={`call-phase phase-${state.phase}`}>{state.phase==="ringing"?"Ringing…":state.phase==="connecting"?"Connecting audio…":state.phase==="connected"?`Connected · ${Math.floor(connectedSeconds/60)}:${String(connectedSeconds%60).padStart(2,"0")}`:state.phase}</span></div>
   <div className="audio-call-controls"><button className={`call-control ${state.muted?"is-muted":""}`} onClick={()=>audioCallEngine.toggleMute()} aria-pressed={state.muted}>{state.muted?<MicOff size={20}/>:<Mic size={20}/>}<span>{state.muted?"Unmute":"Mute"}</span></button><button className="call-control danger" onClick={()=>void audioCallEngine.end()}><PhoneOff size={20}/><span>End</span></button></div>
  </section>}

  {(state.phase==="ended"||state.phase==="error")&&<section className="audio-call-finished"><div><strong>{state.phase==="error"?"Call could not continue":"Call ended"}</strong><span>{state.error||state.peerName||"The call has finished."}</span></div><button onClick={()=>{audioCallEngine.reset();void load()}}>Done</button></section>}

  <div className="audio-call-grid">
   <section className="audio-call-panel directory-panel">
    <div className="audio-call-panel-head"><div><h2>People</h2><p>Organization members available to call.</p></div><button className="call-refresh" onClick={()=>void load()} disabled={loading} aria-label="Refresh people"><RefreshCw size={17}/></button></div>
    <label className="audio-call-search"><Search size={18}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search name or email"/></label>
    <div className="audio-call-directory">{workers.map(worker=><article className="audio-call-person" key={worker.id}>
     <div className="audio-call-person-avatar">{initials(worker.displayName)}</div><div className="audio-call-person-copy"><strong>{worker.displayName}</strong><span>{worker.email}</span><small><i className={`presence-dot ${worker.availability}`}/>{worker.availability.replaceAll("_"," ")} · {worker.role}</small></div>
     <button className="audio-call-button" disabled={active||worker.availability==="busy"||worker.availability==="do_not_disturb"} onClick={()=>void call(worker)}><Phone size={17}/><span>Call</span></button>
    </article>)}{!loading&&!workers.length&&<div className="audio-call-empty">No organization members match this search.</div>}{loading&&<div className="audio-call-empty">Loading people…</div>}</div>
   </section>

   <section className="audio-call-panel history-panel">
    <div className="audio-call-panel-head"><div><h2>Recent calls</h2><p>Answered, missed, declined and cancelled calls.</p></div><Clock3 size={19}/></div>
    <div className="audio-call-history">{recent.map(call=>{const other=call.direction==="outgoing"?call.calleeName:call.callerName;return <article className="audio-call-history-row" key={call.id}><div className="history-icon"><Phone size={16}/></div><div><strong>{other}</strong><span>{call.direction} · {call.status}</span><small>{time(call.startedAt)}{call.answeredAt?` · ${duration(call.answeredAt,call.endedAt)}`:""}</small></div></article>})}{!recent.length&&!loading&&<div className="audio-call-empty">No calls yet.</div>}</div>
   </section>
  </div>
  <footer className="audio-call-network-note"><Wifi size={17}/><span>For reliable calls across mobile networks, NAT and firewalls, configure the Audio Calls TURN secrets on the Worker.</span></footer>
 </div>
}
