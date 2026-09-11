import fs from "node:fs";
import path from "node:path";

function safeRow(row){return{id:String(row.id||""),cameraId:String(row.cameraId||""),name:String(row.name||""),volumeKey:String(row.volumeKey||""),relativePath:String(row.relativePath||""),startedAt:String(row.startedAt||""),modifiedAt:String(row.modifiedAt||row.startedAt||""),sizeBytes:Math.max(0,Number(row.sizeBytes)||0),protected:Boolean(row.protected)}}
function atomicWrite(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=`${file}.${process.pid}.${Date.now()}.tmp`;fs.writeFileSync(tmp,JSON.stringify(value,null,2),{mode:0o600});fs.renameSync(tmp,file)}

export class CatalogReconciler{
 constructor({stateFile}){this.stateFile=path.resolve(stateFile||"./camera-catalog-state.json");this.state={version:1,rows:[],updatedAt:null};this.load()}
 load(){try{const parsed=JSON.parse(fs.readFileSync(this.stateFile,"utf8"));if(parsed?.version===1&&Array.isArray(parsed.rows))this.state={version:1,rows:parsed.rows.map(safeRow),updatedAt:parsed.updatedAt||null}}catch{}}
 reconcile({rows=[],monitoredCameraIds=[],onlineVolumeKeys=[]}={}){const current=(rows||[]).map(safeRow).filter(r=>r.id&&r.cameraId&&r.relativePath&&r.volumeKey),monitored=new Set((monitoredCameraIds||[]).map(String)),online=new Set((onlineVolumeKeys||[]).map(String)),currentById=new Map(current.map(r=>[r.id,r])),next=new Map(current.map(r=>[r.id,r])),deleted=[];for(const previous of this.state.rows||[]){if(currentById.has(previous.id))continue;if(!monitored.has(previous.cameraId)){next.set(previous.id,previous);continue}if(!online.has(previous.volumeKey)){next.set(previous.id,previous);continue}deleted.push({...previous,status:"deleted",endedAt:previous.modifiedAt||previous.startedAt})}this.state={version:1,rows:[...next.values()].sort((a,b)=>a.cameraId.localeCompare(b.cameraId)||a.startedAt.localeCompare(b.startedAt)||a.id.localeCompare(b.id)),updatedAt:new Date().toISOString()};atomicWrite(this.stateFile,this.state);return{deleted,tracked:this.state.rows.length,updatedAt:this.state.updatedAt}}
 snapshot(){return{version:this.state.version,rows:this.state.rows.map(x=>({...x})),updatedAt:this.state.updatedAt}}
}
