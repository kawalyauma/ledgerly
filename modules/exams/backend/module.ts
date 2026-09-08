import "./mobile-sync-adapter";
import type { BackendModuleDefinition } from "../../backend-types";
import { examRoutes } from "./routes";
import { examFinalizationRoutes } from "./finalization";
export const moduleDefinition: BackendModuleDefinition = {key:"exams",name:"Examinations",version:"1.0.0",order:30,routes:[{basePath:"/api/v1/exams",router:examRoutes},{basePath:"/api/v1/exams",router:examFinalizationRoutes}]};
