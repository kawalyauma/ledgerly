import { MessageSquareMore } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { CommunicationsWorkspace } from "./CommunicationsWorkspace";
import "./communications.css";
const moduleDefinition:FrontendModuleDefinition={key:"communications",name:"Messages & Notifications",version:"1.0.0",order:20,routes:{communications:{view:CommunicationsWorkspace}},navigation:[{label:"Messages & Notifications",icon:MessageSquareMore,order:20,items:[{label:"Messages & Notifications",path:"communications"}]}]};
export default moduleDefinition;
