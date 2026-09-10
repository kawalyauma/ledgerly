import { Hono } from "hono";
import type { AppVariables, Env } from "../../../../src/types";
import { schoolFeeStructureRoutes } from "./structures";
import { schoolFeeBillingRoutes } from "./billing";
import { schoolFeePaymentRoutes } from "./payments";
import { schoolFeeReportRoutes } from "./reports";
import { schoolFeeReceiptPrintRoutes } from "./receipt-printing";
import { schoolFeeMobileIntentRoutes } from "./mobile-intents";
import { studentFinancialDocumentRoutes } from "./student-financial-documents";
/** School Fees & Billing subledger over Ledgerly AR, payments, journals and contacts. */
export const schoolFeesRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
// Student-aware document routes are registered first so the canonical receipt PDF path
// uses the student identity/photo renderer while the legacy archive/print-request routes
// continue to own receipt snapshotting and audit history.
schoolFeesRoutes.route("/",studentFinancialDocumentRoutes);
schoolFeesRoutes.route("/",schoolFeeStructureRoutes);schoolFeesRoutes.route("/",schoolFeeBillingRoutes);schoolFeesRoutes.route("/",schoolFeePaymentRoutes);schoolFeesRoutes.route("/",schoolFeeReportRoutes);schoolFeesRoutes.route("/",schoolFeeReceiptPrintRoutes);schoolFeesRoutes.route("/",schoolFeeMobileIntentRoutes);
