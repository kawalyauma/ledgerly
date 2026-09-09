// @ts-nocheck
import { Hono } from "hono";
import type { AppVariables, Env } from "../../../src/types";
import { requireScope } from "../../../src/lib/auth";
import { requireModuleEnabled } from "../../../src/lib/modules";
import * as E from "./events-service";

export const securityCameraEventRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
const json=async(c:any)=>c.req.json<Record<string,any>>().catch(()=>({}));
const read=[requireModuleEnabled("security-camera"),requireScope("school:read")],write=[requireModuleEnabled("security-camera"),requireScope("school:write")];
securityCameraEventRoutes.get("/events",...read,async c=>c.json({data:await E.listEvents(c.env.FINANCE_DB,c.get("principal").organizationId,{cameraId:c.req.query("cameraId"),type:c.req.query("type"),status:c.req.query("status"),from:c.req.query("from"),to:c.req.query("to"),limit:c.req.query("limit")})}));
securityCameraEventRoutes.get("/events/config",...read,async c=>c.json({data:await E.eventConfig(c.env.FINANCE_DB,c.get("principal").organizationId)}));
securityCameraEventRoutes.get("/incidents",...read,async c=>c.json({data:await E.listIncidents(c.env.FINANCE_DB,c.get("principal").organizationId)}));
securityCameraEventRoutes.post("/cameras/:id/zones",...write,async c=>c.json({data:await E.saveZone(c.env.FINANCE_DB,c.get("principal").organizationId,c.req.param("id"),await json(c))}));
securityCameraEventRoutes.post("/event-schedules",...write,async c=>c.json({data:await E.saveSchedule(c.env.FINANCE_DB,c.get("principal").organizationId,await json(c))}));
securityCameraEventRoutes.post("/event-rules",...write,async c=>c.json({data:await E.saveRule(c.env.FINANCE_DB,c.get("principal").organizationId,await json(c))}));
securityCameraEventRoutes.post("/events/:id/review",...write,async c=>{const p=c.get("principal"),body=await json(c);return c.json({data:await E.reviewEvent(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"),body.status)})});
securityCameraEventRoutes.post("/events/:id/incident",...write,async c=>{const p=c.get("principal");return c.json({data:await E.createIncident(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"),await json(c))},201)});
securityCameraEventRoutes.post("/events/:id/evidence",...read,async c=>{const p=c.get("principal");return c.json({data:await E.createEvidenceGrant(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"))},201)});
