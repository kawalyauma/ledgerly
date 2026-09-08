// @ts-nocheck
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { AppVariables, Env } from "../../../src/types";
import { requireScope } from "../../../src/lib/auth";
import { requireModuleEnabled } from "../../../src/lib/modules";
import { AppError } from "../../../src/lib/errors";
import * as S from "./service";
import * as Cost from "./costing";
import * as Health from "./health";
import * as Scan from "./scannerly";

export const printerlyRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
const json=async(c:any)=>c.req.json<Record<string,any>>().catch(()=>({}));
const printerlyAccess=(write=false):MiddlewareHandler<{Bindings:Env;Variables:AppVariables}>=>async(c,next)=>{
  const p=c.get("principal");
  if(p.role==="owner"||p.role==="admin"||(!write&&p.role==="viewer")||p.role==="manager"||p.role==="accountant")return next();
  const allowed=write?["school:write","documents:write","reports:write","journals:write"]:["school:read","documents:read","reports:read","journals:read","accounts:read"];
  if(!p.scopes.some((scope:string)=>allowed.includes(scope)))throw new AppError(403,"FORBIDDEN",write?"You do not have permission to submit Printerly jobs":"You do not have permission to use Printerly");
  await next();
};
const userRead=[requireModuleEnabled("printerly"),printerlyAccess(false)];
const userWrite=[requireModuleEnabled("printerly"),printerlyAccess(true)];

printerlyRoutes.get("/manifest",c=>c.json({data:{key:"printerly",name:"Printerly",version:"1.2.0",nodeProtocol:"3",capabilities:["remote-print","private-r2-documents","global-print-action","cost-centres","ledger-cost-posting","printer-health","multi-channel-alerts","scannerly","student-staff-scan-routing","module-scan-inbox","secure-release","priority-queue","cups-node","sane-scanner","claim-leases","checksum-verification"]}}));
printerlyRoutes.get("/overview",...userRead,async c=>{const org=c.get("principal").organizationId;const[base,costing,health,scannerly]=await Promise.all([S.overview(c.env.FINANCE_DB,org),Cost.costSummary(c.env.FINANCE_DB,org),Health.healthSummary(c.env.FINANCE_DB,org),Scan.scanSummary(c.env.FINANCE_DB,org)]);return c.json({data:{...base,costing,health,scannerly}})});
printerlyRoutes.get("/nodes",...userRead,async c=>c.json({data:await S.listNodes(c.env.FINANCE_DB,c.get("principal").organizationId)}));
printerlyRoutes.post("/nodes",...userWrite,async c=>{const p=c.get("principal");return c.json({data:await S.createNode(c.env.FINANCE_DB,p.organizationId,p.userId,await json(c))},201)});
printerlyRoutes.post("/nodes/:id/revoke",...userWrite,async c=>c.json({data:await S.revokeNode(c.env.FINANCE_DB,c.get("principal").organizationId,c.req.param("id"))}));
printerlyRoutes.get("/printers",...userRead,async c=>c.json({data:await Health.listPrinters(c.env.FINANCE_DB,c.get("principal").organizationId)}));

printerlyRoutes.post("/documents",...userWrite,async c=>{const p=c.get("principal"),form=await c.req.formData();return c.json({data:await S.uploadDocument(c.env.FINANCE_DB,c.env.WORK_FILES_BUCKET,p.organizationId,p.userId,form)},201)});
printerlyRoutes.delete("/documents/:id",...userWrite,async c=>{const p=c.get("principal");return c.json({data:await S.deleteStagedDocument(c.env.FINANCE_DB,c.env.WORK_FILES_BUCKET,p.organizationId,c.req.param("id"))})});

printerlyRoutes.get("/jobs",...userRead,async c=>c.json({data:await Cost.listJobsWithCosting(c.env.FINANCE_DB,c.get("principal").organizationId,Number(c.req.query("limit"))||100)}));
printerlyRoutes.post("/jobs",...userWrite,async c=>{const p=c.get("principal"),body=await json(c),prepared=await Cost.prepareJobCosting(c.env.FINANCE_DB,p.organizationId,body),job=await S.createJob(c.env.FINANCE_DB,p.organizationId,p.userId,body);await Cost.attachJobCosting(c.env.FINANCE_DB,p.organizationId,job.id,prepared);return c.json({data:{...job,costing:prepared}},201)});
printerlyRoutes.post("/jobs/:id/release",...userWrite,async c=>{const p=c.get("principal");return c.json({data:await S.releaseJob(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"))})});
printerlyRoutes.post("/jobs/:id/cancel",...userWrite,async c=>{const p=c.get("principal");return c.json({data:await S.cancelJob(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"))})});

printerlyRoutes.get("/costing/options",...userRead,async c=>c.json({data:await Cost.costingOptions(c.env.FINANCE_DB,c.get("principal").organizationId)}));
printerlyRoutes.get("/costing/profile",...userRead,async c=>c.json({data:await Cost.getCostProfile(c.env.FINANCE_DB,c.get("principal").organizationId)}));
printerlyRoutes.put("/costing/profile",...userWrite,requireScope("journals:write"),async c=>{const p=c.get("principal");return c.json({data:await Cost.updateCostProfile(c.env.FINANCE_DB,p.organizationId,p.userId,await json(c))})});
printerlyRoutes.get("/costing/ledger",...userRead,async c=>c.json({data:await Cost.listCostLedger(c.env.FINANCE_DB,c.get("principal").organizationId,Number(c.req.query("limit"))||200)}));
printerlyRoutes.post("/costing/jobs/:id/post",...userWrite,requireScope("journals:write"),async c=>{const p=c.get("principal");return c.json({data:await Cost.postJobCost(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"))})});

printerlyRoutes.get("/alerts",...userRead,async c=>c.json({data:await Health.listAlerts(c.env.FINANCE_DB,c.get("principal").organizationId,Number(c.req.query("limit"))||100)}));
printerlyRoutes.post("/alerts/:id/acknowledge",...userRead,async c=>{const p=c.get("principal");return c.json({data:await Health.acknowledgeAlert(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"))})});
printerlyRoutes.get("/alerts/preferences",...userRead,async c=>{const p=c.get("principal");return c.json({data:await Health.getAlertPreferences(c.env.FINANCE_DB,p.organizationId,p.userId)})});
printerlyRoutes.put("/alerts/preferences",...userRead,async c=>{const p=c.get("principal");return c.json({data:await Health.updateAlertPreferences(c.env.FINANCE_DB,p.organizationId,p.userId,await json(c))})});

printerlyRoutes.get("/scanners",...userRead,async c=>c.json({data:await Scan.listScanners(c.env.FINANCE_DB,c.get("principal").organizationId)}));
printerlyRoutes.get("/scannerly/targets",...userRead,async c=>c.json({data:await Scan.scanTargets(c.env.FINANCE_DB,c.get("principal").organizationId,c.req.query("q")||"")}));
printerlyRoutes.get("/scannerly/inbox",...userRead,async c=>c.json({data:await Scan.listModuleInbox(c.env.FINANCE_DB,c.get("principal").organizationId,c.req.query("module")||"",Number(c.req.query("limit"))||80)}));
printerlyRoutes.get("/scans",...userRead,async c=>c.json({data:await Scan.listScanJobs(c.env.FINANCE_DB,c.get("principal").organizationId,Number(c.req.query("limit"))||150)}));
printerlyRoutes.post("/scans",...userWrite,async c=>{const p=c.get("principal");return c.json({data:await Scan.createScanJob(c.env.FINANCE_DB,p.organizationId,p.userId,await json(c))},201)});
printerlyRoutes.post("/scans/:id/cancel",...userWrite,async c=>{const p=c.get("principal");return c.json({data:await Scan.cancelScanJob(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"))})});
printerlyRoutes.post("/scans/:id/retry",...userWrite,async c=>{const p=c.get("principal");return c.json({data:await Scan.retryScanJob(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"))})});
printerlyRoutes.get("/scans/documents/:id/content",...userRead,async c=>{const p=c.get("principal"),file=await Scan.getScanDocument(c.env.FINANCE_DB,c.env.WORK_FILES_BUCKET,p.organizationId,c.req.param("id"));c.header("Content-Type",file.mimeType);c.header("Content-Length",String(file.sizeBytes));c.header("Content-Disposition",`inline; filename="${String(file.originalName).replace(/["\r\n]/g,"-")}"`);c.header("ETag",file.object.httpEtag);c.header("X-Printerly-SHA256",file.checksum);return c.body(file.object.body)});
