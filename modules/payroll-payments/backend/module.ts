import "./mobile-sync";
import type { BackendModuleDefinition } from "../../backend-types";
import { payrollRoutes } from "../../../src/routes/payroll";
import { paymentsRoutes } from "../../../src/routes/payments";
import { processPendingPaymentMobileIntents } from "./mobile-intents";
import { payrollWorkflowRoutes,paymentsWorkflowRoutes } from "./workflow";
import { paymentsDetailRoutes } from "./payment-details";
import { payrollStatutoryRoutes } from "./statutory-workflow";
import { payrollSalaryIntegrityRoutes,paymentsSalaryIntegrityRoutes } from "./salary-payment-integrity";
import { payrollRunReversalIntegrityRoutes } from "./run-reversal-integrity";

export const moduleDefinition:BackendModuleDefinition={
  key:"payroll-payments",
  name:"Payroll & Payments",
  version:"1.0.0",
  order:24,
  routes:[
    {basePath:"/api/v1/payroll",router:payrollRoutes},
    {basePath:"/api/v1/payroll",router:payrollWorkflowRoutes},
    {basePath:"/api/v1/payroll",router:payrollStatutoryRoutes},
    {basePath:"/api/v1/payroll",router:payrollSalaryIntegrityRoutes},
    {basePath:"/api/v1/payroll",router:payrollRunReversalIntegrityRoutes},
    {basePath:"/api/v1/payments",router:paymentsRoutes},
    {basePath:"/api/v1/payments",router:paymentsWorkflowRoutes},
    {basePath:"/api/v1/payments",router:paymentsDetailRoutes},
    {basePath:"/api/v1/payments",router:paymentsSalaryIntegrityRoutes},
  ],
  scheduled:async env=>{await processPendingPaymentMobileIntents(env.FINANCE_DB,{limit:50})},
};
