import {MobileSyncStore} from "../../native";
import {localMobileRecord,localMobileRecords,queueMobileMutation} from "../syncEngine";
import type {MobileSyncDependency} from "../syncClient";
import type {AcademicsOverview,AcademicsSetup,Delivery,Inspection,LessonPlan,Observation,Room,Scheme,TeacherAllocation,Timetable,TimetableEntry} from "./types";

type R=Record<string,any>;
const MODULE="academics";
const SCHOOL="school-management";
const camel=(k:string)=>k.replace(/_([a-z])/g,(_,c)=>c.toUpperCase());
const normalize=(value:any):any=>{if(!value||typeof value!=="object"||Array.isArray(value))return value;const out:R={};for(const[k,v]of Object.entries(value))out[camel(k)]=v;return out};
const uid=(prefix:string)=>`${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
export const academicsNetworkError=(e:any)=>e?.code==="NETWORK_ERROR"||e?.status===0;
export async function academicsOfflineFallback<T>(online:()=>Promise<T>,offline:()=>Promise<T>){try{return await online()}catch(e){if(academicsNetworkError(e))return offline();throw e}}

async function pending(collection:string){return(await MobileSyncStore.pendingOperations(250)).filter(x=>x.moduleKey===MODULE&&x.collectionKey===collection)}
async function recordsWithPending(collection:string){
 const rows=await localMobileRecords<R>(MODULE,collection,1000,0),map=new Map<string,R>();
 for(const row of rows)map.set(row.id,{...normalize(row.payload||{}),id:row.id});
 for(const op of await pending(collection)){
  if(op.kind==="delete"){map.delete(op.recordId);continue}
  let patch:R={};try{patch=normalize(op.payloadJson?JSON.parse(op.payloadJson):{})}catch{}
  map.set(op.recordId,{...(map.get(op.recordId)||{id:op.recordId}),...patch,id:op.recordId});
 }
 return[...map.values()];
}
async function recordWithPending(collection:string,id:string){return(await recordsWithPending(collection)).find(x=>x.id===id)||null}
async function dependencyFor(collection:string,recordId:string):Promise<MobileSyncDependency[]>{const op=(await pending(collection)).find(x=>x.recordId===recordId&&x.kind==="upsert");return op?[{operationId:op.operationId}]:[{moduleKey:MODULE,collectionKey:collection,recordId,minVersion:1}]}
async function schoolContext(){return(await localMobileRecords<R>(SCHOOL,"academic-context",1000,0)).map(x=>normalize(x.payload||{}))}
async function scheduling(kind?:string){const rows=await recordsWithPending("scheduling");return kind?rows.filter(x=>x.entityType===kind):rows}

export async function offlineAcademicsSetup():Promise<AcademicsSetup>{
 const context=await schoolContext(),rooms=(await scheduling("room")).map(x=>({...x,id:x.id.replace(/^room:/,"")} as Room)),allocations=(await scheduling("allocation")).map(x=>({id:x.id.replace(/^allocation:/,""),staffId:x.staffId||"",teacherUserId:x.teacherUserId||"",teacherName:x.teacherName||"Teacher",academicYearId:x.academicYearId,termId:x.termId,classId:x.classId||"",className:x.className,streamId:x.streamId,streamName:x.streamName,subjectId:x.subjectId||"",subjectName:x.subjectName,active:x.active})) as TeacherAllocation[];
 const teachersMap=new Map<string,R>();for(const a of allocations)if(a.teacherUserId&&!teachersMap.has(a.teacherUserId))teachersMap.set(a.teacherUserId,{id:a.teacherUserId,staffId:a.staffId||a.teacherUserId,name:a.teacherName||"Teacher"});
 const by=(type:string)=>context.filter(x=>x.entityType===type).map(({entityType,...x})=>x);
 return{years:by("academic-year") as any,terms:by("term") as any,departments:by("department") as any,classes:by("class") as any,streams:by("stream") as any,subjects:by("subject") as any,teachers:[...teachersMap.values()] as any,rooms,periods:by("lesson-period") as any,teacherAllocations:allocations};
}
export async function offlineAcademicsOverview():Promise<AcademicsOverview>{
 const[timetables,schemes,plans,deliveries,supervision]=await Promise.all([scheduling("timetable"),recordsWithPending("schemes"),recordsWithPending("lesson-plans"),recordsWithPending("deliveries"),recordsWithPending("supervision")]);
 const today=new Date().toISOString().slice(0,10),covered=schemes.map(x=>Number(x.coveragePercent??0)).filter(Number.isFinite);
 return{timetables:timetables.length,schemes:schemes.length,lessonPlans:plans.length,todaysLessons:deliveries.filter(x=>(x.scheduledDate||x.lessonDate)===today).length,openObservations:supervision.filter(x=>x.entityType==="observation"&&!['closed','completed'].includes(String(x.status))).length,openInspections:supervision.filter(x=>x.entityType==="inspection"&&!['closed','completed'].includes(String(x.status))).length,averageCoverage:covered.length?covered.reduce((a,b)=>a+b,0)/covered.length:0};
}
export const offlineTeacherAllocations=async()=>((await scheduling("allocation")).map(x=>({...x,id:x.id.replace(/^allocation:/,"")})) as TeacherAllocation[]);
export const offlineRooms=async()=>((await scheduling("room")).map(x=>({...x,id:x.id.replace(/^room:/,"")})) as Room[]);
export const offlineAvailability=async(teacherUserId?:string)=>(await scheduling("availability")).map(x=>({...x,id:x.id.replace(/^availability:/,"")})).filter(x=>!teacherUserId||x.teacherUserId===teacherUserId);
export const offlineTimetables=async()=>((await scheduling("timetable")).map(x=>({...x,id:x.id.replace(/^timetable:/,"")})) as Timetable[]);
export const offlineTimetableEntries=async(timetableId:string)=>((await scheduling("entry")).map(x=>({...x,id:x.id.replace(/^entry:/,""),weekday:Number(x.weekday)===7?0:Number(x.weekday)})).filter(x=>x.timetableId===timetableId) as TimetableEntry[]);
export const offlineTimetableChanges=async(timetableId:string)=>(await scheduling("change")).map(x=>({...x,id:x.id.replace(/^change:/,"")})).filter(x=>x.timetableId===timetableId);
export const offlineSchemes=async()=>((await recordsWithPending("schemes")).map(x=>({...x,status:x.status||"draft"})) as Scheme[]);
export async function offlineScheme(id:string):Promise<Scheme>{const scheme=await recordWithPending("schemes",id);if(!scheme)throw new Error("Scheme is not available offline");const items=(await recordsWithPending("scheme-items")).filter(x=>x.schemeId===id);return{...scheme,status:scheme.status||"draft",items,versions:scheme.versions||[]} as Scheme}
export const offlineTemplates=async()=>recordsWithPending("templates");
export const offlineLessonPlans=async()=>((await recordsWithPending("lesson-plans")).map(x=>({...x,status:x.status||"draft"})) as LessonPlan[]);
export async function offlineLessonPlan(id:string):Promise<LessonPlan>{const x=await recordWithPending("lesson-plans",id);if(!x)throw new Error("Lesson plan is not available offline");return{...x,status:x.status||"draft"} as LessonPlan}
export async function offlineDeliveries(date?:string):Promise<Delivery[]>{const rows=await recordsWithPending("deliveries");return rows.filter(x=>!date||(x.scheduledDate||x.lessonDate)===date) as Delivery[]}
export const offlineObservations=async()=>((await recordsWithPending("supervision")).filter(x=>x.entityType==="observation").map(x=>({...x,id:x.id.replace(/^observation:/,"")})) as Observation[]);
export const offlineInspections=async()=>((await recordsWithPending("supervision")).filter(x=>x.entityType==="inspection").map(x=>({...x,id:x.id.replace(/^inspection:/,"")})) as Inspection[]);

export async function queueOfflineScheme(body:R){const id=body.id||uid("sch");await queueMobileMutation({moduleKey:MODULE,collectionKey:"schemes",recordId:id,payload:body,baseVersion:0});return offlineScheme(id)}
export async function queueOfflineSchemeItem(schemeId:string,body:R){const id=body.id||uid("sci"),dependencies=await dependencyFor("schemes",schemeId);await queueMobileMutation({moduleKey:MODULE,collectionKey:"scheme-items",recordId:id,payload:{...body,schemeId},baseVersion:0,dependencies});return{id,...body,schemeId}}
export async function queueOfflineSchemeItemUpdate(id:string,body:R){const current=await recordWithPending("scheme-items",id),schemeId=String(current?.schemeId||body.schemeId||"");const dependencies=schemeId?await dependencyFor("schemes",schemeId):[];await queueMobileMutation({moduleKey:MODULE,collectionKey:"scheme-items",recordId:id,payload:body,dependencies});return{...(current||{}),...body,id}}
export async function queueOfflineLessonPlan(body:R){const id=body.id||uid("lpn"),dependencies:MobileSyncDependency[]=body.schemeItemId?await dependencyFor("scheme-items",body.schemeItemId):[];await queueMobileMutation({moduleKey:MODULE,collectionKey:"lesson-plans",recordId:id,payload:body,baseVersion:0,dependencies});return offlineLessonPlan(id)}
export async function queueOfflineLessonPlanUpdate(id:string,body:R){await queueMobileMutation({moduleKey:MODULE,collectionKey:"lesson-plans",recordId:id,payload:body});return offlineLessonPlan(id)}
export async function queueOfflineDeliveryUpdate(id:string,body:R){await queueMobileMutation({moduleKey:MODULE,collectionKey:"deliveries",recordId:id,payload:body});return{...((await recordWithPending("deliveries",id))||{}),...body,id} as Delivery}
