// @ts-nocheck
import { Hono } from "hono";
import type { AppVariables, Env } from "../../../src/types";
import * as S from "./service";

export const printerlyNodeRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
const json=async(c:any)=>c.req.json<Record<string,any>>().catch(()=>({}));
const bearer=(c:any)=>(c.req.header("Authorization")||"").replace(/^Bearer\s+/i,"").trim();

printerlyNodeRoutes.post("/node/pair",async c=>c.json({data:await S.pairNode(c.env.FINANCE_DB,await json(c))}));
printerlyNodeRoutes.post("/node/heartbeat",async c=>{const node=await S.authenticateNode(c.env.FINANCE_DB,bearer(c));return c.json({data:await S.heartbeat(c.env.FINANCE_DB,node,await json(c))})});
printerlyNodeRoutes.post("/node/jobs/claim",async c=>{const node=await S.authenticateNode(c.env.FINANCE_DB,bearer(c));return c.json({data:await S.claimJob(c.env.FINANCE_DB,node,await json(c))})});
printerlyNodeRoutes.get("/node/jobs/:id/document",async c=>{
  const node=await S.authenticateNode(c.env.FINANCE_DB,bearer(c));
  const file=await S.nodeJobDocument(c.env.FINANCE_DB,c.env.WORK_FILES_BUCKET,node,c.req.param("id"),c.req.header("X-Printerly-Claim")||c.req.query("claimToken")||"");
  c.header("Content-Type",file.mimeType||"application/octet-stream");
  c.header("Content-Length",String(file.sizeBytes||0));
  c.header("Content-Disposition",`inline; filename="${String(file.originalName||"print-document").replace(/["\r\n]/g,"-")}"`);
  c.header("ETag",file.object.httpEtag);
  c.header("X-Printerly-SHA256",file.checksum);
  return c.body(file.object.body);
});
printerlyNodeRoutes.post("/node/jobs/:id/status",async c=>{const node=await S.authenticateNode(c.env.FINANCE_DB,bearer(c));return c.json({data:await S.nodeJobStatus(c.env.FINANCE_DB,node,c.req.param("id"),await json(c))})});
