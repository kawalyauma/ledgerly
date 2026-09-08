import {mkdir,readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const code=String(process.argv[2]||"").replace(/\s/g,"");
if(!/^\d{6}$/.test(code)){
  console.error("Usage: printerly-pair <six-digit-code>");
  process.exit(2);
}

const configFile=process.env.PRINTERLY_CONFIG||"/etc/printerly/config.json";
const stateRoot=process.env.PRINTERLY_STATE_DIR||"/var/lib/printerly";
const stateFile=path.join(stateRoot,"state.json");
const config=JSON.parse(await readFile(configFile,"utf8"));
if(!config.ledgerlyBaseUrl)throw new Error("ledgerlyBaseUrl is missing from Printerly config");

const response=await fetch(`${config.ledgerlyBaseUrl.replace(/\/$/,"")}/api/v1/printerly/node/pair`,{
  method:"POST",
  headers:{"Content-Type":"application/json"},
  body:JSON.stringify({pairingCode:code,version:"1.1.0"})
});
const payload=await response.json().catch(()=>({}));
if(!response.ok)throw new Error(payload?.error?.message||payload?.message||`Pairing failed: HTTP ${response.status}`);

await mkdir(stateRoot,{recursive:true});
await writeFile(stateFile,JSON.stringify(payload.data,null,2),{mode:0o600});
console.log(`Paired ${payload.data.name||payload.data.nodeId}.`);
console.log("Start Printerly with: sudo systemctl enable --now printerly-node");
