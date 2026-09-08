import {mediaDevices,MediaStream,RTCPeerConnection} from "react-native-webrtc";
import type {CameraConfig,CameraStreamConfig} from "./types";

type State={status:"idle"|"connecting"|"online"|"failed";stream:MediaStream|null;error?:string};
function waitForIce(pc:RTCPeerConnection,timeoutMs=6000){return new Promise<void>(resolve=>{if(pc.iceGatheringState==="complete")return resolve();let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timer);pc.removeEventListener("icegatheringstatechange",onChange);resolve()};const onChange=()=>{if(pc.iceGatheringState==="complete")finish()};const timer=setTimeout(finish,timeoutMs);pc.addEventListener("icegatheringstatechange",onChange)})}
function resourceUrl(base:string,location:string|null){if(!location)return null;try{return new URL(location,base).toString()}catch{return location}}
export class WhipPublisher{
 private pc:RTCPeerConnection|null=null;private stream:MediaStream|null=null;private resource:string|null=null;private stopped=false;
 constructor(private streamConfig:CameraStreamConfig,private capture:CameraConfig["capture"],private onState:(state:State)=>void){}
 private auth(){const token=this.streamConfig.publishToken;if(!token)throw new Error("NVR publish token is unavailable");return{Authorization:`Bearer ${token}`}}
 async start(){if(!this.streamConfig.whipUrl||this.pc)return;this.stopped=false;this.onState({status:"connecting",stream:null});try{
  const stream=await mediaDevices.getUserMedia({audio:false,video:{facingMode:this.capture.preferredFacing==="front"?"user":"environment",width:{ideal:this.capture.width},height:{ideal:this.capture.height},frameRate:{ideal:this.capture.fps,max:this.capture.fps}} as any});if(this.stopped){stream.getTracks().forEach(t=>t.stop());return}
  const pc=new RTCPeerConnection({iceServers:this.streamConfig.iceServers as any});this.stream=stream;this.pc=pc;stream.getTracks().forEach(track=>pc.addTrack(track,stream));
  pc.addEventListener("connectionstatechange",()=>{if(this.stopped)return;if(pc.connectionState==="connected")this.onState({status:"online",stream});else if(["failed","disconnected","closed"].includes(pc.connectionState))this.onState({status:"failed",stream,error:`WebRTC ${pc.connectionState}`})});
  const offer=await pc.createOffer();await pc.setLocalDescription(offer);await waitForIce(pc);const sdp=pc.localDescription?.sdp;if(!sdp)throw new Error("Unable to create WHIP offer");
  const response=await fetch(this.streamConfig.whipUrl,{method:"POST",headers:{"Content-Type":"application/sdp",...this.auth()},body:sdp});if(!response.ok)throw new Error(`NVR WHIP returned ${response.status}`);const answer=await response.text();this.resource=resourceUrl(this.streamConfig.whipUrl,response.headers.get("location"));await pc.setRemoteDescription({type:"answer",sdp:answer});this.onState({status:"online",stream});
 }catch(error){const message=error instanceof Error?error.message:String(error);this.onState({status:"failed",stream:this.stream,error:message});await this.stop(false);throw error}}
 async stop(notify=true){this.stopped=true;const resource=this.resource;this.resource=null;if(resource)try{void fetch(resource,{method:"DELETE",headers:this.auth()}).catch(()=>{})}catch{}try{this.pc?.close()}catch{}this.pc=null;try{this.stream?.getTracks().forEach(t=>t.stop())}catch{}this.stream=null;if(notify)this.onState({status:"idle",stream:null})}
}
