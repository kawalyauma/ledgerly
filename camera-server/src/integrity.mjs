import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
function roots(){const primary=path.resolve(process.env.CAMERA_STORAGE_ROOT||"./camera-storage"),extra=String(process.env.CAMERA_STORAGE_VOLUMES||"").split(";").map(x=>x.trim()).filter(Boolean).map(x=>path.resolve(x));return[primary,...extra]}
function resolveLocal(localPath){const raw=String(localPath||""),m=/^v(\d+):(.*)$/.exec(raw),rs=roots();if(m){const root=rs[Number(m[1])],rel=m[2];if(root){const full=path.resolve(root,rel);if(full.startsWith(root+path.sep)&&fs.existsSync(full))return full}}for(const root of rs){const full=path.resolve(root,raw);if(full.startsWith(root+path.sep)&&fs.existsSync(full))return full}return null}
function shaFile(file){return new Promise((resolve,reject)=>{const h=crypto.createHash("sha256"),s=fs.createReadStream(file);s.on("data",d=>h.update(d));s.on("error",reject);s.on("end",()=>resolve(h.digest("hex")))})}
function chain(previous,content,cameraId,startedAt){return crypto.createHash("sha256").update(`${previous||"GENESIS"}|${content}|${cameraId}|${startedAt}`).digest("hex")}
export class RecordingIntegrity{
 constructor({stateFile}){this.stateFile=path.resolve(stateFile||"./camera-integrity-state.json");this.state={lastChainByCamera:{}};this.load()}
 load(){try{this.state={...this.state,...JSON.parse(fs.readFileSync(this.stateFile,"utf8"))}}catch{}}
 save(){try{fs.mkdirSync(path.dirname(this.stateFile),{recursive:true});fs.writeFileSync(this.stateFile,JSON.stringify(this.state,null,2),{mode:0o600})}catch{}}
 async enrich(row){const file=resolveLocal(row.localPath);if(!file)return{...row,integrityStatus:"unverified"};const st=fs.statSync(file),side=`${file}.integrity.json`;let prior=null;try{prior=JSON.parse(fs.readFileSync(side,"utf8"))}catch{}const signature=`${st.size}:${st.mtimeMs}`;const contentSha256=prior?.signature===signature&&prior?.contentSha256?prior.contentSha256:await shaFile(file);const previousChainSha256=prior?.previousChainSha256||this.state.lastChainByCamera?.[row.cameraId]||null,chainSha256=chain(previousChainSha256,contentSha256,row.cameraId,row.startedAt),integrityComputedAt=new Date().toISOString(),payload={version:1,signature,cameraId:row.cameraId,recordingId:row.id,contentSha256,previousChainSha256,chainSha256,integrityComputedAt};fs.writeFileSync(side,JSON.stringify(payload,null,2),{mode:0o600});this.state.lastChainByCamera[row.cameraId]=chainSha256;this.save();return{...row,contentSha256,previousChainSha256,chainSha256,integrityComputedAt,integrityStatus:"computed"}}
 async enrichBatch(rows){const out=[];for(const row of [...rows].sort((a,b)=>String(a.cameraId).localeCompare(String(b.cameraId))||String(a.startedAt).localeCompare(String(b.startedAt))))out.push(await this.enrich(row));return out}
}
