// @ts-nocheck
import { Hono } from "hono";
import type { AppVariables, Env } from "../../../src/types";
import { requireScope } from "../../../src/lib/auth";
import { requireModuleEnabled } from "../../../src/lib/modules";
import * as O from "./operations-service";

export const securityCameraOperationsRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
const json=async(c:any)=>c.req.json<Record<string,any>>().catch(()=>({}));
const read=[requireModuleEnabled("security-camera"),requireScope("school:read")],write=[requireModuleEnabled("security-camera"),requireScope("school:write")];

securityCameraOperationsRoutes.get("/operations",...read,async c=>c.json({data:await O.getOperations(c.env.FINANCE_DB,c.get("principal").organizationId)}));
securityCameraOperationsRoutes.get("/cameras/:id/profile",...read,async c=>c.json({data:await O.getCameraProfile(c.env.FINANCE_DB,c.get("principal").organizationId,c.req.param("id"))}));
securityCameraOperationsRoutes.post("/cameras/:id/profile",...write,async c=>c.json({data:await O.saveCameraProfile(c.env.FINANCE_DB,c.get("principal").organizationId,c.req.param("id"),await json(c))}));
securityCameraOperationsRoutes.get("/cameras/:id/timeline",...read,async c=>c.json({data:await O.timeline(c.env.FINANCE_DB,c.get("principal").organizationId,c.req.param("id"),c.req.query("from")||undefined,c.req.query("to")||undefined,Number(c.req.query("limit"))||1000)}));
securityCameraOperationsRoutes.post("/recordings/:id/playback",...read,async c=>{const p=c.get("principal");return c.json({data:await O.createPlaybackGrant(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"))},201)});
securityCameraOperationsRoutes.post("/cameras/:id/export",...write,async c=>{const p=c.get("principal");return c.json({data:await O.createExport(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"),await json(c))},201)});
securityCameraOperationsRoutes.post("/alerts/:id/acknowledge",...write,async c=>{const p=c.get("principal");return c.json({data:await O.acknowledgeAlert(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"))})});
