// @ts-nocheck
import { Hono } from "hono";
import type { AppVariables, Env } from "../../../src/types";
import { requireModuleEnabled } from "../../../src/lib/modules";
import {securityRead,securityExport,securityManage,securityReview} from "./security-scope";
import {auditFromContext} from "./audit";
import * as O from "./operations-service";

export const securityCameraOperationsRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
const json=async(c:any)=>c.req.json<Record<string,any>>().catch(()=>({}));
const read=[requireModuleEnabled("security-camera"),securityRead],manage=[requireModuleEnabled("security-camera"),securityManage],exportScope=[requireModuleEnabled("security-camera"),securityExport],review=[requireModuleEnabled("security-camera"),securityReview];
const publicRecording=(row:any)=>{const{local_path:_localPath,localPath:_camelLocalPath,...safe}=row||{};return safe};
securityCameraOperationsRoutes.get("/operations",...read,async c=>c.json({data:await O.getOperations(c.env.FINANCE_DB,c.get("principal").organizationId)}));
securityCameraOperationsRoutes.get("/cameras/:id/profile",...read,async c=>c.json({data:await O.getCameraProfile(c.env.FINANCE_DB,c.get("principal").organizationId,c.req.param("id"))}));
securityCameraOperationsRoutes.post("/cameras/:id/profile",...manage,async c=>{const body=await json(c),data=await O.saveCameraProfile(c.env.FINANCE_DB,c.get("principal").organizationId,c.req.param("id"),body);await auditFromContext(c,"camera.profile.changed","camera",c.req.param("id"),{preferredFacing:body.preferredFacing,width:body.width,height:body.height,fps:body.fps,bitrateKbps:body.bitrateKbps,retentionDays:body.retentionDays});return c.json({data})});
securityCameraOperationsRoutes.get("/cameras/:id/timeline",...read,async c=>{const data=await O.timeline(c.env.FINANCE_DB,c.get("principal").organizationId,c.req.param("id"),c.req.query("from")||undefined,c.req.query("to")||undefined,Number(c.req.query("limit"))||1000);return c.json({data:{...data,segments:(data.segments||[]).map(publicRecording)}})});
securityCameraOperationsRoutes.post("/recordings/:id/playback",...read,async c=>{const p=c.get("principal"),data=await O.createPlaybackGrant(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"));await auditFromContext(c,"recording.playback.granted","recording",c.req.param("id"),{cameraId:data.cameraId,expiresAt:data.expiresAt});return c.json({data},201)});
securityCameraOperationsRoutes.post("/cameras/:id/export",...exportScope,async c=>{const p=c.get("principal"),body=await json(c),data=await O.createExport(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"),body);await auditFromContext(c,"recording.export.requested","camera",c.req.param("id"),{exportId:data.id,from:data.from,to:data.to,expiresAt:data.expiresAt});return c.json({data},201)});
securityCameraOperationsRoutes.post("/alerts/:id/acknowledge",...review,async c=>{const p=c.get("principal"),data=await O.acknowledgeAlert(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"));await auditFromContext(c,"alert.acknowledged","alert",c.req.param("id"));return c.json({data})});
