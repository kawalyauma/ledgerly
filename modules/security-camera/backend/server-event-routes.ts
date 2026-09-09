// @ts-nocheck
import { Hono } from "hono";
import type { AppVariables, Env } from "../../../src/types";
import * as E from "./events-service";

export const securityCameraServerEventRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
const json=async(c:any)=>c.req.json<Record<string,any>>().catch(()=>({}));
function auth(c:any){const raw=c.req.header("Authorization")||"",m=/^Server\s+([^\.\s]+)\.([^\s]+)$/.exec(raw);return{id:m?.[1]||"",credential:m?.[2]||""}}
securityCameraServerEventRoutes.get("/server/events/config",async c=>{const a=auth(c);try{return c.json({data:await E.serverEventConfig(c.env.FINANCE_DB,a.id,a.credential)})}catch(error){return c.json({error:{code:"CAMERA_EVENT_CONFIG_FAILED",message:error instanceof Error?error.message:"Camera event config failed"}},401)}});
securityCameraServerEventRoutes.post("/server/events/sync",async c=>{const a=auth(c);try{return c.json({data:await E.syncEvents(c.env.FINANCE_DB,a.id,a.credential,await json(c))})}catch(error){return c.json({error:{code:"CAMERA_EVENT_SYNC_FAILED",message:error instanceof Error?error.message:"Camera event sync failed"}},400)}});
