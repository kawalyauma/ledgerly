import {MobileApiError} from "../auth";
import type {WorkMember,WorkProject,WorkTask,WorkTeam} from "./types";
export function err(e:unknown){return e instanceof MobileApiError?e.message:e instanceof Error?e.message:"Something went wrong."}
export function today(){const d=new Date(),p=(n:number)=>String(n).padStart(2,"0");return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`}
export function nowLocal(){const d=new Date(),p=(n:number)=>String(n).padStart(2,"0");return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`}
export function tone(status:string){const v=String(status).toLowerCase();if(["completed","active","read","sent","delivered"].includes(v))return "good" as const;if(["in_progress","in_review","planning","medium","scheduled","queued","todo"].includes(v))return "warn" as const;if(["blocked","cancelled","failed","overdue","urgent"].includes(v))return "bad" as const;return "neutral" as const}
export const memberOptions=(rows:WorkMember[])=>rows.map(x=>({label:x.fullName,value:x.id,detail:[x.staffNumber,x.departmentName,x.role,x.email].filter(Boolean).join(" · ")}));
export const projectOptions=(rows:WorkProject[])=>rows.map(x=>({label:`${x.code} · ${x.name}`,value:x.id,detail:`${x.status} · ${x.priority}`}));
export const teamOptions=(rows:WorkTeam[])=>rows.map(x=>({label:x.name,value:x.id,detail:[x.leadName,x.memberCount!=null?`${x.memberCount} members`:null].filter(Boolean).join(" · ")}));
export const taskOptions=(rows:WorkTask[])=>rows.map(x=>({label:`${x.taskNumber} · ${x.title}`,value:x.id,detail:[x.status,x.priority,x.projectName].filter(Boolean).join(" · ")}));
export const taskStatuses=["backlog","todo","in_progress","blocked","in_review","completed","cancelled"].map(x=>({label:x.replaceAll("_"," "),value:x}));
export const priorities=["low","medium","high","urgent"].map(x=>({label:x,value:x}));
