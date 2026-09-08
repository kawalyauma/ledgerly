import type {HrDepartment,HrEmployee,HrPerson} from "./types";
export const localDate=()=>{const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`};
export const err=(e:any)=>e?.message||"Request failed. Check your network and permissions.";
export const tone=(status?:string):"neutral"|"good"|"warn"|"bad"=>["active","approved","completed"].includes(String(status))?"good":["pending","on_leave"].includes(String(status))?"warn":["rejected","terminated","suspended","inactive"].includes(String(status))?"bad":"neutral";
export const employeeOptions=(rows:HrEmployee[])=>rows.map(x=>({label:x.name||x.employeeNumber,value:x.id,detail:[x.employeeNumber,x.jobTitle,x.departmentName].filter(Boolean).join(" · ")}));
export const departmentOptions=(rows:HrDepartment[])=>rows.filter(x=>x.active).map(x=>({label:x.name,value:x.id,detail:x.code}));
export const personOptions=(rows:HrPerson[])=>rows.map(x=>({label:x.name,value:x.sourceId,detail:[x.code,x.sourceModule,x.email].filter(Boolean).join(" · ")}));
export const employmentTypeLabel=(value:string)=>value.replaceAll("_"," ").replace(/\b\w/g,m=>m.toUpperCase());
