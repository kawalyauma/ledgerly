// @ts-nocheck
import { Hono } from "hono";
import type { AppVariables, Env } from "../../../src/types";
import * as S from "./service";

export const securityCameraDeviceRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
const json=async(c:any)=>c.req.json<Record<string,any>>().catch(()=>({}));

securityCameraDeviceRoutes.post("/device/pair",async c=>{
  const body=await json(c);
  try{return c.json({data:await S.claimPairing(c.env.FINANCE_DB,body)},201)}
  catch(error){return c.json({error:{code:"CAMERA_PAIRING_FAILED",message:error instanceof Error?error.message:"Camera pairing failed"}},400)}
});

securityCameraDeviceRoutes.post("/device/:id/heartbeat",async c=>{
  const credential=c.req.header("x-camera-credential")||c.req.header("authorization")?.replace(/^Bearer\s+/i,"")||"";
  try{return c.json({data:await S.heartbeat(c.env.FINANCE_DB,c.req.param("id"),credential,await json(c))})}
  catch(error){return c.json({error:{code:"CAMERA_AUTH_FAILED",message:error instanceof Error?error.message:"Camera authentication failed"}},401)}
});
