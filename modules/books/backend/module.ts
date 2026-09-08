import "./mobile-sync";
import type { BackendModuleDefinition } from "../../backend-types";
import { bookRoutes } from "./routes";
import { processPendingBookMobileIntents } from "./offline-intents";
export const moduleDefinition:BackendModuleDefinition={key:"books",name:"Books",version:"1.1.0",order:35,routes:[{basePath:"/api/v1/books",router:bookRoutes}],scheduled:async env=>{await processPendingBookMobileIntents(env.FINANCE_DB,{limit:25})}};
