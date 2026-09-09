// @ts-nocheck
import {Hono} from "hono";
import type {AppVariables,Env} from "../../../src/types";
import {requireModuleEnabled} from "../../../src/lib/modules";
import {securityRead,securityManage} from "./security-scope";
import * as G from "./governance-service";
import {auditFromContext} from "./audit";
export const securityCameraGovernanceRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
const json=async(c:any)=>c.req.json<Record<string,any>>().catch(()=>({}));
const read=[requireModuleEnabled("security-camera"),securityRead],manage=[requireModuleEnabled("security-camera"),securityManage];
securityCameraGovernanceRoutes.get("/governance",...read,async c=>{const org=c.get("principal").organizationId;const[overview,policies,queue,updates]=await Promise.all([G.governanceOverview(c.env.FINANCE_DB,org),G.listPolicies(c.env.FINANCE_DB,org),G.listQueue(c.env.FINANCE_DB,org,undefined,100),G.listServerUpdatePolicies(c.env.FINANCE_DB,org)]);return c.json({data:{overview,policies,queue,updates}})});
securityCameraGovernanceRoutes.get("/audit",...read,async c=>c.json({data:await G.listAudit(c.env.FINANCE_DB,c.get("principal").organizationId,{actor:c.req.query("actor"),action:c.req.query("action"),cameraId:c.req.query("cameraId"),from:c.req.query("from"),to:c.req.query("to"),limit:c.req.query("limit")})}));
securityCameraGovernanceRoutes.get("/notification-policies",...read,async c=>c.json({data:await G.listPolicies(c.env.FINANCE_DB,c.get("principal").organizationId)}));
securityCameraGovernanceRoutes.post("/notification-policies",...manage,async c=>{const p=c.get("principal");return c.json({data:await G.savePolicy(c.env.FINANCE_DB,p.organizationId,p.userId,await json(c))},201)});
securityCameraGovernanceRoutes.get("/notification-queue",...read,async c=>c.json({data:await G.listQueue(c.env.FINANCE_DB,c.get("principal").organizationId,c.req.query("status")||undefined,Number(c.req.query("limit"))||250)}));
securityCameraGovernanceRoutes.get("/server-update-policies",...read,async c=>c.json({data:await G.listServerUpdatePolicies(c.env.FINANCE_DB,c.get("principal").organizationId)}));
securityCameraGovernanceRoutes.post("/servers/:id/update-policy",...manage,async c=>{const p=c.get("principal");return c.json({data:await G.saveServerUpdatePolicy(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"),await json(c))})});
securityCameraGovernanceRoutes.post("/fleet/bulk",...manage,async c=>{const p=c.get("principal"),body=await json(c),result=await G.bulkFleetAction(c.env.FINANCE_DB,p.organizationId,p.userId,body);await auditFromContext(c,"fleet.bulk.completed","camera-fleet",undefined,{action:body.action,requested:body.cameraIds?.length||0,changed:result.changed});return c.json({data:result})});
