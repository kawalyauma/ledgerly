import { ScanFace } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { AttendanceHome } from "./AttendanceHome";
import { DevicesPage } from "./DevicesPage";
import "./attendance.css";

const moduleDefinition:FrontendModuleDefinition={
  key:"attendance",name:"Attendance",version:"1.3.0",order:26,
  routes:{
    attendance:{scope:"school:read",view:AttendanceHome},
    "attendance-kiosks":{scope:"school:read",view:DevicesPage}
  },
  navigation:[{label:"Attendance",icon:ScanFace,order:26,items:[
    {label:"Attendance",path:"attendance",scope:"school:read"},
    {label:"Devices & kiosks",path:"attendance-kiosks",scope:"school:read"}
  ]}]
};
export default moduleDefinition;
