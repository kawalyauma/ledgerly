import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { AppVariables,Env } from "../../../src/types";
import { requireModuleEnabled } from "../../../src/lib/modules";
import { AppError } from "../../../src/lib/errors";
import * as Batch from "./batches";

export const printerlyBatchRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
const json=async(c:any)=>c.req.json().catch(()=>({}));
const access=(write=false):MiddlewareHandler<{Bindings:Env;Variables:AppVariables}>=>async(c,next)=>{const p=c.get("principal");if(p.role==="owner"||p.role==="admin"||p.role==="manager"||p.role==="accountant"||(!write&&p.role==="viewer"))return next();const scopes=write?["school:write","documents:write","reports:write","journals:write"]:["school:read","documents:read","reports:read","journals:read","accounts:read"];if(!p.scopes.some((s:string)=>scopes.includes(s)))throw new AppError(403,"FORBIDDEN",write?"You do not have permission to create Printerly batches":"You do not have permission to use Printerly batches");await next()};
const read=[requireModuleEnabled("printerly"),access(false)],write=[requireModuleEnabled("printerly"),access(true)];

printerlyBatchRoutes.get("/manifest",c=>c.json({data:{key:"printerly",name:"Printerly",version:"1.6.0",nodeProtocol:"3",capabilities:["remote-print","global-print-action","scannerly","cost-accounting","usage-reporting","monthly-quotas","automatic-print-rules","approval-workflows","scheduled-printing","multi-document-batches","batch-retry","secure-release","priority-queue","cups-node","sane-scanner","claim-leases","checksum-verification"]}}));
printerlyBatchRoutes.get("/batches",...read,async c=>c.json({data:await Batch.listBatches(c.env.FINANCE_DB,c.get("principal").organizationId,Number(c.req.query("limit"))||100)}));
printerlyBatchRoutes.get("/batches/:id",...read,async c=>c.json({data:await Batch.getBatch(c.env.FINANCE_DB,c.get("principal").organizationId,c.req.param("id"))}));
printerlyBatchRoutes.post("/batches",...write,async c=>{const p=c.get("principal"),batch=await Batch.createBatch(c.env.FINANCE_DB,p,await json(c));if(batch.status==="ready")c.executionCtx.waitUntil(Batch.dispatchBatch(c.env,batch.id));return c.json({data:batch},201)});
printerlyBatchRoutes.post("/batches/:id/dispatch",...write,async c=>{const p=c.get("principal"),batch=await Batch.getBatch(c.env.FINANCE_DB,p.organizationId,c.req.param("id"));if(batch.createdBy!==p.userId&&p.role!=="owner"&&p.role!=="admin")throw new AppError(403,"FORBIDDEN","Only the batch creator or an administrator can dispatch this batch");return c.json({data:await Batch.dispatchBatch(c.env,batch.id,50)})});
printerlyBatchRoutes.post("/batches/:id/cancel",...write,async c=>{const p=c.get("principal"),batch=await Batch.getBatch(c.env.FINANCE_DB,p.organizationId,c.req.param("id"));if(batch.createdBy!==p.userId&&p.role!=="owner"&&p.role!=="admin")throw new AppError(403,"FORBIDDEN","Only the batch creator or an administrator can cancel this batch");return c.json({data:await Batch.cancelBatch(c.env.FINANCE_DB,c.env.WORK_FILES_BUCKET,p.organizationId,p.userId,batch.id)})});
printerlyBatchRoutes.post("/batches/:batchId/items/:itemId/retry",...write,async c=>{const p=c.get("principal"),batch=await Batch.getBatch(c.env.FINANCE_DB,p.organizationId,c.req.param("batchId"));if(batch.createdBy!==p.userId&&p.role!=="owner"&&p.role!=="admin")throw new AppError(403,"FORBIDDEN","Only the batch creator or an administrator can retry this item");const item=await Batch.retryItem(c.env.FINANCE_DB,p.organizationId,batch.id,c.req.param("itemId"));c.executionCtx.waitUntil(Batch.dispatchBatch(c.env,batch.id));return c.json({data:item})});
