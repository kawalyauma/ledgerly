import type { FrontendModuleDefinition } from "../../frontend-types";
import { Bot } from "lucide-react";
import { AiWorkforceMainWorkspace } from "./AiWorkforceMainWorkspace";
import { AiDocumentsMainWorkspace } from "./AiDocumentsMainWorkspace";
import "./ai-workforce.css";

const standardSections=["employees","roles","tasks","tools","knowledge","memory","activity","audit","settings"] as const;
const routes:FrontendModuleDefinition["routes"]={
 ...Object.fromEntries(standardSections.map((section)=>[`ai-workforce/${section}`,{scope:"ai:read",view:AiWorkforceMainWorkspace}])),
 "ai-workforce/approvals":{scope:"ai:approve",view:AiWorkforceMainWorkspace},
 "ai-workforce/schedules":{scope:"ai:approve",view:AiWorkforceMainWorkspace},
 "ai-workforce/documents":{scope:"documents:read",view:AiDocumentsMainWorkspace},
};
const moduleDefinition:FrontendModuleDefinition={
 key:"ai-workforce",name:"AI Workforce",version:"1.0.0",order:72,
 routes,
 navigation:[{label:"AI Workforce",icon:Bot,order:72,items:[
  {label:"Employees",path:"ai-workforce/employees",scope:"ai:read"},
  {label:"Roles",path:"ai-workforce/roles",scope:"ai:read"},
  {label:"Tasks",path:"ai-workforce/tasks",scope:"ai:read"},
  {label:"Tools",path:"ai-workforce/tools",scope:"ai:read"},
  {label:"Approvals",path:"ai-workforce/approvals",scope:"ai:approve"},
  {label:"Documents",path:"ai-workforce/documents",scope:"documents:read"},
  {label:"Knowledge",path:"ai-workforce/knowledge",scope:"ai:read"},
  {label:"Memory",path:"ai-workforce/memory",scope:"ai:read"},
  {label:"Schedules",path:"ai-workforce/schedules",scope:"ai:approve"},
  {label:"Activity",path:"ai-workforce/activity",scope:"ai:read"},
  {label:"Audit",path:"ai-workforce/audit",scope:"ai:read"},
  {label:"Settings",path:"ai-workforce/settings",scope:"ai:read"}
 ]}],
};
export default moduleDefinition;
