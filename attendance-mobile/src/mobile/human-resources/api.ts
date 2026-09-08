import type {MobileSession} from "../auth";
import {ledgerlyRequest,type SessionUpdater} from "../apiClient";
import type {HrAuditEntry,HrDashboard,HrDepartment,HrEmployee,HrLeaveRequest,HrLeaveType,HrManifest,HrOnboardingTask,HrPerson} from "./types";

type Client={session:MobileSession;onSession?:SessionUpdater};
const req=<T>(c:Client,path:string,init:RequestInit={})=>ledgerlyRequest<T>(c.session,`/human-resources${path}`,init,c.onSession);
const json=(method:string,body?:unknown):RequestInit=>({method,body:body===undefined?undefined:JSON.stringify(body)});
const bool=(v:any)=>v===true||v===1||v==="1";
const employee=(x:any):HrEmployee=>({id:String(x.id),userId:x.userId??x.user_id??null,contactId:x.contactId??x.contact_id??null,schoolStaffId:x.schoolStaffId??x.school_staff_id??null,departmentId:x.departmentId??x.department_id??null,employeeNumber:String(x.employeeNumber??x.employee_number??""),jobTitle:x.jobTitle??x.job_title??null,employmentType:String(x.employmentType??x.employment_type??"permanent"),employmentStatus:String(x.employmentStatus??x.employment_status??"active"),hireDate:String(x.hireDate??x.hire_date??""),terminationDate:x.terminationDate??x.termination_date??null,managerEmployeeId:x.managerEmployeeId??x.manager_employee_id??null,workEmail:x.workEmail??x.work_email??null,workPhone:x.workPhone??x.work_phone??null,name:x.name??null,email:x.email??null,phone:x.phone??null,departmentName:x.departmentName??x.department_name??null,managerNumber:x.managerNumber??x.manager_number??null,metadata:x.metadata??{},createdAt:x.createdAt??x.created_at,updatedAt:x.updatedAt??x.updated_at});
const department=(x:any):HrDepartment=>({id:String(x.id),code:String(x.code||""),name:String(x.name||""),managerEmployeeId:x.managerEmployeeId??x.manager_employee_id??null,active:bool(x.active)});
const leaveType=(x:any):HrLeaveType=>({id:String(x.id),code:String(x.code||""),name:String(x.name||""),paid:bool(x.paid),annualDays:Number(x.annualDays??(x.annual_days_micros!=null?Number(x.annual_days_micros)/1e6:0)),active:bool(x.active)});
const leave=(x:any):HrLeaveRequest=>({id:String(x.id),employeeId:String(x.employeeId??x.employee_id??""),employeeNumber:x.employeeNumber??x.employee_number,employeeName:x.employeeName??x.employee_name,leaveType:x.leaveType??x.leave_type,startsOn:String(x.startsOn??x.starts_on??""),endsOn:String(x.endsOn??x.ends_on??""),days:Number(x.days??0),reason:x.reason??null,status:String(x.status||"pending"),reviewNotes:x.reviewNotes??x.review_notes??null,createdAt:x.createdAt??x.created_at});
const task=(x:any):HrOnboardingTask=>({id:String(x.id),employeeId:String(x.employeeId??x.employee_id??""),employeeNumber:x.employeeNumber??x.employee_number,title:String(x.title||""),dueDate:x.dueDate??x.due_date??null,status:String(x.status||"pending"),assignedUserId:x.assignedUserId??x.assigned_user_id??null,completedAt:x.completedAt??x.completed_at??null,createdAt:x.createdAt??x.created_at,updatedAt:x.updatedAt??x.updated_at});

export const humanResourcesApi={
  manifest:(c:Client)=>req<HrManifest>(c,"/manifest"),
  dashboard:(c:Client)=>req<HrDashboard>(c,"/dashboard"),
  people:(c:Client)=>req<HrPerson[]>(c,"/people"),
  employees:async(c:Client)=>(await req<any[]>(c,"/employees")).map(employee),
  createEmployee:async(c:Client,body:any)=>employee(await req<any>(c,"/employees",json("POST",body))),
  updateEmployee:async(c:Client,id:string,body:any)=>employee(await req<any>(c,`/employees/${id}`,json("PATCH",body))),
  departments:async(c:Client)=>(await req<any[]>(c,"/departments")).map(department),
  createDepartment:async(c:Client,body:any)=>department(await req<any>(c,"/departments",json("POST",body))),
  updateDepartment:async(c:Client,id:string,body:any)=>department(await req<any>(c,`/departments/${id}`,json("PATCH",body))),
  leaveTypes:async(c:Client)=>(await req<any[]>(c,"/leave-types")).map(leaveType),
  createLeaveType:async(c:Client,body:any)=>leaveType(await req<any>(c,"/leave-types",json("POST",body))),
  updateLeaveType:async(c:Client,id:string,body:any)=>leaveType(await req<any>(c,`/leave-types/${id}`,json("PATCH",body))),
  leaveRequests:async(c:Client)=>(await req<any[]>(c,"/leave-requests")).map(leave),
  createLeaveRequest:async(c:Client,body:any)=>leave(await req<any>(c,"/leave-requests",json("POST",body))),
  decideLeave:(c:Client,id:string,decision:"approve"|"reject",notes?:string)=>req<{id:string;status:string}>(c,`/leave-requests/${id}/review`,json("POST",{decision,notes:notes||undefined})),
  onboarding:async(c:Client)=>(await req<any[]>(c,"/onboarding")).map(task),
  createOnboarding:async(c:Client,body:any)=>task(await req<any>(c,"/onboarding",json("POST",body))),
  setOnboardingStatus:async(c:Client,id:string,status:"pending"|"completed")=>task(await req<any>(c,`/onboarding/${id}/status`,json("PATCH",{status}))),
  audit:(c:Client,limit=30)=>req<HrAuditEntry[]>(c,`/audit?limit=${Math.min(200,Math.max(1,limit))}`),
};
