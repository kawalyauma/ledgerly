import { Camera } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { SecurityCameraWorkspace } from "./SecurityCameraWorkspace";
import { SecurityCameraArchive } from "./SecurityCameraArchive";
import { SecurityCameraOperations } from "./SecurityCameraOperations";
import "./security-camera.css";
import "./live.css";
import "./operations.css";

const moduleDefinition:FrontendModuleDefinition={
  key:"security-camera",name:"Security Cameras",version:"0.6.0",order:43,
  routes:{
    "security-camera":{scope:"school:read",view:SecurityCameraWorkspace},
    "security-camera-archive":{scope:"school:read",view:SecurityCameraArchive},
    "security-camera-operations":{scope:"school:read",view:SecurityCameraOperations},
  },
  navigation:[{label:"Security",icon:Camera,order:43,items:[
    {label:"Cameras",path:"security-camera",scope:"school:read"},
    {label:"Archive",path:"security-camera-archive",scope:"school:read"},
    {label:"Operations",path:"security-camera-operations",scope:"school:read"},
  ]}],
};
export default moduleDefinition;
