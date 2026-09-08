// @ts-nocheck
import { Hono } from "hono";
import type { AppVariables, Env } from "../../../src/types";
import { requireScope } from "../../../src/lib/auth";
import { requireModuleEnabled } from "../../../src/lib/modules";
import * as S from "./service";

export const printerlyRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
const json=async(c:any)=>c.req.json<Record<string,any>>().catch(()=>({}));
const userRead=[requireModuleEnabled("printerly"),requireScope("school:read")];
const userWrite=[requireModuleEnabled("printerly"),requireScope("school:write")];
const bearer=(c:any)=>(c.req.header("Authorization")||"").replace(/^Bearer\s+/i,"").trim();

printerlyRoutes.get("/manifest",c=>c.json({data:{key:"printerly",name:"Printerly",version:"1.0.0",nodeProtocol:"1",capabilities:["remote-print","secure-release","priority-queue","cups-node"]}}));
printerlyRoutes.get("/overview",...userRead,async c=>c.json({data:await S.overview(c.env.FINANCE_DB,c.get("principal").organizationId)}));
printerlyRoutes.get("/nodes",...userRead,async c=>c.json({data:await S.listNodes(c.env.FINANCE_DB,c.get("principal").organizationId)}));
printerlyRoutes.post("/nodes",...userWrite,async c=>{const p=c.get("principal");return c.json({data:await S.createNode(c.env.FINANCE_DB,p.organizationId,p.userId,await json(c))},201)});
printerlyRoutes.post("/nodes/:id/revoke",...userWrite,async c=>c.json({data:await S.revokeNode(c.env.FINANCE_DB,c.get("principal").organizationId,c.req.param("id"))}));
printerlyRoutes.get("/printers",...userRead,async c=>c.json({data:await S.listPrinters(c.env.FINANCE_DB,c.get("principal").organizationId)}));
printerlyRoutes.get("/jobs",...userRead,async c=>c.json({data:await S.listJobs(c.env.FINANCE_DB,c.get("principal").organizationId,Number(c.req.query("limit"))||100)}));
printerlyRoutes.post("/jobs",...userWrite,async c=>{const p=c.get("principal");return c.json({data:await S.createJob(c.env.FINANCE_DB,p.organizationId,p.userId,await json(c))},201)});
printerlyRoutes.post("/jobs/:id/release",...userWrite,async c=>{const p=c.get("principal");return c.json({data:await S.releaseJob(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"))})});
printerlyRoutes.post("/jobs/:id/cancel",...userWrite,async c=>{const p=c.get("principal");return c.json({data:await S.cancelJob(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"))})});

printerlyRoutes.post("/node/pair",async c=>c.json({data:await S.pairNode(c.env.FINANCE_DB,await json(c))}));
printerlyRoutes.post("/node/heartbeat",async c=>{const node=await S.authenticateNode(c.env.FINANCE_DB,bearer(c));return c.json({data:await S.heartbeat(c.env.FINANCE_DB,node,await json(c))})});
printerlyRoutes.post("/node/jobs/claim",async c=>{const node=await S.authenticateNode(c.env.FINANCE_DB,bearer(c));return c.json({data:await S.claimJob(c.env.FINANCE_DB,node,await json(c))})});
printerlyRoutes.post("/node/jobs/:id/status",async c=>{const node=await S.authenticateNode(c.env.FINANCE_DB,bearer(c));return c.json({data:await S.nodeJobStatus(c.env.FINANCE_DB,node,c.req.param("id"),await json(c))})});
