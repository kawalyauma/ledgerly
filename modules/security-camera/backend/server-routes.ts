// @ts-nocheck
import { Hono } from "hono";
import type { AppVariables, Env } from "../../../src/types";
import * as S from "./service";
export const securityCameraServerRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
const json=async(c:any)=>c.req.json<Record<string,any>>().catch(()=>({}));
function auth(c:any){const raw=c.req.header("Authorization")||"",m=/^Server\s+([^\.\s]+)\.([^\s]+)$/.exec(raw);return{id:m?.[1]||"",credential:m?.[2]||""}}
async function run(c:any,fn:(id:string,secret:string)=>Promise<any>){const a=auth(c);try{return c.json({data:await fn(a.id,a.credential)})}catch(error){return c.json({error:{code:"CAMERA_SERVER_AUTH_FAILED",message:error instanceof Error?error.message:"Camera server authentication failed"}},401)}}
securityCameraServerRoutes.post("/server/pair",async c=>{try{return c.json({data:await S.claimServerPairing(c.env.FINANCE_DB,await json(c))},201)}catch(error){return c.json({error:{code:"CAMERA_SERVER_PAIRING_FAILED",message:error instanceof Error?error.message:"Camera server pairing failed"}},400)}});
securityCameraServerRoutes.post("/server/heartbeat",async c=>{const a=auth(c);try{return c.json({data:await S.serverHeartbeat(c.env.FINANCE_DB,a.id,a.credential,await json(c))})}catch(error){return c.json({error:{code:"CAMERA_SERVER_AUTH_FAILED",message:error instanceof Error?error.message:"Camera server authentication failed"}},401)}});
securityCameraServerRoutes.get("/server/config",c=>run(c,(id,secret)=>S.serverConfig(c.env.FINANCE_DB,id,secret)));
securityCameraServerRoutes.post("/server/recordings/sync",async c=>{const a=auth(c);try{return c.json({data:await S.syncRecordings(c.env.FINANCE_DB,a.id,a.credential,await json(c))})}catch(error){return c.json({error:{code:"CAMERA_SERVER_SYNC_FAILED",message:error instanceof Error?error.message:"Recording sync failed"}},400)}});
securityCameraServerRoutes.post("/server/live/update",async c=>{const a=auth(c);try{return c.json({data:await S.updateLiveFromServer(c.env.FINANCE_DB,a.id,a.credential,await json(c))})}catch(error){return c.json({error:{code:"CAMERA_LIVE_SIGNALING_FAILED",message:error instanceof Error?error.message:"Live signaling update failed"}},400)}});
