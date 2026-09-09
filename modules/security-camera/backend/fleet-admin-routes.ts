// @ts-nocheck
import {Hono} from "hono";
import type {AppVariables,Env} from "../../../src/types";
import {requireModuleEnabled} from "../../../src/lib/modules";
import {securityRead,securityManage} from "./security-scope";
import {auditFromContext} from "./audit";
import * as F from "./fleet-admin-service";
export const securityCameraFleetAdminRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
const json=async(c:any)=>c.req.json<Record<string,any>>().catch(()=>({}));
const read=[requireModuleEnabled("security-camera"),securityRead],manage=[requireModuleEnabled("security-camera"),securityManage];
securityCameraFleetAdminRoutes.get("/fleet",...read,async c=>c.json({data:await F.fleetAdmin(c.env.FINANCE_DB,c.get("principal").organizationId)}));
securityCameraFleetAdminRoutes.post("/groups",...manage,async c=>{const p=c.get("principal"),body=await json(c),data=await F.saveGroup(c.env.FINANCE_DB,p.organizationId,p.userId,body);await auditFromContext(c,"camera_group.saved","camera-group",data.id,{name:body.name,cameraCount:body.cameraIds?.length||0});return c.json({data},201)});
securityCameraFleetAdminRoutes.post("/wall-views",...manage,async c=>{const p=c.get("principal"),body=await json(c),data=await F.saveWallView(c.env.FINANCE_DB,p.organizationId,p.userId,body);await auditFromContext(c,"wall_view.saved","wall-view",data.id,{name:body.name,cameraCount:body.cameraIds?.length||0,columns:body.columns});return c.json({data},201)});
securityCameraFleetAdminRoutes.post("/cameras/:id/lifecycle",...manage,async c=>{const p=c.get("principal"),body=await json(c),data=await F.setLifecycle(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"),body);await auditFromContext(c,"camera.lifecycle.changed","camera",c.req.param("id"),{status:body.status,reason:body.reason||null});return c.json({data})});
securityCameraFleetAdminRoutes.get("/cameras/:id/diagnostics",...read,async c=>c.json({data:await F.diagnostics(c.env.FINANCE_DB,c.get("principal").organizationId,c.req.param("id"))}));
securityCameraFleetAdminRoutes.post("/cameras/:id/snapshot",...read,async c=>{const p=c.get("principal"),data=await F.createSnapshotGrant(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"));await auditFromContext(c,"camera.snapshot.granted","camera",c.req.param("id"),{recordingId:data.recordingId,expiresAt:data.expiresAt});return c.json({data},201)});
