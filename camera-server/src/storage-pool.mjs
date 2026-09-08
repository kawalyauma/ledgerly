import fs from "node:fs";
import path from "node:path";

function stat(root){try{fs.mkdirSync(root,{recursive:true});const s=fs.statfsSync(root),totalBytes=Number(s.blocks)*Number(s.bsize),freeBytes=Number(s.bavail)*Number(s.bsize);return{totalBytes,freeBytes,usedBytes:totalBytes-freeBytes,usedPercent:totalBytes?Math.round((totalBytes-freeBytes)*10000/totalBytes)/100:0,status:"online"}}catch(error){return{totalBytes:0,freeBytes:0,usedBytes:0,usedPercent:100,status:"offline",error:error instanceof Error?error.message:String(error)}}}
export class StoragePool{
 constructor(primaryRoot,rawVolumes=""){const candidates=[primaryRoot,...String(rawVolumes||"").split(";").map(x=>x.trim()).filter(Boolean)].map(x=>path.resolve(x));const unique=[...new Set(candidates)];this.volumes=unique.map((root,i)=>({key:`v${i}`,label:i===0?"Primary recordings":`Archive volume ${i+1}`,path:root,priority:i===0?10:20+i}));for(const v of this.volumes)run(()=>fs.mkdirSync(v.path,{recursive:true}))}
 roots(){return this.volumes.map(v=>v.path)}
 report(){return this.volumes.map(v=>({...v,...stat(v.path)}))}
 summary(){const rows=this.report(),totalBytes=rows.reduce((n,x)=>n+x.totalBytes,0),freeBytes=rows.reduce((n,x)=>n+x.freeBytes,0);return{root:this.volumes[0].path,totalBytes,freeBytes,usedBytes:totalBytes-freeBytes,usedPercent:totalBytes?Math.round((totalBytes-freeBytes)*10000/totalBytes)/100:0,volumes:rows}}
 chooseWriteRoot(){const online=this.report().filter(x=>x.status==="online"&&x.freeBytes>64*1024*1024);if(!online.length)return this.volumes[0].path;online.sort((a,b)=>(a.usedPercent-b.usedPercent)||(a.priority-b.priority));return online[0].path}
 keyForRoot(root){return this.volumes.find(v=>v.path===path.resolve(root))?.key||"v0"}
 rootForKey(key){return this.volumes.find(v=>v.key===key)?.path||null}
 alerts(){const rows=this.report(),out=[];for(const v of rows){if(v.status!=="online")out.push({id:`volume:${v.key}:offline`,type:"storage_volume_offline",severity:"critical",message:`Storage volume ${v.label} is offline`,details:{volumeKey:v.key,path:v.path,error:v.error}});else if(v.freeBytes<5*1024*1024*1024||v.usedPercent>=95)out.push({id:`volume:${v.key}:critical`,type:"storage_critical",severity:"critical",message:`${v.label} is critically low on space`,details:{volumeKey:v.key,path:v.path,freeBytes:v.freeBytes,usedPercent:v.usedPercent}});else if(v.usedPercent>=85)out.push({id:`volume:${v.key}:warning`,type:"storage_low",severity:"warning",message:`${v.label} is running low on space`,details:{volumeKey:v.key,path:v.path,freeBytes:v.freeBytes,usedPercent:v.usedPercent}})}return out}
}
function run(fn){try{return fn()}catch{return undefined}}
