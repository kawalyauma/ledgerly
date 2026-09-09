// @ts-nocheck
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { AppVariables, Env } from "../../../src/types";
import { requireModuleEnabled } from "../../../src/lib/modules";
import { AppError } from "../../../src/lib/errors";
import * as Release from "./release";

export const printerlyReleaseRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
const json=async(c:any)=>c.req.json<Record<string,any>>().catch(()=>({}));
const access:MiddlewareHandler<{Bindings:Env;Variables:AppVariables}>=async(c,next)=>{const p=c.get("principal");if(["owner","admin","manager","accountant"].includes(p.role)||p.scopes.some((s:string)=>["school:write","documents:write","reports:write","journals:write"].includes(s)))return next();throw new AppError(403,"FORBIDDEN","You do not have permission to manage Printerly secure release")};
const write=[requireModuleEnabled("printerly"),access];
printerlyReleaseRoutes.get("/release/jobs",...write,async c=>{const p=c.get("principal");return c.json({data:await Release.listSecureJobs(c.env.FINANCE_DB,p.organizationId,p)})});
printerlyReleaseRoutes.post("/release/jobs/:id/credential",...write,async c=>{const p=c.get("principal"),body=await json(c);return c.json({data:await Release.issueCredential(c.env.FINANCE_DB,p.organizationId,p,c.req.param("id"),Number(body.ttlMinutes)||15)},201)});
printerlyReleaseRoutes.post("/release/jobs/:id/revoke",...write,async c=>{const p=c.get("principal");return c.json({data:await Release.revokeCredential(c.env.FINANCE_DB,p.organizationId,p,c.req.param("id"))})});
