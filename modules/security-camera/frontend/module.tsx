import { Camera } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { SecurityCameraWorkspace } from "./SecurityCameraWorkspace";
import "./security-camera.css";
import "./live.css";

const moduleDefinition:FrontendModuleDefinition={
  key:"security-camera",name:"Security Cameras",version:"0.5.0",order:43,
  routes:{"security-camera":{scope:"school:read",view:SecurityCameraWorkspace}},
  navigation:[{label:"Security",icon:Camera,order:43,items:[{label:"Cameras",path:"security-camera",scope:"school:read"}]}],
};
export default moduleDefinition;
