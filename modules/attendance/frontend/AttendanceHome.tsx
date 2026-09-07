import { AttendanceWorkspace } from "./AttendanceWorkspace";

export function AttendanceHome(){
  if(sessionStorage.getItem("ledgerly.attendance.view")==="devices")sessionStorage.setItem("ledgerly.attendance.view","dashboard");
  return <AttendanceWorkspace/>;
}
