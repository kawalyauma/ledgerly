// @ts-nocheck
import { Hono } from "hono";
import type { AppVariables, Env } from "../../../src/types";
import { requireScope } from "../../../src/lib/auth";
import { requireModuleEnabled } from "../../../src/lib/modules";
import * as S from "./service";

export const securityCameraRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
const json=async(c:any)=>c.req.json<Record<string,any>>().catch(()=>({}));
const read=[requireModuleEnabled("security-camera"),requireScope("school:read")];
const write=[requireModuleEnabled("security-camera"),requireScope("school:write")];

securityCameraRoutes.get("/manifest",c=>c.json({data:{key:"security-camera",name:"Security Cameras",version:"0.1.0",cameraProtocol:"1",capabilities:["qr-pairing","local-recording","device-health","remote-live-request"]}}));
securityCameraRoutes.get("/overview",...read,async c=>c.json({data:await S.overview(c.env.FINANCE_DB,c.get("principal").organizationId)}));
securityCameraRoutes.get("/cameras",...read,async c=>c.json({data:await S.listCameras(c.env.FINANCE_DB,c.get("principal").organizationId)}));
securityCameraRoutes.get("/servers",...read,async c=>c.json({data:await S.listServers(c.env.FINANCE_DB,c.get("principal").organizationId)}));
securityCameraRoutes.post("/pairings",...write,async c=>{const p=c.get("principal");return c.json({data:await S.createPairing(c.env.FINANCE_DB,p.organizationId,p.userId,await json(c))},201)});
securityCameraRoutes.post("/cameras/:id/revoke",...write,async c=>c.json({data:await S.revokeCamera(c.env.FINANCE_DB,c.get("principal").organizationId,c.req.param("id"))}));
