// @ts-nocheck
import { Hono } from "hono";
import type { AppVariables, Env } from "../../../src/types";
import * as S from "./service";
import * as Cost from "./costing";
import * as Health from "./health";
import * as Scan from "./scannerly";
import * as Quota from "./quota";

export const printerlyNodeRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
const json=async(c:any)=>c.req.json<Record<string,any>>().catch(()=>({}));
const bearer=(c:any)=>(c.req.header("Authorization")||"").replace(/^Bearer\s+/i,"").trim();

printerlyNodeRoutes.post("/node/pair",async c=>c.json({data:await S.pairNode(c.env.FINANCE_DB,await json(c))}));
printerlyNodeRoutes.post("/node/heartbeat",async c=>{
  const node=await S.authenticateNode(c.env.FINANCE_DB,bearer(c)),body=await json(c);
  const result=await S.heartbeat(c.env.FINANCE_DB,node,body);
  await Scan.syncScanners(c.env.FINANCE_DB,node,body.scanners||[]);
  await Health.processHeartbeat(c.env,node,body);
  return c.json({data:{...result,nodeProtocol:3}});
});
printerlyNodeRoutes.post("/node/jobs/claim",async c=>{const node=await S.authenticateNode(c.env.FINANCE_DB,bearer(c));return c.json({data:await S.claimJob(c.env.FINANCE_DB,node,await json(c))})});
printerlyNodeRoutes.get("/node/jobs/:id/document",async c=>{
  const node=await S.authenticateNode(c.env.FINANCE_DB,bearer(c));
  const file=await S.nodeJobDocument(c.env.FINANCE_DB,c.env.WORK_FILES_BUCKET,node,c.req.param("id"),c.req.header("X-Printerly-Claim")||c.req.query("claimToken")||"");
  c.header("Content-Type",file.mimeType||"application/octet-stream");c.header("Content-Length",String(file.sizeBytes||0));
  c.header("Content-Disposition",`inline; filename="${String(file.originalName||"print-document").replace(/["\r\n]/g,"-")}"`);c.header("ETag",file.object.httpEtag);c.header("X-Printerly-SHA256",file.checksum);
  return c.body(file.object.body);
});
printerlyNodeRoutes.post("/node/jobs/:id/status",async c=>{
  const node=await S.authenticateNode(c.env.FINANCE_DB,bearer(c)),body=await json(c),id=c.req.param("id"),result=await S.nodeJobStatus(c.env.FINANCE_DB,node,id,body);
  let costing=null;
  if(String(body.status)==="completed"){costing=await Cost.finalizeJobCost(c.env.FINANCE_DB,node.organization_id,id,body,node.id);await Quota.settleJob(c.env.FINANCE_DB,node.organization_id,id)}
  else if(String(body.status)==="failed"){await Quota.releaseJob(c.env.FINANCE_DB,node.organization_id,id);await Health.raiseJobFailure(c.env,node,id,String(body.errorMessage||"Printing failed"))}
  return c.json({data:{...result,costing}});
});

printerlyNodeRoutes.post("/node/scans/claim",async c=>{const node=await S.authenticateNode(c.env.FINANCE_DB,bearer(c));return c.json({data:await Scan.claimScanJob(c.env.FINANCE_DB,node,await json(c))})});
printerlyNodeRoutes.post("/node/scans/:id/status",async c=>{
  const node=await S.authenticateNode(c.env.FINANCE_DB,bearer(c)),body=await json(c),id=c.req.param("id"),result=await Scan.scanJobStatus(c.env.FINANCE_DB,node,id,body);
  if(String(body.status)==="failed")await Health.raiseScanFailure(c.env,node,id,String(body.errorMessage||"Scanning failed"));
  return c.json({data:result});
});
printerlyNodeRoutes.post("/node/scans/:id/upload",async c=>{
  const node=await S.authenticateNode(c.env.FINANCE_DB,bearer(c)),claim=c.req.header("X-Printerly-Scan-Claim")||c.req.query("claimToken")||"",form=await c.req.formData();
  return c.json({data:await Scan.uploadScanResult(c.env.FINANCE_DB,c.env.WORK_FILES_BUCKET,node,c.req.param("id"),claim,form)},201);
});
