import { HandCoins } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { PayrollPaymentsPage } from "./PayrollPaymentsPage";
const moduleDefinition:FrontendModuleDefinition={key:"payroll-payments",name:"Payroll & Payments",version:"1.0.0",order:24,routes:{payroll:{scope:"payroll:read",view:()=> <PayrollPaymentsPage view="payroll"/>},payments:{scope:"payments:read",view:()=> <PayrollPaymentsPage view="payments"/>}},navigation:[{label:"Payroll & Payments",icon:HandCoins,order:24,items:[{label:"Payroll",path:"payroll",scope:"payroll:read"},{label:"Payments",path:"payments",scope:"payments:read"}]}]};
export default moduleDefinition;
