import type { BackendModuleDefinition } from "../../backend-types";
import { audioCallRoutes } from "./routes";
import { expireStaleCalls } from "./policy";

export const moduleDefinition:BackendModuleDefinition={
  key:"audio-calls",
  name:"Audio Calls",
  version:"1.1.0",
  order:18,
  routes:[{basePath:"/api/v1/audio-calls",router:audioCallRoutes}],
  scheduled:async env=>{
    // The global Worker already runs every minute. This keeps ringing/accepted calls,
    // participant locks, presence and short-lived signaling self-healing after crashes.
    await expireStaleCalls(env,250);
  }
};
