// @ts-nocheck
import { Hono } from "hono";
import type { AppVariables, Env } from "../../../src/types";
import { requireModuleEnabled } from "../../../src/lib/modules";
import {securityRead,securityReview,securityManage} from "./security-scope";
import {auditFromContext} from "./audit";
import * as E from "./events-service";

export const securityCameraEventRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
const json=async(c:any)=>c.req.json<Record<string,any>>().catch(()=>({}));
const read=[requireModuleEnabled("security-camera"),securityRead],review=[requireModuleEnabled("security-camera"),securityReview],manage=[requireModuleEnabled("security-camera"),securityManage];
securityCameraEventRoutes.get("/events",...read,async c=>c.json({data:await E.listEvents(c.env.FINANCE_DB,c.get("principal").organizationId,{cameraId:c.req.query("cameraId"),type:c.req.query("type"),status:c.req.query("status"),from:c.req.query("from"),to:c.req.query("to"),limit:c.req.query("limit")})}));
securityCameraEventRoutes.get("/events/config",...read,async c=>c.json({data:await E.eventConfig(c.env.FINANCE_DB,c.get("principal").organizationId)}));
securityCameraEventRoutes.get("/incidents",...read,async c=>c.json({data:await E.listIncidents(c.env.FINANCE_DB,c.get("principal").organizationId)}));
securityCameraEventRoutes.post("/cameras/:id/zones",...manage,async c=>{const body=await json(c),data=await E.saveZone(c.env.FINANCE_DB,c.get("principal").organizationId,c.req.param("id"),body);await auditFromContext(c,"zone.saved","camera",c.req.param("id"),{zoneId:data.id,name:data.name,zoneType:data.zoneType,points:data.polygon?.length||0});return c.json({data})});
securityCameraEventRoutes.post("/event-schedules",...manage,async c=>{const body=await json(c),data=await E.saveSchedule(c.env.FINANCE_DB,c.get("principal").organizationId,body);await auditFromContext(c,"event_schedule.saved","event-schedule",data.id,{name:body.name,cameraId:body.cameraId||null});return c.json({data})});
securityCameraEventRoutes.post("/event-rules",...manage,async c=>{const body=await json(c),data=await E.saveRule(c.env.FINANCE_DB,c.get("principal").organizationId,body);await auditFromContext(c,"event_rule.saved","event-rule",data.id,{name:body.name,eventType:body.eventType,severity:body.severity,cameraId:body.cameraId||null});return c.json({data})});
securityCameraEventRoutes.post("/events/:id/review",...review,async c=>{const p=c.get("principal"),body=await json(c),data=await E.reviewEvent(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"),body.status);await auditFromContext(c,"event.reviewed","event",c.req.param("id"),{status:data.status});return c.json({data})});
securityCameraEventRoutes.post("/events/:id/incident",...review,async c=>{const p=c.get("principal"),body=await json(c),data=await E.createIncident(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"),body);await auditFromContext(c,"incident.created","incident",data.id,{eventId:c.req.param("id"),cameraId:data.cameraId,from:data.from,to:data.to,title:data.title});return c.json({data},201)});
securityCameraEventRoutes.post("/events/:id/evidence",...review,async c=>{const p=c.get("principal"),data=await E.createEvidenceGrant(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"));await auditFromContext(c,"evidence.view.granted","event",c.req.param("id"),{expiresAt:data.expiresAt});return c.json({data},201)});
