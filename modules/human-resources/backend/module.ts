import './mobile-sync';
import type { BackendModuleDefinition } from "../../backend-types";
import { humanResourcesRoutes } from "./routes";
import { humanResourcesOnboardingWorkflowRoutes } from "./onboarding-workflow";
import { humanResourcesAdminWorkflowRoutes } from "./admin-workflow";
import { humanResourcesAuditWorkflowRoutes } from "./audit-workflow";
import {processPendingHrMobileIntents} from './mobile-intents';
export const moduleDefinition: BackendModuleDefinition = {key:"human-resources",name:"Human Resources",version:"1.0.0",order:22,routes:[{basePath:"/api/v1/human-resources",router:humanResourcesRoutes},{basePath:"/api/v1/human-resources",router:humanResourcesOnboardingWorkflowRoutes},{basePath:"/api/v1/human-resources",router:humanResourcesAdminWorkflowRoutes},{basePath:"/api/v1/human-resources",router:humanResourcesAuditWorkflowRoutes}],scheduled:async env=>{await processPendingHrMobileIntents(env.FINANCE_DB,{limit:50})}};
