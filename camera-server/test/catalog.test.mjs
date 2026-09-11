import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {RecordingCatalog} from "../src/catalog.mjs";

function temp(){return fs.mkdtempSync(path.join(os.tmpdir(),"ledgerly-nvr-catalog-"))}
function segment(root,camera,name="2020-01-01_00-00-00.mp4",mtime=new Date("2020-01-01T00:05:00Z")){const dir=path.join(root,camera);fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,name);fs.writeFileSync(file,"segment");fs.utimesSync(file,mtime,mtime);return file}

test("catalog reconstructs recordings and rejects traversal including symlink escapes",()=>{const root=temp(),outside=temp();try{const file=segment(root,"cam_alpha"),catalog=new RecordingCatalog({storageRoot:root,minSegmentAgeMs:60000});const rows=catalog.list("cam_alpha");assert.equal(rows.length,1);assert.equal(rows[0].cameraId,"cam_alpha");assert.equal(catalog.resolve(rows[0].relativePath),file);assert.equal(catalog.resolve("../../etc/passwd"),null);assert.equal(catalog.resolve("v0:../../etc/passwd"),null);const secret=path.join(outside,"secret.mp4");fs.writeFileSync(secret,"outside");fs.symlinkSync(secret,path.join(root,"cam_alpha","escape.mp4"));assert.equal(catalog.resolve("v0:cam_alpha/escape.mp4"),null)}finally{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true})}});

test("retention deletes old complete segments but not a currently-written segment",()=>{const root=temp();try{segment(root,"cam_alpha","2020-01-01_00-00-00.mp4",new Date("2020-01-01T00:05:00Z"));const active=segment(root,"cam_alpha","2020-01-02_00-00-00.mp4",new Date()),catalog=new RecordingCatalog({storageRoot:root,retentionDays:1,maxStoragePercent:99,minSegmentAgeMs:60000}),result=catalog.cleanup();assert.equal(result.deleted,1);assert.equal(result.activeSegmentsSkipped,1);assert.equal(fs.existsSync(active),true);assert.equal(catalog.list("cam_alpha").length,1)}finally{fs.rmSync(root,{recursive:true,force:true})}});

test("protected and legal-hold segments survive retention",()=>{const root=temp();try{const protectedFile=segment(root,"cam_alpha","2020-01-01_00-00-00.mp4"),heldFile=segment(root,"cam_alpha","2020-01-02_00-00-00.mp4"),catalog=new RecordingCatalog({storageRoot:root,retentionDays:1,minSegmentAgeMs:60000});fs.writeFileSync(`${protectedFile}.protected`,"{}");const holds=[{camera_id:"cam_alpha",from_at:"2019-12-31T00:00:00Z",to_at:"2020-01-03T00:00:00Z"}],result=catalog.cleanup({},holds);assert.equal(result.deleted,0);assert.equal(result.heldSegments,1);assert.equal(fs.existsSync(protectedFile),true);assert.equal(fs.existsSync(heldFile),true)}finally{fs.rmSync(root,{recursive:true,force:true})}});
