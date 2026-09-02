import { Hono } from "hono";
import { z } from "zod";
import type { AppVariables, Env } from "../types";
import { requireScope } from "../lib/auth";
import { AppError } from "../lib/errors";
import { createId } from "../lib/ids";
import { randomToken, sha256 } from "../lib/crypto";
import { publishWebhookEvent } from "../services/webhooks";

export const integrationsRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
integrationsRoutes.get("/webhooks",requireScope("admin:read"),async c=>{const p=c.get("principal");const r=await c.env.FINANCE_DB.prepare("SELECT id,url,description,events,active,failure_count AS failureCount,created_at AS createdAt FROM webhook_endpoints WHERE organization_id=? ORDER BY created_at DESC").bind(p.organizationId).all<Record<string,unknown>>();return c.json({data:r.results.map(v=>({...v,events:JSON.parse(String(v.events))}))})});
const webhook=z.object({url:z.url().refine(v=>v.startsWith("https://"),"HTTPS is required"),description:z.string().max(200).optional(),events:z.array(z.string().max(100)).min(1).max(100)});
integrationsRoutes.post("/webhooks",requireScope("admin:write"),async c=>{const s=webhook.safeParse(await c.req.json());if(!s.success)throw new AppError(422,"VALIDATION_ERROR","Invalid webhook",s.error.flatten());const p=c.get("principal"),id=createId("whk"),secret=`whsec_${randomToken(32)}`;await c.env.FINANCE_DB.prepare("INSERT INTO webhook_endpoints (id,organization_id,url,description,events,secret_hash) VALUES (?,?,?,?,?,?)").bind(id,p.organizationId,s.data.url,s.data.description??null,JSON.stringify(s.data.events),await sha256(secret)).run();return c.json({data:{id,...s.data,secret},warning:"Copy the signing secret now; it cannot be retrieved again."},201)});
integrationsRoutes.post("/webhooks/:id/test",requireScope("admin:write"),async c=>{const p=c.get("principal");const endpoint=await c.env.FINANCE_DB.prepare("SELECT id FROM webhook_endpoints WHERE id=? AND organization_id=? AND active=1").bind(c.req.param("id"),p.organizationId).first();if(!endpoint)throw new AppError(404,"NOT_FOUND","Webhook not found");await publishWebhookEvent(c.env,p.organizationId,"webhook.test",{message:"Your Finance Pro webhook test"});return c.json({data:{queued:true}})});
integrationsRoutes.get("/webhook-deliveries",requireScope("admin:read"),async c=>{const p=c.get("principal");const r=await c.env.FINANCE_DB.prepare("SELECT id,endpoint_id AS endpointId,event_type AS eventType,event_id AS eventId,status,attempts,response_status AS responseStatus,delivered_at AS deliveredAt,created_at AS createdAt FROM webhook_deliveries WHERE organization_id=? ORDER BY created_at DESC LIMIT 200").bind(p.organizationId).all();return c.json({data:r.results})});
