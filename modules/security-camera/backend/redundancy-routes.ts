// @ts-nocheck
import {Hono} from "hono";
import type {AppVariables,Env} from "../../../src/types";
import {requireModuleEnabled} from "../../../src/lib/modules";
import {securityRead,securityManage} from "./security-scope";
import * as R from "./redundancy-service";
import * as D from "./readiness-service";
import {listBackupStatus} from "./backup-service";
export const securityCameraRedundancyRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
const json=async(c:any)=>c.req.json<Record<string,any>>().catch(()=>({}));
const read=[requireModuleEnabled("security-camera"),securityRead],manage=[requireModuleEnabled("security-camera"),securityManage];
securityCameraRedundancyRoutes.get("/redundancy",...read,async c=>{const org=c.get("principal").organizationId;const[configs,events,validation,backups,readiness]=await Promise.all([R.listRedundancy(c.env.FINANCE_DB,org),R.listFailoverEvents(c.env.FINANCE_DB,org,200),R.validationSummary(c.env.FINANCE_DB,org),listBackupStatus(c.env.FINANCE_DB,org),D.deploymentReadiness(c.env.FINANCE_DB,org)]);return c.json({data:{configs,events,validation,backups,readiness}})});
securityCameraRedundancyRoutes.get("/readiness",...read,async c=>c.json({data:await D.deploymentReadiness(c.env.FINANCE_DB,c.get("principal").organizationId)}));
securityCameraRedundancyRoutes.post("/recovery-drill",...manage,async c=>c.json({data:await D.recoveryDrill(c.env.FINANCE_DB,c.get("principal").organizationId)}));
securityCameraRedundancyRoutes.post("/cameras/:id/redundancy",...manage,async c=>{const p=c.get("principal");return c.json({data:await R.saveRedundancy(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"),await json(c))})});
securityCameraRedundancyRoutes.post("/cameras/:id/failover",...manage,async c=>{const p=c.get("principal"),b=await json(c),target=b.target==="secondary"?"secondary":"primary";return c.json({data:await R.manualFailover(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"),target,b.reason)})});
