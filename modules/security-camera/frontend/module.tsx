import { Camera } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { SecurityCameraWorkspace } from "./SecurityCameraWorkspace";
import { SecurityCameraArchive } from "./SecurityCameraArchive";
import { SecurityCameraOperations } from "./SecurityCameraOperations";
import { SecurityCameraEvents } from "./SecurityCameraEvents";
import { SecurityCameraWall } from "./SecurityCameraWall";
import { SecurityCameraFleet } from "./SecurityCameraFleet";
import { SecurityCameraGovernance } from "./SecurityCameraGovernance";
import { SecurityCameraResilience } from "./SecurityCameraResilience";
import { SecurityCameraInbox } from "./SecurityCameraInbox";
import { SecurityCameraIntegrity } from "./SecurityCameraIntegrity";
import "./security-camera.css";
import "./live.css";
import "./operations.css";
import "./events.css";
import "./fleet-wall.css";
import "./governance.css";
import "./resilience.css";
import "./inbox.css";

const moduleDefinition:FrontendModuleDefinition={
  key:"security-camera",name:"Security Cameras",version:"0.16.0",order:43,
  routes:{
    "security-camera":{scope:"school:read",view:SecurityCameraWorkspace},
    "security-camera-wall":{scope:"school:read",view:SecurityCameraWall},
    "security-camera-events":{scope:"school:read",view:SecurityCameraEvents},
    "security-camera-archive":{scope:"school:read",view:SecurityCameraArchive},
    "security-camera-integrity":{scope:"school:read",view:SecurityCameraIntegrity},
    "security-camera-fleet":{scope:"school:read",view:SecurityCameraFleet},
    "security-camera-operations":{scope:"school:read",view:SecurityCameraOperations},
    "security-camera-resilience":{scope:"school:read",view:SecurityCameraResilience},
    "security-camera-inbox":{scope:"school:read",view:SecurityCameraInbox},
    "security-camera-governance":{scope:"school:read",view:SecurityCameraGovernance},
  },
  navigation:[{label:"Security",icon:Camera,order:43,items:[
    {label:"Cameras",path:"security-camera",scope:"school:read"},
    {label:"Monitor wall",path:"security-camera-wall",scope:"school:read"},
    {label:"Events",path:"security-camera-events",scope:"school:read"},
    {label:"Archive",path:"security-camera-archive",scope:"school:read"},
    {label:"Integrity",path:"security-camera-integrity",scope:"school:read"},
    {label:"Fleet",path:"security-camera-fleet",scope:"school:read"},
    {label:"Operations",path:"security-camera-operations",scope:"school:read"},
    {label:"Resilience",path:"security-camera-resilience",scope:"school:read"},
    {label:"Alerts inbox",path:"security-camera-inbox",scope:"school:read"},
    {label:"Governance",path:"security-camera-governance",scope:"school:read"},
  ]}],
};
export default moduleDefinition;
