import fs from "node:fs";
import path from "node:path";

const VIDEO=/^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})\.mp4$/;
function safeId(value){if(!/^[A-Za-z0-9_-]{3,100}$/.test(value))throw new Error("Invalid camera id");return value}
function segmentTime(name){const m=VIDEO.exec(name);if(!m)return null;const[,date,h,mn,s]=m;const d=new Date(`${date}T${h}:${mn}:${s}`);return Number.isNaN(d.getTime())?null:d}
function walkCamera(root,cameraId){const dir=path.join(root,safeId(cameraId));if(!fs.existsSync(dir))return[];return fs.readdirSync(dir,{withFileTypes:true}).filter(x=>x.isFile()&&VIDEO.test(x.name)).map(x=>{const file=path.join(dir,x.name),st=fs.statSync(file),started=segmentTime(x.name);return{id:`${cameraId}:${x.name}`,cameraId,name:x.name,path:file,relativePath:path.relative(root,file),startedAt:(started||st.birthtime).toISOString(),modifiedAt:st.mtime.toISOString(),sizeBytes:st.size,protected:fs.existsSync(`${file}.protected`)}}).sort((a,b)=>a.startedAt.localeCompare(b.startedAt))}

export class RecordingCatalog{
 constructor({storageRoot,retentionDays=30,maxStoragePercent=90}){this.storageRoot=storageRoot;this.retentionDays=Math.max(1,Number(retentionDays)||30);this.maxStoragePercent=Math.min(99,Math.max(50,Number(maxStoragePercent)||90))}
 cameras(){if(!fs.existsSync(this.storageRoot))return[];return fs.readdirSync(this.storageRoot,{withFileTypes:true}).filter(x=>x.isDirectory()&&/^[A-Za-z0-9_-]{3,100}$/.test(x.name)).map(x=>x.name)}
 list(cameraId,{from,to,limit=500}={}){let rows=walkCamera(this.storageRoot,cameraId);if(from){const t=new Date(from).getTime();if(!Number.isNaN(t))rows=rows.filter(x=>new Date(x.startedAt).getTime()>=t)}if(to){const t=new Date(to).getTime();if(!Number.isNaN(t))rows=rows.filter(x=>new Date(x.startedAt).getTime()<=t)}return rows.slice(-Math.min(5000,Math.max(1,Number(limit)||500)))}
 summary(cameraId){const rows=walkCamera(this.storageRoot,cameraId),bytes=rows.reduce((n,x)=>n+x.sizeBytes,0);return{cameraId,segments:rows.length,sizeBytes:bytes,oldestAt:rows[0]?.startedAt||null,newestAt:rows.at(-1)?.startedAt||null,protectedSegments:rows.filter(x=>x.protected).length}}
 protect(cameraId,name,enabled=true){safeId(cameraId);if(!VIDEO.test(name))throw new Error("Invalid segment name");const file=path.join(this.storageRoot,cameraId,name);if(!fs.existsSync(file))throw new Error("Recording segment not found");const marker=`${file}.protected`;if(enabled)fs.writeFileSync(marker,JSON.stringify({protectedAt:new Date().toISOString()}));else if(fs.existsSync(marker))fs.rmSync(marker);return{cameraId,name,protected:enabled}}
 cleanup(){const now=Date.now(),cutoff=now-this.retentionDays*86400000,candidates=[];for(const cameraId of this.cameras())for(const row of walkCamera(this.storageRoot,cameraId))if(!row.protected)candidates.push(row);candidates.sort((a,b)=>a.startedAt.localeCompare(b.startedAt));let deleted=0,freedBytes=0;for(const row of candidates){const started=new Date(row.startedAt).getTime();if(started<cutoff){try{fs.rmSync(row.path);deleted++;freedBytes+=row.sizeBytes}catch{}}}
  let st=fs.statfsSync(this.storageRoot),usedPercent=100-(Number(st.bavail)*100/Number(st.blocks));for(const row of candidates){if(usedPercent<=this.maxStoragePercent)break;if(!fs.existsSync(row.path))continue;try{fs.rmSync(row.path);deleted++;freedBytes+=row.sizeBytes;st=fs.statfsSync(this.storageRoot);usedPercent=100-(Number(st.bavail)*100/Number(st.blocks))}catch{}}
  return{deleted,freedBytes,retentionDays:this.retentionDays,maxStoragePercent:this.maxStoragePercent,completedAt:new Date().toISOString()}}
}
