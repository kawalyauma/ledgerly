import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdir,readFile,writeFile,rm} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {buildLpArgs,extensionForMime,parseLpRequestId,sha256} from "./lib.mjs";

const exec=promisify(execFile);
const configFile=process.env.PRINTERLY_CONFIG||"/etc/printerly/config.json";
const stateRoot=process.env.PRINTERLY_STATE_DIR||"/var/lib/printerly";
const stateFile=path.join(stateRoot,"state.json");
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let config,state={};

async function load(){
  config=JSON.parse(await readFile(configFile,"utf8"));
  if(!config.ledgerlyBaseUrl)throw new Error("ledgerlyBaseUrl is missing from Printerly config");
  await mkdir(config.workDir||path.join(stateRoot,"jobs"),{recursive:true});
  await mkdir(stateRoot,{recursive:true});
  state=JSON.parse(await readFile(stateFile,"utf8").catch(()=>"{}"));
  if(!state.nodeToken)throw new Error("Printerly Node is not paired. Run: sudo printerly-pair <six-digit-code>");
}

async function save(){
  await mkdir(stateRoot,{recursive:true});
  await writeFile(stateFile,JSON.stringify(state,null,2),{mode:0o600});
}

function baseUrl(){
  return config.ledgerlyBaseUrl.replace(/\/$/,"");
}

async function request(route,body={}){
  const response=await fetch(`${baseUrl()}/api/v1/printerly${route}`,{
    method:"POST",
    headers:{"Content-Type":"application/json",Authorization:`Bearer ${state.nodeToken}`},
    body:JSON.stringify(body)
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(payload?.error?.message||payload?.message||`${route}: HTTP ${response.status}`);
  return payload.data;
}

async function downloadDocument(job){
  const response=await fetch(`${baseUrl()}/api/v1/printerly/node/jobs/${encodeURIComponent(job.id)}/document`,{
    headers:{Authorization:`Bearer ${state.nodeToken}`,"X-Printerly-Claim":job.claim_token}
  });
  if(!response.ok){
    const payload=await response.json().catch(()=>({}));
    throw new Error(payload?.error?.message||`Document download failed: HTTP ${response.status}`);
  }
  const buffer=Buffer.from(await response.arrayBuffer());
  const expected=String(response.headers.get("X-Printerly-SHA256")||job.document_sha256||"").toLowerCase();
  const actual=sha256(buffer);
  if(expected&&actual!==expected)throw new Error(`Document checksum mismatch (expected ${expected}, got ${actual})`);
  return buffer;
}

async function printers(){
  try{
    const {stdout}=await exec("lpstat",["-p"]);
    return stdout.split("\n").filter(Boolean).map(line=>{
      const match=line.match(/^printer\s+(\S+)\s+(.*)$/);
      if(!match)return null;
      return {id:match[1],name:match[1],systemName:match[1],status:/disabled/i.test(match[2])?"offline":"ready",capabilities:{cups:true}};
    }).filter(Boolean);
  }catch{
    return [];
  }
}

async function heartbeat(){
  try{await request("/node/heartbeat",{version:"1.1.0",printers:await printers()})}
  catch(error){console.error("heartbeat",error.message)}
}

async function status(job,next,errorMessage="",cupsJobId=null){
  return request(`/node/jobs/${job.id}/status`,{status:next,claimToken:job.claim_token,errorMessage,cupsJobId});
}

async function cupsState(cupsJobId){
  try{
    const {stdout}=await exec("lpstat",["-W","not-completed","-o",cupsJobId]);
    if(stdout.includes(cupsJobId))return "active";
  }catch{}
  try{
    const {stdout}=await exec("lpstat",["-W","completed","-o",cupsJobId]);
    if(stdout.includes(cupsJobId))return "completed";
  }catch{}
  return "unknown";
}

async function waitForCupsCompletion(cupsJobId){
  const timeout=Math.max(60_000,Number(config.printCompletionTimeoutMs)||30*60_000);
  const deadline=Date.now()+timeout;
  let unknownChecks=0;
  while(Date.now()<deadline){
    const current=await cupsState(cupsJobId);
    if(current==="completed")return;
    if(current==="unknown"){
      unknownChecks++;
      if(unknownChecks>=4)throw new Error(`CUPS no longer reports ${cupsJobId}; print completion could not be confirmed`);
    }else unknownChecks=0;
    await sleep(Math.max(1500,Number(config.cupsStatusIntervalMs)||3000));
  }
  throw new Error(`Timed out waiting for CUPS job ${cupsJobId} to finish`);
}

async function processJob(job,{recovering=false}={}){
  const dir=config.workDir||path.join(stateRoot,"jobs");
  const file=path.join(dir,`${job.id}${extensionForMime(job.document_mime)}`);
  try{
    if(!recovering){
      state.activeJob={job,stage:"claimed",cupsJobId:null};
      await save();
    }

    await status(job,"downloading");
    state.activeJob={job,stage:"downloading",cupsJobId:null};
    await save();

    const document=await downloadDocument(job);
    await writeFile(file,document,{mode:0o600});

    await status(job,"spooling");
    state.activeJob={job,stage:"spooling",cupsJobId:null};
    await save();

    const {stdout}=await exec("lp",buildLpArgs(job,file));
    const cupsJobId=parseLpRequestId(stdout);
    if(!cupsJobId)throw new Error(`CUPS accepted no identifiable job: ${stdout.trim()||"empty lp response"}`);

    state.activeJob={job,stage:"printing",cupsJobId};
    await save();
    await status(job,"printing","",cupsJobId);
    console.log(`Printing ${job.id} as CUPS job ${cupsJobId}`);

    await waitForCupsCompletion(cupsJobId);
    await status(job,"completed","",cupsJobId);
    console.log(`Completed Printerly job ${job.id}`);
    delete state.activeJob;
    await save();
  }catch(error){
    console.error(`job ${job.id}`,error);
    try{await status(job,"failed",String(error.message||error),state.activeJob?.cupsJobId||null)}catch(statusError){console.error("status",statusError.message)}
    delete state.activeJob;
    await save().catch(()=>{});
  }finally{
    await rm(file,{force:true}).catch(()=>{});
  }
}

async function recoverActiveJob(){
  const active=state.activeJob;
  if(!active?.job)return;
  const {job,stage,cupsJobId}=active;
  console.warn(`Recovering Printerly job ${job.id} from ${stage}`);
  if(stage==="claimed"||stage==="downloading"){
    await processJob(job,{recovering:true});
    return;
  }
  if(cupsJobId){
    try{
      await status(job,"printing","",cupsJobId);
      await waitForCupsCompletion(cupsJobId);
      await status(job,"completed","",cupsJobId);
    }catch(error){
      console.error(`recovery ${job.id}`,error);
      try{await status(job,"failed",`Recovery could not confirm the prior CUPS job: ${String(error.message||error)}`,cupsJobId)}catch{}
    }
  }else{
    // We may have crashed immediately around `lp`. Reprinting automatically would
    // risk duplicate examination papers, reports, receipts or payroll documents.
    try{await status(job,"failed","Node restarted during CUPS submission. Printerly intentionally did not reprint because the previous submission may already have reached the printer.")}catch{}
  }
  delete state.activeJob;
  await save();
}

async function loop(){
  await load();
  await recoverActiveJob();
  await heartbeat();
  setInterval(()=>void heartbeat(),Math.max(5000,Number(config.heartbeatIntervalMs)||15000));
  for(;;){
    try{
      const available=await printers();
      const names=available.filter(item=>item.status==="ready").map(item=>item.systemName);
      if(!names.length){await sleep(Math.max(5000,Number(config.pollIntervalMs)||3000));continue}
      const job=await request("/node/jobs/claim",{printerSystemNames:names});
      if(job)await processJob(job);
      else await sleep(Math.max(1000,Number(config.pollIntervalMs)||3000));
    }catch(error){
      console.error("poll",error.message);
      await sleep(Math.max(5000,Number(config.pollIntervalMs)||3000));
    }
  }
}

loop().catch(error=>{console.error(error);process.exit(1)});
