// @ts-nocheck
import { Hono } from "hono";
import type { AppVariables, Env } from "../../../src/types";
import * as S from "./service";
import * as L from "./live-media";
import * as D from "./appliance-diagnostics";

export const securityCameraDeviceRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
const json=async(c:any)=>c.req.json<Record<string,any>>().catch(()=>({}));
function credential(c:any){
  const auth=c.req.header("Authorization")||"",device=/^Device\s+([^\.\s]+)\.([^\s]+)$/.exec(auth);
  if(device)return{id:device[1],credential:device[2]};
  const legacy=c.req.param("id"),secret=c.req.header("x-camera-credential")||auth.replace(/^Bearer\s+/i,"").trim();
  return{id:legacy||"",credential:secret};
}
async function run(c:any,fn:(id:string,secret:string)=>Promise<any>){const auth=credential(c);try{return c.json({data:await fn(auth.id,auth.credential)})}catch(error){return c.json({error:{code:"CAMERA_AUTH_FAILED",message:error instanceof Error?error.message:"Camera authentication failed"}},401)}}

securityCameraDeviceRoutes.post("/device/pair",async c=>{try{return c.json({data:await S.claimPairing(c.env.FINANCE_DB,await json(c))},201)}catch(error){return c.json({error:{code:"CAMERA_PAIRING_FAILED",message:error instanceof Error?error.message:"Camera pairing failed"}},400)}});
securityCameraDeviceRoutes.get("/device/health",c=>run(c,(id,secret)=>S.deviceHealth(c.env.FINANCE_DB,id,secret)));
securityCameraDeviceRoutes.get("/device/config",c=>run(c,(id,secret)=>S.deviceConfig(c.env.FINANCE_DB,id,secret)));
securityCameraDeviceRoutes.get("/device/stream-config",c=>run(c,(id,secret)=>L.deviceStreamConfig(c.env.FINANCE_DB,id,secret)));
securityCameraDeviceRoutes.post("/device/stream-state",async c=>{const auth=credential(c);try{return c.json({data:await L.updateDeviceStreamState(c.env.FINANCE_DB,auth.id,auth.credential,await json(c))})}catch(error){return c.json({error:{code:"CAMERA_STREAM_STATE_FAILED",message:error instanceof Error?error.message:"Camera stream state failed"}},400)}});
securityCameraDeviceRoutes.post("/device/diagnostics",async c=>{const auth=credential(c);try{return c.json({data:await D.updateApplianceDiagnostics(c.env.FINANCE_DB,auth.id,auth.credential,await json(c))})}catch(error){return c.json({error:{code:"CAMERA_AUTH_FAILED",message:error instanceof Error?error.message:"Camera authentication failed"}},401)}});
securityCameraDeviceRoutes.post("/device/heartbeat",async c=>{const auth=credential(c);try{return c.json({data:await S.heartbeat(c.env.FINANCE_DB,auth.id,auth.credential,await json(c))})}catch(error){return c.json({error:{code:"CAMERA_AUTH_FAILED",message:error instanceof Error?error.message:"Camera authentication failed"}},401)}});
securityCameraDeviceRoutes.post("/device/:id/heartbeat",async c=>{const auth=credential(c);try{return c.json({data:await S.heartbeat(c.env.FINANCE_DB,auth.id,auth.credential,await json(c))})}catch(error){return c.json({error:{code:"CAMERA_AUTH_FAILED",message:error instanceof Error?error.message:"Camera authentication failed"}},401)}});
