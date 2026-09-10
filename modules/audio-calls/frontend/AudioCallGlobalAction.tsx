import { useEffect, useState } from "react";
import { Phone, PhoneCall, PhoneOff } from "lucide-react";
import { get, post } from "../../../web/api";
import { audioCallEngine, type CallState, type IncomingCall } from "./callEngine";

export function AudioCallGlobalAction({activePath}:{activePath:string}){
 const[incoming,setIncoming]=useState<IncomingCall|null>(null),[state,setState]=useState<CallState>(audioCallEngine.snapshot()),[busy,setBusy]=useState(false);
 useEffect(()=>audioCallEngine.subscribe(setState),[]);
 useEffect(()=>{
  let disposed=false;
  const heartbeat=()=>post("/audio-calls/presence/heartbeat",{availability:"available",deviceId:"web"}).catch(()=>{});
  const poll=()=>get<IncomingCall|null>("/audio-calls/incoming").then(call=>{if(!disposed&&state.phase==="idle")setIncoming(call)}).catch(()=>{});
  heartbeat();poll();const h=window.setInterval(heartbeat,15000),p=window.setInterval(poll,2000);
  return()=>{disposed=true;window.clearInterval(h);window.clearInterval(p)};
 },[state.phase]);
 async function accept(){if(!incoming)return;setBusy(true);try{await audioCallEngine.acceptIncoming(incoming);setIncoming(null);location.hash="audio-calls"}finally{setBusy(false)}}
 async function decline(){if(!incoming)return;setBusy(true);try{await audioCallEngine.declineIncoming(incoming.id);setIncoming(null)}finally{setBusy(false)}}
 const active=state.phase!=="idle"&&state.phase!=="ended"&&state.phase!=="error";
 return <>
  <button className={`icon-button audio-call-top ${active?"is-active":""}`} aria-label={active?`Open active call with ${state.peerName||"worker"}`:"Open audio calls"} onClick={()=>location.hash="audio-calls"}>
   {active?<PhoneCall size={19}/>:<Phone size={19}/>} {active&&<span className="audio-call-live-dot"/>}
  </button>
  {incoming&&state.phase==="idle"&&<div className="audio-call-incoming" role="dialog" aria-modal="true" aria-label={`Incoming call from ${incoming.callerName}`}>
   <div className="audio-call-avatar">{incoming.callerName.slice(0,2).toUpperCase()}</div>
   <div className="audio-call-incoming-copy"><small>Incoming Ledgerly audio call</small><strong>{incoming.callerName}</strong><span>{incoming.callerEmail}</span></div>
   <div className="audio-call-incoming-actions">
    <button className="call-round call-decline" disabled={busy} onClick={()=>void decline()} aria-label="Decline call"><PhoneOff size={20}/></button>
    <button className="call-round call-accept" disabled={busy} onClick={()=>void accept()} aria-label="Accept call"><Phone size={20}/></button>
   </div>
  </div>}
 </>;
}
