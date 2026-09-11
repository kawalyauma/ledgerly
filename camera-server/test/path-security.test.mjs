import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {EventEngine} from "../src/events.mjs";

test("evidence resolver rejects traversal and symlink escapes",()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),"ledgerly-evidence-")),outside=fs.mkdtempSync(path.join(os.tmpdir(),"ledgerly-outside-"));try{const valid=path.join(root,"valid.jpg"),secret=path.join(outside,"secret.jpg");fs.writeFileSync(valid,"ok");fs.writeFileSync(secret,"secret");fs.symlinkSync(secret,path.join(root,"escape.jpg"));const engine=new EventEngine({catalog:{},cloud:{},evidenceRoot:root});assert.equal(engine.resolveEvidence("evidence:valid.jpg"),valid);assert.equal(engine.resolveEvidence("evidence:../secret.jpg"),null);assert.equal(engine.resolveEvidence("evidence:escape.jpg"),null)}finally{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true})}});
