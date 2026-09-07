import type { BackendModuleDefinition } from "../../backend-types";
import { payrollRoutes } from "../../../src/routes/payroll";
import { paymentsRoutes } from "../../../src/routes/payments";
export const moduleDefinition:BackendModuleDefinition={key:"payroll-payments",name:"Payroll & Payments",version:"1.0.0",order:24,routes:[{basePath:"/api/v1/payroll",router:payrollRoutes},{basePath:"/api/v1/payments",router:paymentsRoutes}]};
