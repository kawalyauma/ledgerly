import { Hono } from "hono";
import type { AppVariables, Env } from "../../../../src/types";
import { schoolFeeStructureRoutes } from "./structures";
import { schoolFeeBillingRoutes } from "./billing";
import { schoolFeePaymentRoutes } from "./payments";
import { schoolFeeReportRoutes } from "./reports";
import { schoolFeeReceiptPrintRoutes } from "./receipt-printing";
import { schoolFeeMobileIntentRoutes } from "./mobile-intents";
/** School Fees & Billing subledger over Ledgerly AR, payments, journals and contacts. */
export const schoolFeesRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
schoolFeesRoutes.route("/",schoolFeeStructureRoutes);schoolFeesRoutes.route("/",schoolFeeBillingRoutes);schoolFeesRoutes.route("/",schoolFeePaymentRoutes);schoolFeesRoutes.route("/",schoolFeeReportRoutes);schoolFeesRoutes.route("/",schoolFeeReceiptPrintRoutes);schoolFeesRoutes.route("/",schoolFeeMobileIntentRoutes);
