import "./mobile-sync";
import type { BackendModuleDefinition } from "../../backend-types";
import { communicationRoutes } from "./routes";
import { consumeCommunicationQueue, runScheduledCampaigns } from "./service";

export const moduleDefinition: BackendModuleDefinition={
  key:"communications",
  name:"Messages & Notifications",
  version:"1.1.0",
  order:20,
  routes:[{basePath:"/api/v1/communications",router:communicationRoutes}],
  queues:{"ledgerly-communications":(batch,env)=>consumeCommunicationQueue(batch,env)},
  scheduled:async(env,controller)=>{if(!controller||controller.cron==="*/5 * * * *")await runScheduledCampaigns(env)}
};
