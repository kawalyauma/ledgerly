// @ts-nocheck
import { Hono } from "hono";
import type { AppVariables, Env } from "../../../src/types";
import { authorizeDevice } from "./service";

export const securityCameraDeviceOperationsRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
function auth(c:any){const raw=c.req.header("Authorization")||"",m=/^Device\s+([^\.\s]+)\.([^\s]+)$/.exec(raw);return{id:m?.[1]||"",credential:m?.[2]||""}}
securityCameraDeviceOperationsRoutes.get("/device/profile",async c=>{const a=auth(c);try{const camera:any=await authorizeDevice(c.env.FINANCE_DB,a.id,a.credential);const row:any=await c.env.FINANCE_DB.prepare(`SELECT preferred_facing,width,height,fps,bitrate_kbps,segment_seconds,retention_days,audio_enabled,motion_enabled,updated_at FROM security_camera_profiles WHERE camera_id=? AND organization_id=?`).bind(camera.id,camera.organization_id).first();return c.json({data:row||{preferred_facing:"back",width:1280,height:720,fps:15,bitrate_kbps:1200,segment_seconds:20,retention_days:30,audio_enabled:0,motion_enabled:0,updated_at:null}})}catch(error){return c.json({error:{code:"CAMERA_PROFILE_FAILED",message:error instanceof Error?error.message:"Camera profile fetch failed"}},401)}});
