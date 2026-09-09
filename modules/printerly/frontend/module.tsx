import { Printer } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { PrinterlyWorkspace } from "./PrinterlyWorkspace";
import { PrinterlyOperationsWorkspace } from "./PrinterlyOperationsWorkspace";
import { PrinterlyReportsWorkspace } from "./PrinterlyReportsWorkspace";
import { PrinterlyQuotaWorkspace } from "./PrinterlyQuotaWorkspace";
import { PrinterlyRulesWorkspace } from "./PrinterlyRulesWorkspace";
import { PrintWithPrinterlyAction } from "./PrintWithPrinterlyAction";
import { ScannerlyInboxAction } from "./ScannerlyInboxAction";
import "./printerly.css";

const moduleDefinition:FrontendModuleDefinition={
  key:"printerly",name:"Printerly",version:"1.5.0",order:42,
  routes:{printerly:{view:PrinterlyWorkspace},"printerly-operations":{view:PrinterlyOperationsWorkspace},"printerly-reports":{view:PrinterlyReportsWorkspace},"printerly-quotas":{view:PrinterlyQuotaWorkspace,admin:true},"printerly-rules":{view:PrinterlyRulesWorkspace}},
  navigation:[{label:"Printerly",icon:Printer,order:42,items:[{label:"Print Center",path:"printerly"},{label:"Operations & Scannerly",path:"printerly-operations"},{label:"Usage Reports",path:"printerly-reports"},{label:"Quotas & Governance",path:"printerly-quotas",admin:true},{label:"Rules & Approvals",path:"printerly-rules"}]}],
  globalActions:[
    {key:"printerly-global-print",label:"Print with Printerly",order:42,component:PrintWithPrinterlyAction},
    {key:"printerly-global-scannerly",label:"Scannerly",order:43,component:ScannerlyInboxAction}
  ]
};
export default moduleDefinition;
