import {mediaDevices,MediaStream,RTCPeerConnection} from "react-native-webrtc";
import type {CameraConfig,CameraStreamConfig} from "./types";

type State={status:"idle"|"connecting"|"online"|"failed";stream:MediaStream|null;error?:string};
type RetryState={failures:number;nextAttemptAt:number};
const retryByEndpoint=new Map<string,RetryState>();
function waitForIce(pc:RTCPeerConnection,timeoutMs=6000){return new Promise<void>(resolve=>{if(pc.iceGatheringState==="complete")return resolve();let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timer);pc.removeEventListener("icegatheringstatechange",onChange);resolve()};const onChange=()=>{if(pc.iceGatheringState==="complete")finish()};const timer=setTimeout(finish,timeoutMs);pc.addEventListener("icegatheringstatechange",onChange)})}
function resourceUrl(base:string,location:string|null){if(!location)return null;try{return new URL(location,base).toString()}catch{return location}}
function nextBackoff(endpoint:string){const prior=retryByEndpoint.get(endpoint),failures=Math.min(8,(prior?.failures||0)+1),base=Math.min(60_000,5_000*Math.pow(2,Math.max(0,failures-1))),jitter=Math.round(base*(Math.random()*.3-.15)),nextAttemptAt=Date.now()+Math.max(2_000,base+jitter);retryByEndpoint.set(endpoint,{failures,nextAttemptAt});return nextAttemptAt}
function resetBackoff(endpoint:string){retryByEndpoint.delete(endpoint)}
export class WhipPublisher{
 private pc:RTCPeerConnection|null=null;private stream:MediaStream|null=null;private resource:string|null=null;private stopped=false;private delayTimer:ReturnType<typeof setTimeout>|null=null;
 constructor(private streamConfig:CameraStreamConfig,private capture:CameraConfig["capture"],private onState:(state:State)=>void){}
 private endpoint(){return String(this.streamConfig.whipUrl||"")}
 private auth(){const token=this.streamConfig.publishToken;if(!token)throw new Error("NVR publish token is unavailable");return{Authorization:`Bearer ${token}`}}
 private async waitForRetryWindow(){const retry=retryByEndpoint.get(this.endpoint()),delay=Math.max(0,(retry?.nextAttemptAt||0)-Date.now());if(!delay)return;await new Promise<void>(resolve=>{this.delayTimer=setTimeout(()=>{this.delayTimer=null;resolve()},delay)});if(this.stopped)throw new Error("WHIP publisher stopped")}
 private fail(message:string,stream:MediaStream|null){nextBackoff(this.endpoint());this.onState({status:"failed",stream,error:message})}
 async start(){if(!this.streamConfig.whipUrl||this.pc)return;this.stopped=false;this.onState({status:"connecting",stream:null});try{
  await this.waitForRetryWindow();if(this.stopped)return;
  const stream=await mediaDevices.getUserMedia({audio:false,video:{facingMode:this.capture.preferredFacing==="front"?"user":"environment",width:{ideal:this.capture.width},height:{ideal:this.capture.height},frameRate:{ideal:this.capture.fps,max:this.capture.fps}} as any});if(this.stopped){stream.getTracks().forEach(t=>t.stop());return}
  const pc=new RTCPeerConnection({iceServers:this.streamConfig.iceServers as any});this.stream=stream;this.pc=pc;stream.getTracks().forEach(track=>pc.addTrack(track,stream));
  pc.addEventListener("connectionstatechange",()=>{if(this.stopped)return;if(pc.connectionState==="connected"){resetBackoff(this.endpoint());this.onState({status:"online",stream})}else if(["failed","disconnected","closed"].includes(pc.connectionState))this.fail(`WebRTC ${pc.connectionState}`,stream)});
  const offer=await pc.createOffer();await pc.setLocalDescription(offer);await waitForIce(pc);const sdp=pc.localDescription?.sdp;if(!sdp)throw new Error("Unable to create WHIP offer");
  const response=await fetch(this.streamConfig.whipUrl,{method:"POST",headers:{"Content-Type":"application/sdp",...this.auth()},body:sdp});if(!response.ok)throw new Error(`NVR WHIP returned ${response.status}`);const answer=await response.text();this.resource=resourceUrl(this.streamConfig.whipUrl,response.headers.get("location"));await pc.setRemoteDescription({type:"answer",sdp:answer});resetBackoff(this.endpoint());this.onState({status:"online",stream});
 }catch(error){if(this.stopped)return;const message=error instanceof Error?error.message:String(error);this.fail(message,this.stream);await this.stop(false);throw error}}
 async stop(notify=true){this.stopped=true;if(this.delayTimer){clearTimeout(this.delayTimer);this.delayTimer=null}const resource=this.resource;this.resource=null;if(resource)try{void fetch(resource,{method:"DELETE",headers:this.auth()}).catch(()=>{})}catch{}try{this.pc?.close()}catch{}this.pc=null;try{this.stream?.getTracks().forEach(t=>t.stop())}catch{}this.stream=null;if(notify)this.onState({status:"idle",stream:null})}
}
