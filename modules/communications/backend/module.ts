import "./mobile-sync";
import type { BackendModuleDefinition } from "../../backend-types";
import { communicationRoutes } from "./routes";
import { communicationManagementRoutes } from "./management-workflow";
import { communicationAudienceContextRoutes } from "./audience-context";
import { consumeCommunicationQueue, runScheduledCampaigns } from "./service";

export const moduleDefinition: BackendModuleDefinition={
  key:"communications",
  name:"Messages & Notifications",
  version:"1.1.0",
  order:20,
  routes:[
    {basePath:"/api/v1/communications",router:communicationRoutes},
    {basePath:"/api/v1/communications",router:communicationManagementRoutes},
    {basePath:"/api/v1/communications",router:communicationAudienceContextRoutes},
  ],
  queues:{"ledgerly-communications":(batch,env)=>consumeCommunicationQueue(batch,env)},
  scheduled:async(env,controller)=>{if(!controller||controller.cron==="*/5 * * * *")await runScheduledCampaigns(env)}
};
