import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import {spawnSync} from "node:child_process";

function tcp(host,port,timeout=2500){return new Promise(resolve=>{const s=net.createConnection({host,port});let done=false;const finish=(ok,error)=>{if(done)return;done=true;s.destroy();resolve({ok,error})};s.setTimeout(timeout);s.once("connect",()=>finish(true));s.once("timeout",()=>finish(false,"timeout"));s.once("error",e=>finish(false,e.message))})}
function writable(root){try{fs.mkdirSync(root,{recursive:true});const file=path.join(root,`.ledgerly-health-${process.pid}`);fs.writeFileSync(file,"ok");fs.rmSync(file);return{ok:true}}catch(error){return{ok:false,error:error instanceof Error?error.message:String(error)}}}
export async function validateNvr({pool,catalog,cloud,ffmpeg="ffmpeg",mediaBaseUrl}){
 const results=[];
 const ff=spawnSync(ffmpeg,["-version"],{encoding:"utf8",timeout:5000});results.push({checkType:"ffmpeg",status:ff.status===0?"passed":"failed",message:ff.status===0?String(ff.stdout||"").split("\n")[0]:String(ff.stderr||"FFmpeg unavailable").slice(0,400),details:{binary:ffmpeg}});
 for(const volume of pool.report()){const x=writable(volume.path);results.push({checkType:"storage_write",status:x.ok?"passed":"failed",message:x.ok?`${volume.label} is writable`:`${volume.label} is not writable: ${x.error}`,details:{path:volume.path,key:volume.key,freeBytes:volume.freeBytes,totalBytes:volume.totalBytes}})}
 let mediaHost="127.0.0.1",mediaPort=8889;try{const u=new URL(mediaBaseUrl);mediaHost=u.hostname;mediaPort=Number(u.port||(/https/.test(u.protocol)?443:80))}catch{}const media=await tcp(mediaHost,mediaPort);results.push({checkType:"mediamtx_webrtc",status:media.ok?"passed":"failed",message:media.ok?`MediaMTX reachable on ${mediaHost}:${mediaPort}`:`MediaMTX unavailable on ${mediaHost}:${mediaPort}: ${media.error}`,details:{host:mediaHost,port:mediaPort}});
 const rtsp=await tcp("127.0.0.1",8554);results.push({checkType:"mediamtx_rtsp",status:rtsp.ok?"passed":"warning",message:rtsp.ok?"MediaMTX RTSP listener reachable":`RTSP listener unavailable: ${rtsp.error}`,details:{host:"127.0.0.1",port:8554}});
 for(const camera of cloud.config?.cameras||[]){const rows=catalog.all(camera.id),last=rows.at(-1),age=last?Math.round((Date.now()-Date.parse(last.modifiedAt))/1000):null,status=!camera.recordingEnabled?"passed":last&&age!=null&&age<600?"passed":last?"warning":"warning";results.push({checkType:"camera_recording_freshness",cameraId:camera.id,status,message:!camera.recordingEnabled?`${camera.name||camera.id} recording intentionally paused`:last?`${camera.name||camera.id} newest local segment is ${age}s old`:`${camera.name||camera.id} has no local recording segments`,details:{lastRecordingAt:last?.modifiedAt||null,ageSeconds:age,recordingEnabled:Boolean(camera.recordingEnabled)}})}
 for(const result of results)await cloud.reportValidation(result).catch(error=>console.error("[camera-validation] sync",result.checkType,error.message));return results
}
