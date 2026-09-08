import { Printer } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { PrinterlyWorkspace } from "./PrinterlyWorkspace";
import "./printerly.css";

const moduleDefinition:FrontendModuleDefinition={
  key:"printerly",name:"Printerly",version:"1.0.0",order:42,
  routes:{printerly:{scope:"school:read",view:PrinterlyWorkspace}},
  navigation:[{label:"Printerly",icon:Printer,order:42,items:[{label:"Print Center",path:"printerly",scope:"school:read"}]}],
};
export default moduleDefinition;
