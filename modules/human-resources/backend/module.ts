import type { BackendModuleDefinition } from "../../backend-types";
import { humanResourcesRoutes } from "./routes";

export const moduleDefinition: BackendModuleDefinition = { key:"human-resources",name:"Human Resources",version:"1.0.0",order:22,routes:[{basePath:"/api/v1/human-resources",router:humanResourcesRoutes}] };
