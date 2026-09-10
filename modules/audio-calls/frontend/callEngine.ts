import { get, post } from "../../../web/api";

export type WorkerPresence={id:string;displayName:string;email:string;role:string;availability:"available"|"busy"|"do_not_disturb"|"offline";lastSeenAt?:string|null;activeCallId?:string|null};
export type IncomingCall={id:string;callerUserId:string;calleeUserId:string;status:string;startedAt:string;callerName:string;callerEmail:string};
export type RecentCall={id:string;callerUserId:string;calleeUserId:string;status:string;startedAt:string;answeredAt?:string|null;endedAt?:string|null;callerName:string;calleeName:string;direction:"incoming"|"outgoing";endReason?:string|null};
export type IceConfig={iceServers:RTCIceServer[];turnConfigured:boolean};
export type CallPhase="idle"|"ringing"|"connecting"|"connected"|"ended"|"error";
export type CallState={phase:CallPhase;callId?:string;peerUserId?:string;peerName?:string;direction?:"incoming"|"outgoing";startedAt?:string;connectedAt?:string;muted:boolean;error?:string};

type Signal={sequence:number;type:"offer"|"answer"|"ice"|"hangup"|"renegotiate";fromUserId:string;payload:Record<string,unknown>};
type Listener=(state:CallState)=>void;

class AudioCallEngine{
 private state:CallState={phase:"idle",muted:false};
 private listeners=new Set<Listener>();
 private pc:RTCPeerConnection|null=null;
 private local:MediaStream|null=null;
 private remoteAudio:HTMLAudioElement|null=null;
 private signalTimer:number|undefined;
 private statusTimer:number|undefined;
 private lastSequence=0;
 private peerUserId="";
 private ending=false;

 subscribe(listener:Listener){this.listeners.add(listener);listener(this.state);return()=>{this.listeners.delete(listener)}}
 snapshot(){return this.state}
 private set(patch:Partial<CallState>){this.state={...this.state,...patch};for(const listener of this.listeners)listener(this.state)}

 async startCall(worker:WorkerPresence){
  if(this.state.phase!=="idle"&&this.state.phase!=="ended"&&this.state.phase!=="error")throw new Error("Another call is already active.");
  this.ending=false;this.lastSequence=0;this.peerUserId=worker.id;
  const call=await post<{id:string;status:string;calleeUserId:string}>("/audio-calls/calls",{calleeUserId:worker.id,metadata:{client:"web"}});
  this.set({phase:"ringing",callId:call.id,peerUserId:worker.id,peerName:worker.displayName,direction:"outgoing",startedAt:new Date().toISOString(),connectedAt:undefined,error:undefined,muted:false});
  try{await this.preparePeer(call.id,worker.id);const offer=await this.pc!.createOffer({offerToReceiveAudio:true});await this.pc!.setLocalDescription(offer);await this.send(call.id,worker.id,"offer",{sdp:this.pc!.localDescription?.sdp,type:this.pc!.localDescription?.type});this.startPolling(call.id)}catch(error){await this.fail(error)}
 }

 async acceptIncoming(call:IncomingCall){
  if(this.state.phase!=="idle"&&this.state.callId!==call.id)throw new Error("Another call is already active.");
  this.ending=false;this.lastSequence=0;this.peerUserId=call.callerUserId;
  await post(`/audio-calls/calls/${call.id}/accept`,{});
  this.set({phase:"connecting",callId:call.id,peerUserId:call.callerUserId,peerName:call.callerName,direction:"incoming",startedAt:call.startedAt,connectedAt:undefined,error:undefined,muted:false});
  try{await this.preparePeer(call.id,call.callerUserId);this.startPolling(call.id);await this.pollSignals(call.id)}catch(error){await this.fail(error)}
 }

 async declineIncoming(callId:string){await post(`/audio-calls/calls/${callId}/decline`,{});if(this.state.callId===callId)this.cleanup("ended")}

 async end(){
  const callId=this.state.callId;if(!callId)return;this.ending=true;
  try{if(this.state.phase==="ringing"&&this.state.direction==="outgoing")await post(`/audio-calls/calls/${callId}/cancel`,{});else await post(`/audio-calls/calls/${callId}/end`,{reason:"user_hangup"})}catch{}
  this.cleanup("ended");
 }

 toggleMute(){const muted=!this.state.muted;for(const track of this.local?.getAudioTracks()||[])track.enabled=!muted;this.set({muted})}

 reset(){if(this.state.phase==="ended"||this.state.phase==="error")this.set({phase:"idle",callId:undefined,peerUserId:undefined,peerName:undefined,direction:undefined,startedAt:undefined,connectedAt:undefined,error:undefined,muted:false})}

 private async preparePeer(callId:string,peerUserId:string){
  if(!navigator.mediaDevices?.getUserMedia)throw new Error("This browser does not support microphone calling.");
  const config=await get<IceConfig>("/audio-calls/ice-config");
  this.local=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
  const pc=new RTCPeerConnection({iceServers:config.iceServers});this.pc=pc;
  for(const track of this.local.getTracks())pc.addTrack(track,this.local);
  pc.onicecandidate=event=>{if(event.candidate)void this.send(callId,peerUserId,"ice",{candidate:event.candidate.toJSON()}).catch(()=>{})};
  pc.ontrack=event=>{const stream=event.streams[0]||new MediaStream([event.track]);if(!this.remoteAudio){this.remoteAudio=new Audio();this.remoteAudio.autoplay=true;}this.remoteAudio.srcObject=stream;void this.remoteAudio.play().catch(()=>{});};
  pc.onconnectionstatechange=()=>{if(pc!==this.pc)return;if(pc.connectionState==="connected")this.set({phase:"connected",connectedAt:new Date().toISOString(),error:undefined});else if(pc.connectionState==="failed")void this.fail(new Error("The audio connection failed. Check the network or TURN server."));};
 }

 private startPolling(callId:string){
  window.clearInterval(this.signalTimer);window.clearInterval(this.statusTimer);
  this.signalTimer=window.setInterval(()=>void this.pollSignals(callId),700);
  this.statusTimer=window.setInterval(()=>void this.pollStatus(callId),1600);
  void this.pollSignals(callId);void this.pollStatus(callId);
 }

 private async pollSignals(callId:string){
  if(this.state.callId!==callId||this.ending)return;
  try{const signals=await get<Signal[]>(`/audio-calls/calls/${callId}/signals?after=${this.lastSequence}`);for(const signal of signals){this.lastSequence=Math.max(this.lastSequence,signal.sequence);await this.handleSignal(callId,signal)}}catch(error){if(this.state.callId===callId&&this.state.phase!=="connected")this.set({error:error instanceof Error?error.message:"Signaling temporarily unavailable"})}
 }

 private async pollStatus(callId:string){
  if(this.state.callId!==callId||this.ending)return;
  try{const rows=await get<RecentCall[]>("/audio-calls/recent?limit=20"),call=rows.find(row=>row.id===callId);if(!call)return;if(call.status==="accepted"&&this.state.phase==="ringing")this.set({phase:"connecting"});if(!["ringing","accepted"].includes(call.status)){this.cleanup("ended")}}catch{}
 }

 private async handleSignal(callId:string,signal:Signal){
  if(!this.pc||signal.fromUserId!==this.peerUserId)return;
  if(signal.type==="offer"){
   const sdp=String(signal.payload.sdp||"");if(!sdp)return;await this.pc.setRemoteDescription({type:"offer",sdp});const answer=await this.pc.createAnswer();await this.pc.setLocalDescription(answer);await this.send(callId,this.peerUserId,"answer",{sdp:this.pc.localDescription?.sdp,type:this.pc.localDescription?.type});if(this.state.phase==="ringing")this.set({phase:"connecting"});
  }else if(signal.type==="answer"){
   const sdp=String(signal.payload.sdp||"");if(sdp&&!this.pc.currentRemoteDescription)await this.pc.setRemoteDescription({type:"answer",sdp});
  }else if(signal.type==="ice"){
   const candidate=signal.payload.candidate as RTCIceCandidateInit|undefined;if(candidate)await this.pc.addIceCandidate(candidate).catch(()=>{});
  }else if(signal.type==="hangup")this.cleanup("ended");
 }

 private send(callId:string,toUserId:string,type:Signal["type"],payload:Record<string,unknown>){return post(`/audio-calls/calls/${callId}/signals`,{toUserId,type,payload})}

 private async fail(error:unknown){const message=error instanceof DOMException&&error.name==="NotAllowedError"?"Microphone permission was denied.":error instanceof Error?error.message:"Unable to start the call";const callId=this.state.callId;if(callId&&!this.ending){this.ending=true;await post(`/audio-calls/calls/${callId}/end`,{reason:"client_error"}).catch(()=>{})}this.cleanup("error",message)}

 private cleanup(phase:"ended"|"error",error?:string){
  window.clearInterval(this.signalTimer);window.clearInterval(this.statusTimer);this.signalTimer=undefined;this.statusTimer=undefined;
  this.pc?.close();this.pc=null;for(const track of this.local?.getTracks()||[])track.stop();this.local=null;if(this.remoteAudio){this.remoteAudio.pause();this.remoteAudio.srcObject=null;this.remoteAudio=null}this.peerUserId="";this.ending=false;this.set({phase,error,connectedAt:undefined,muted:false});
 }
}

export const audioCallEngine=new AudioCallEngine();
