import { Camera } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { SecurityCameraWorkspace } from "./SecurityCameraWorkspace";
import { SecurityCameraArchive } from "./SecurityCameraArchive";
import { SecurityCameraOperations } from "./SecurityCameraOperations";
import { SecurityCameraEvents } from "./SecurityCameraEvents";
import { SecurityCameraWall } from "./SecurityCameraWall";
import { SecurityCameraFleet } from "./SecurityCameraFleet";
import "./security-camera.css";
import "./live.css";
import "./operations.css";
import "./events.css";
import "./fleet-wall.css";

const moduleDefinition:FrontendModuleDefinition={
  key:"security-camera",name:"Security Cameras",version:"0.8.0",order:43,
  routes:{
    "security-camera":{scope:"school:read",view:SecurityCameraWorkspace},
    "security-camera-wall":{scope:"school:read",view:SecurityCameraWall},
    "security-camera-events":{scope:"school:read",view:SecurityCameraEvents},
    "security-camera-archive":{scope:"school:read",view:SecurityCameraArchive},
    "security-camera-fleet":{scope:"school:read",view:SecurityCameraFleet},
    "security-camera-operations":{scope:"school:read",view:SecurityCameraOperations},
  },
  navigation:[{label:"Security",icon:Camera,order:43,items:[
    {label:"Cameras",path:"security-camera",scope:"school:read"},
    {label:"Monitor wall",path:"security-camera-wall",scope:"school:read"},
    {label:"Events",path:"security-camera-events",scope:"school:read"},
    {label:"Archive",path:"security-camera-archive",scope:"school:read"},
    {label:"Fleet",path:"security-camera-fleet",scope:"school:read"},
    {label:"Operations",path:"security-camera-operations",scope:"school:read"},
  ]}],
};
export default moduleDefinition;
