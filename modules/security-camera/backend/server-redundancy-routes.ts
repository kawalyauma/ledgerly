// @ts-nocheck
import {Hono} from "hono";
import type {AppVariables,Env} from "../../../src/types";
import {authorizeServer} from "./service";
import {recordValidation} from "./redundancy-service";
import {recordBackupStatus} from "./backup-service";
export const securityCameraServerRedundancyRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
function auth(c:any){const raw=c.req.header("Authorization")||"",m=/^Server\s+([^\.\s]+)\.([^\s]+)$/.exec(raw);return{id:m?.[1]||"",credential:m?.[2]||""}}
securityCameraServerRedundancyRoutes.post("/server/validation",async c=>{const a=auth(c);try{const server:any=await authorizeServer(c.env.FINANCE_DB,a.id,a.credential),body=await c.req.json().catch(()=>({}));return c.json({data:await recordValidation(c.env.FINANCE_DB,server.organization_id,{...body,serverId:a.id})},201)}catch(error){return c.json({error:{code:"CAMERA_VALIDATION_SYNC_FAILED",message:error instanceof Error?error.message:"Validation sync failed"}},400)}});
securityCameraServerRedundancyRoutes.post("/server/backup",async c=>{const a=auth(c);try{const server:any=await authorizeServer(c.env.FINANCE_DB,a.id,a.credential),body=await c.req.json().catch(()=>({}));return c.json({data:await recordBackupStatus(c.env.FINANCE_DB,server.organization_id,a.id,body)})}catch(error){return c.json({error:{code:"CAMERA_BACKUP_SYNC_FAILED",message:error instanceof Error?error.message:"Backup status sync failed"}},400)}});
