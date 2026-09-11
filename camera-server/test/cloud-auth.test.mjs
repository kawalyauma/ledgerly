import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {CloudCoordinator} from "../src/cloud.mjs";

function digest(value){return crypto.createHash("sha256").update(value).digest("hex")}
function coordinator(){const root=fs.mkdtempSync(path.join(os.tmpdir(),"ledgerly-nvr-auth-")),cloud=new CloudCoordinator({apiUrl:"",stateFile:path.join(root,"state.json"),localBaseUrl:"http://127.0.0.1:8789",mediaBaseUrl:"http://127.0.0.1:8889",mediaPublicBaseUrl:"",storage:()=>({totalBytes:1,freeBytes:1})});return{root,cloud}}

test("publisher authorization is camera-specific and rejects unknown or revoked cameras",()=>{const{root,cloud}=coordinator();try{cloud.config={cameras:[{id:"cam_alpha",recordingEnabled:true,credentialHash:digest("secret-a")}],liveSessions:[]};assert.equal(cloud.authorizeMedia({action:"publish",path:"cam_alpha",token:"secret-a"}),true);assert.equal(cloud.authorizeMedia({action:"publish",path:"cam_alpha",token:"wrong"}),false);assert.equal(cloud.authorizeMedia({action:"publish",path:"cam_other_tenant",token:"secret-a"}),false);cloud.config.cameras=[];assert.equal(cloud.authorizeMedia({action:"publish",path:"cam_alpha",token:"secret-a"}),false)}finally{fs.rmSync(root,{recursive:true,force:true})}});

test("viewer grants are one-camera, one-token and expiry scoped",()=>{const{root,cloud}=coordinator();try{cloud.config={cameras:[],liveSessions:[{camera_id:"cam_alpha",signaling_key:"viewer-1",status:"connected",expires_at:new Date(Date.now()+60000).toISOString()},{camera_id:"cam_expired",signaling_key:"viewer-2",status:"connected",expires_at:new Date(Date.now()-1000).toISOString()}]};assert.equal(cloud.authorizeMedia({action:"read",path:"cam_alpha",token:"viewer-1"}),true);assert.equal(cloud.authorizeMedia({action:"read",path:"cam_beta",token:"viewer-1"}),false);assert.equal(cloud.authorizeMedia({action:"read",path:"cam_alpha",token:"wrong"}),false);assert.equal(cloud.authorizeMedia({action:"read",path:"cam_expired",token:"viewer-2"}),false)}finally{fs.rmSync(root,{recursive:true,force:true})}});
