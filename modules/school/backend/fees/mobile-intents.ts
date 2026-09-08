import { Hono } from "hono";
import type { AppVariables,Env } from "../../../../src/types";
import { requireScope } from "../../../../src/lib/auth";
import { schoolPermission } from "../common";
import { processOfflineFeeReceiptIntent,processPendingOfflineFeeReceipts } from "./offline-intents";
export const schoolFeeMobileIntentRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
schoolFeeMobileIntentRoutes.use("*",requireScope("school:write"),schoolPermission("school.fees:write"));
schoolFeeMobileIntentRoutes.post("/mobile-intents/:id/process",async c=>{const p=c.get("principal");return c.json({data:await processOfflineFeeReceiptIntent(c.env.FINANCE_DB,p.organizationId,c.req.param("id"),p.userId)})});
schoolFeeMobileIntentRoutes.post("/mobile-intents/process-pending",async c=>{const p=c.get("principal");return c.json({data:await processPendingOfflineFeeReceipts(c.env.FINANCE_DB,50,p.organizationId)})});
