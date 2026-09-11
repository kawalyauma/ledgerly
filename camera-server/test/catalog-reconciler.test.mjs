import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {CatalogReconciler} from "../src/catalog-reconciler.mjs";

function temp(){return fs.mkdtempSync(path.join(os.tmpdir(),"ledgerly-nvr-reconcile-"))}
function row(id="v0:cam_alpha:one.mp4",volumeKey="v0"){return{id,cameraId:"cam_alpha",name:"one.mp4",volumeKey,relativePath:`${volumeKey}:cam_alpha/one.mp4`,startedAt:"2026-01-01T00:00:00.000Z",modifiedAt:"2026-01-01T00:05:00.000Z",sizeBytes:1234,protected:false}}

test("missing recording on an online volume produces one durable tombstone",()=>{const root=temp();try{const stateFile=path.join(root,"catalog.json"),first=new CatalogReconciler({stateFile});assert.equal(first.reconcile({rows:[row()],monitoredCameraIds:["cam_alpha"],onlineVolumeKeys:["v0"]}).deleted.length,0);const afterRestart=new CatalogReconciler({stateFile}),result=afterRestart.reconcile({rows:[],monitoredCameraIds:["cam_alpha"],onlineVolumeKeys:["v0"]});assert.equal(result.deleted.length,1);assert.equal(result.deleted[0].status,"deleted");assert.equal(result.deleted[0].relativePath,"v0:cam_alpha/one.mp4");const onceMore=afterRestart.reconcile({rows:[],monitoredCameraIds:["cam_alpha"],onlineVolumeKeys:["v0"]});assert.equal(onceMore.deleted.length,0)}finally{fs.rmSync(root,{recursive:true,force:true})}});

test("offline volume never turns missing media into deletion",()=>{const root=temp();try{const stateFile=path.join(root,"catalog.json"),r=new CatalogReconciler({stateFile});r.reconcile({rows:[row()],monitoredCameraIds:["cam_alpha"],onlineVolumeKeys:["v0"]});const offline=r.reconcile({rows:[],monitoredCameraIds:["cam_alpha"],onlineVolumeKeys:[]});assert.equal(offline.deleted.length,0);assert.equal(offline.tracked,1);const recovered=r.reconcile({rows:[],monitoredCameraIds:["cam_alpha"],onlineVolumeKeys:["v0"]});assert.equal(recovered.deleted.length,1)}finally{fs.rmSync(root,{recursive:true,force:true})}});

test("unassigned camera history is retained instead of being tombstoned",()=>{const root=temp();try{const stateFile=path.join(root,"catalog.json"),r=new CatalogReconciler({stateFile});r.reconcile({rows:[row()],monitoredCameraIds:["cam_alpha"],onlineVolumeKeys:["v0"]});const result=r.reconcile({rows:[],monitoredCameraIds:[],onlineVolumeKeys:["v0"]});assert.equal(result.deleted.length,0);assert.equal(result.tracked,1)}finally{fs.rmSync(root,{recursive:true,force:true})}});
