import { Phone } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { AudioCallsWorkspace } from "./AudioCallsWorkspace";
import { AudioCallGlobalAction } from "./AudioCallGlobalAction";
import "./audio-calls.css";
import "./audio-calls-availability.css";

const moduleDefinition:FrontendModuleDefinition={
  key:"audio-calls",
  name:"Audio Calls",
  version:"1.1.0",
  order:18,
  routes:{"audio-calls":{scope:"audio-calls:read",view:AudioCallsWorkspace}},
  navigation:[{label:"Calls",icon:Phone,order:18,items:[{label:"Audio Calls",path:"audio-calls",scope:"audio-calls:read"}]}],
  globalActions:[{key:"audio-calls-global",label:"Audio Calls",order:18,scope:"audio-calls:read",component:AudioCallGlobalAction}],
};
export default moduleDefinition;
