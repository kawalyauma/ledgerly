import { UsersRound } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { HumanResourcesPage } from "./HumanResourcesPage";
import "./human-resources.css";
const moduleDefinition:FrontendModuleDefinition={key:"human-resources",name:"Human Resources",version:"1.0.0",order:22,routes:{"human-resources":{view:HumanResourcesPage}},navigation:[{label:"Human Resources",icon:UsersRound,order:22,items:[{label:"Human Resources",path:"human-resources"}]}]};
export default moduleDefinition;
