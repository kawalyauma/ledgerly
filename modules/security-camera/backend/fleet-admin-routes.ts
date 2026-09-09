// @ts-nocheck
import {Hono} from "hono";
import type {AppVariables,Env} from "../../../src/types";
import {requireScope} from "../../../src/lib/auth";
import {requireModuleEnabled} from "../../../src/lib/modules";
import * as F from "./fleet-admin-service";
export const securityCameraFleetAdminRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
const json=async(c:any)=>c.req.json<Record<string,any>>().catch(()=>({}));
const read=[requireModuleEnabled("security-camera"),requireScope("school:read")],write=[requireModuleEnabled("security-camera"),requireScope("school:write")];
securityCameraFleetAdminRoutes.get("/fleet",...read,async c=>c.json({data:await F.fleetAdmin(c.env.FINANCE_DB,c.get("principal").organizationId)}));
securityCameraFleetAdminRoutes.post("/groups",...write,async c=>{const p=c.get("principal");return c.json({data:await F.saveGroup(c.env.FINANCE_DB,p.organizationId,p.userId,await json(c))},201)});
securityCameraFleetAdminRoutes.post("/wall-views",...write,async c=>{const p=c.get("principal");return c.json({data:await F.saveWallView(c.env.FINANCE_DB,p.organizationId,p.userId,await json(c))},201)});
securityCameraFleetAdminRoutes.post("/cameras/:id/lifecycle",...write,async c=>{const p=c.get("principal");return c.json({data:await F.setLifecycle(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"),await json(c))})});
securityCameraFleetAdminRoutes.get("/cameras/:id/diagnostics",...read,async c=>c.json({data:await F.diagnostics(c.env.FINANCE_DB,c.get("principal").organizationId,c.req.param("id"))}));
securityCameraFleetAdminRoutes.post("/cameras/:id/snapshot",...read,async c=>{const p=c.get("principal");return c.json({data:await F.createSnapshotGrant(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"))},201)});
