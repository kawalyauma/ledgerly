// @ts-nocheck
import { Hono } from "hono";
import type { AppVariables, Env } from "../../../src/types";
import * as O from "./operations-service";

export const securityCameraServerOperationsRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
const json=async(c:any)=>c.req.json<Record<string,any>>().catch(()=>({}));
function auth(c:any){const raw=c.req.header("Authorization")||"",m=/^Server\s+([^\.\s]+)\.([^\s]+)$/.exec(raw);return{id:m?.[1]||"",credential:m?.[2]||""}}
securityCameraServerOperationsRoutes.get("/server/operations",async c=>{const a=auth(c);try{return c.json({data:await O.serverOperations(c.env.FINANCE_DB,a.id,a.credential)})}catch(error){return c.json({error:{code:"CAMERA_SERVER_OPERATIONS_FAILED",message:error instanceof Error?error.message:"Camera server operations fetch failed"}},401)}});
securityCameraServerOperationsRoutes.post("/server/operations/sync",async c=>{const a=auth(c);try{return c.json({data:await O.syncServerOperations(c.env.FINANCE_DB,a.id,a.credential,await json(c))})}catch(error){return c.json({error:{code:"CAMERA_SERVER_OPERATIONS_SYNC_FAILED",message:error instanceof Error?error.message:"Camera server operations sync failed"}},400)}});
