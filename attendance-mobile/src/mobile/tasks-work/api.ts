import type {MobileSession} from "../auth";
import {ledgerlyRequest,query,type SessionUpdater} from "../apiClient";
import type {NotificationPreference,WorkChat,WorkDashboard,WorkMember,WorkNotification,WorkProject,WorkTask,WorkTeam} from "./types";
type Client={session:MobileSession;onSession?:SessionUpdater};
const req=<T>(c:Client,path:string,init:RequestInit={})=>ledgerlyRequest<T>(c.session,path,init,c.onSession);
const json=(method:string,body?:unknown):RequestInit=>({method,headers:{"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
const yes=(v:any)=>v===true||v===1||v==="1";
const task=(x:any):WorkTask=>({...x,id:String(x.id),taskNumber:String(x.taskNumber||x.task_number||""),progress:Number(x.progress||0),actualMinutes:Number(x.actualMinutes||x.actual_minutes||0),estimatedMinutes:x.estimatedMinutes==null?null:Number(x.estimatedMinutes),checklistTotal:Number(x.checklistTotal||0),checklistCompleted:Number(x.checklistCompleted||0),commentCount:Number(x.commentCount||0)});
const project=(x:any):WorkProject=>({...x,id:String(x.id),progress:Number(x.progress||0),taskCount:Number(x.taskCount||0),memberCount:Number(x.memberCount||0)});
export const workApi={
  manifest:(c:Client)=>req<any>(c,"/work/manifest"),
  organization:(c:Client)=>req<any>(c,"/work/organization"),
  members:async(c:Client)=>(await req<any[]>(c,"/work/members")).map(x=>({...x,isTeacher:yes(x.isTeacher)} as WorkMember)),
  dashboard:async(c:Client)=>{const d=await req<any>(c,"/work/dashboard");return {...d,tasks:{...d.tasks,total:Number(d.tasks?.total||0),completed:Number(d.tasks?.completed||0),inProgress:Number(d.tasks?.inProgress||0),blocked:Number(d.tasks?.blocked||0),overdue:Number(d.tasks?.overdue||0)},projects:{...d.projects,total:Number(d.projects?.total||0),active:Number(d.projects?.active||0),completed:Number(d.projects?.completed||0)},myDue:(d.myDue||[]).map(task),recent:(d.recent||[]).map(task),unreadNotifications:Number(d.unreadNotifications||0),myMinutesLast7Days:Number(d.myMinutesLast7Days||0)} as WorkDashboard},
  contacts:async(c:Client,search="")=>{const d=await req<any>(c,`/work/contacts${query({search,limit:300})}`);return d.items||[]},
  teams:(c:Client)=>req<WorkTeam[]>(c,"/work/teams"),
  team:(c:Client,id:string)=>req<any>(c,`/work/teams/${id}`),
  createTeam:(c:Client,body:any)=>req<any>(c,"/work/teams",json("POST",body)),
  updateTeam:(c:Client,id:string,body:any)=>req<any>(c,`/work/teams/${id}`,json("PATCH",body)),
  addTeamMember:(c:Client,id:string,userId:string,role:string)=>req<any>(c,`/work/teams/${id}/members`,json("POST",{userId,role})),
  removeTeamMember:(c:Client,id:string,userId:string)=>req<any>(c,`/work/teams/${id}/members/${userId}`,{method:"DELETE"}),
  archiveTeam:(c:Client,id:string)=>req<any>(c,`/work/teams/${id}`,{method:"DELETE"}),
  projects:async(c:Client,params:{status?:string;teamId?:string;search?:string}={})=>{const d=await req<any>(c,`/work/projects${query({...params,limit:300})}`);return (d.items||[]).map(project) as WorkProject[]},
  project:async(c:Client,id:string)=>{const d=await req<any>(c,`/work/projects/${id}`);return {...project(d),tasks:(d.tasks||[]).map(task)} as WorkProject},
  createProject:(c:Client,body:any)=>req<any>(c,"/work/projects",json("POST",body)),
  updateProject:(c:Client,id:string,body:any)=>req<any>(c,`/work/projects/${id}`,json("PATCH",body)),
  addProjectMember:(c:Client,id:string,userId:string,role:string)=>req<any>(c,`/work/projects/${id}/members`,json("POST",{userId,role})),
  removeProjectMember:(c:Client,id:string,userId:string)=>req<any>(c,`/work/projects/${id}/members/${userId}`,{method:"DELETE"}),
  archiveProject:(c:Client,id:string)=>req<any>(c,`/work/projects/${id}`,{method:"DELETE"}),
  tasks:async(c:Client,params:{status?:string;projectId?:string;assigneeId?:string;parentTaskId?:string;search?:string}={})=>{const d=await req<any>(c,`/work/tasks${query({...params,limit:400})}`);return (d.items||[]).map(task) as WorkTask[]},
  task:async(c:Client,id:string)=>{const d=await req<any>(c,`/work/tasks/${id}`);return {...task(d),assignees:d.assignees||[],followers:d.followers||[],checklist:d.checklist||[],comments:d.comments||[],timeEntries:d.timeEntries||[],subtasks:(d.subtasks||[]).map(task)} as WorkTask},
  createTask:(c:Client,body:any)=>req<any>(c,"/work/tasks",json("POST",body)),
  updateTask:(c:Client,id:string,body:any)=>req<WorkTask>(c,`/work/tasks/${id}`,json("PATCH",body)),
  updateTaskStatus:(c:Client,id:string,status:string)=>req<WorkTask>(c,`/work/tasks/${id}/status`,json("PATCH",{status})),
  archiveTask:(c:Client,id:string)=>req<any>(c,`/work/tasks/${id}`,{method:"DELETE"}),
  addAssignee:(c:Client,id:string,userId:string)=>req<any>(c,`/work/tasks/${id}/assignees`,json("POST",{userId})),
  removeAssignee:(c:Client,id:string,userId:string)=>req<any>(c,`/work/tasks/${id}/assignees/${userId}`,{method:"DELETE"}),
  addFollower:(c:Client,id:string,userId:string)=>req<any>(c,`/work/tasks/${id}/followers`,json("POST",{userId})),
  removeFollower:(c:Client,id:string,userId:string)=>req<any>(c,`/work/tasks/${id}/followers/${userId}`,{method:"DELETE"}),
  addChecklist:(c:Client,id:string,title:string)=>req<any>(c,`/work/tasks/${id}/checklist`,json("POST",{title})),
  updateChecklist:(c:Client,taskId:string,id:string,body:any)=>req<any>(c,`/work/tasks/${taskId}/checklist/${id}`,json("PATCH",body)),
  deleteChecklist:(c:Client,taskId:string,id:string)=>req<any>(c,`/work/tasks/${taskId}/checklist/${id}`,{method:"DELETE"}),
  addComment:(c:Client,id:string,body:string,mentionUserIds:string[]=[])=>req<any>(c,`/work/tasks/${id}/comments`,json("POST",{body,mentionUserIds})),
  deleteComment:(c:Client,taskId:string,id:string)=>req<any>(c,`/work/tasks/${taskId}/comments/${id}`,{method:"DELETE"}),
  addTime:(c:Client,id:string,body:any)=>req<any>(c,`/work/tasks/${id}/time-entries`,json("POST",body)),
  deleteTime:(c:Client,taskId:string,id:string)=>req<any>(c,`/work/tasks/${taskId}/time-entries/${id}`,{method:"DELETE"}),
  notifications:async(c:Client,unread=false)=>{const d=await req<any>(c,`/work/notifications${query({unread,limit:250})}`);return (d.items||[]) as WorkNotification[]},
  readNotification:(c:Client,id:string)=>req<any>(c,`/work/notifications/${id}/read`,json("POST",{})),
  readAllNotifications:(c:Client)=>req<any>(c,"/work/notifications/read-all",json("POST",{})),
  notificationPreferences:async(c:Client)=>(await req<any[]>(c,"/work/notification-preferences")).map(x=>({...x,inApp:yes(x.inApp),email:yes(x.email),sms:yes(x.sms),whatsapp:yes(x.whatsapp)}) as NotificationPreference),
  updateNotificationPreference:(c:Client,eventType:string,body:any)=>req<NotificationPreference>(c,`/work/notification-preferences/${encodeURIComponent(eventType)}`,json("PUT",body)),
  chats:async(c:Client,search="")=>{const d=await req<any>(c,`/work/chats${query({search})}`);return {items:(d.items||[]) as WorkChat[],unread:Number(d.unread||0)}},
  chat:(c:Client,id:string)=>req<WorkChat>(c,`/work/chats/${id}`),
  createChat:(c:Client,body:any)=>req<any>(c,"/work/chats",json("POST",body)),
  sendChat:(c:Client,id:string,body:string,whatsapp=false)=>req<any>(c,`/work/chats/${id}/messages`,json("POST",{body,whatsapp})),
  uploadChatAttachment:(c:Client,id:string,file:{uri:string;name:string;mimeType:string},caption="")=>{const form=new FormData();form.append("file",{uri:file.uri,name:file.name,type:file.mimeType||"application/octet-stream"} as any);if(caption.trim())form.append("caption",caption.trim());return req<any>(c,`/work/chats/${id}/attachments`,{method:"POST",body:form})},
  closeChat:(c:Client,id:string)=>req<any>(c,`/work/chats/${id}/close`,json("POST",{})),
  audit:(c:Client)=>req<any[]>(c,"/work/audit?limit=200"),
};
