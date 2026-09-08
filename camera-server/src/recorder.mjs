import fs from "node:fs";
import path from "node:path";
import {spawn} from "node:child_process";

export class RecorderManager{
  constructor({storageRoot,ffmpeg="ffmpeg",segmentSeconds=300}){this.storageRoot=storageRoot;this.ffmpeg=ffmpeg;this.segmentSeconds=Math.max(30,Number(segmentSeconds)||300);this.active=new Map()}
  start(cameraId,inputUrl){
    if(this.active.has(cameraId))return this.status(cameraId);
    if(!/^[A-Za-z0-9_-]{3,100}$/.test(cameraId))throw new Error("Invalid camera id");
    if(!/^(rtsp|rtsps|srt|http|https):\/\//i.test(String(inputUrl||"")))throw new Error("Unsupported camera input URL");
    const dir=path.join(this.storageRoot,cameraId);fs.mkdirSync(dir,{recursive:true});
    const output=path.join(dir,"%Y-%m-%d_%H-%M-%S.mp4"),args=["-hide_banner","-loglevel","warning"];
    if(/^rtsps?:/i.test(inputUrl))args.push("-rtsp_transport","tcp");
    args.push("-i",inputUrl,"-map","0:v:0","-an","-c:v","copy","-f","segment","-segment_time",String(this.segmentSeconds),"-segment_atclocktime","1","-reset_timestamps","1","-strftime","1",output);
    const child=spawn(this.ffmpeg,args,{stdio:["ignore","ignore","pipe"]}),record={cameraId,child,pid:child.pid||null,status:"recording",startedAt:new Date().toISOString(),lastError:null,exitCode:null};
    this.active.set(cameraId,record);child.stderr.setEncoding("utf8");child.stderr.on("data",chunk=>{const text=String(chunk).trim();if(text)record.lastError=text.slice(-1200)});child.on("error",error=>{record.lastError=error.message;record.status="failed";this.active.delete(cameraId)});child.on("exit",code=>{record.exitCode=code;record.status=code===0?"stopped":"failed";this.active.delete(cameraId)});return this.status(cameraId)
  }
  stop(cameraId){const r=this.active.get(cameraId);if(!r)return{cameraId,status:"stopped"};r.status="stopping";r.child.kill("SIGTERM");setTimeout(()=>{if(this.active.has(cameraId))r.child.kill("SIGKILL")},5000).unref();return{cameraId,status:"stopping"}}
  status(cameraId){const r=this.active.get(cameraId);return r?{cameraId:r.cameraId,status:r.status,pid:r.pid,startedAt:r.startedAt,lastError:r.lastError}: {cameraId,status:"stopped"}}
  list(){return[...this.active.keys()].map(id=>this.status(id))}
  stopAll(){for(const id of this.active.keys())this.stop(id)}
}
