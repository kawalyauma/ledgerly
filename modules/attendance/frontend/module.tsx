import { ScanFace } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { AttendanceWorkspace } from "./AttendanceWorkspace";
import "./attendance.css";

const moduleDefinition:FrontendModuleDefinition={
  key:"attendance",name:"Attendance",version:"1.2.0",order:26,
  routes:{attendance:{scope:"school:read",view:AttendanceWorkspace}},
  navigation:[{label:"Attendance",icon:ScanFace,order:26,items:[{label:"Attendance",path:"attendance",scope:"school:read"}]}]
};
export default moduleDefinition;
