import {MobileSyncStore} from "../../native";
import {MobileApiError} from "../auth";
import {localMobileRecord,localMobileRecords,queueMobileMutation} from "../syncEngine";

const MODULE="school-management";
const SAFE_STUDENT_FIELDS=new Set(["firstName","middleName","lastName","preferredName","gender","dateOfBirth","nationality","placeOfBirth","religion","homeLanguage","phone","email","physicalAddress","previousSchool","previousClass","studentCategory","residencyStatus","house","profilePhotoUrl"]);
const CONTEXT_TYPES:Record<string,string>={branches:"branch",academicYears:"academic-year",terms:"term",departments:"department",classLevels:"class-level",classes:"class",streams:"stream",subjects:"subject",lessonPeriods:"lesson-period"};

type R=Record<string,any>;
function network(error:any){return error?.code==="NETWORK_ERROR"||error?.status===0}
export async function withOfflineFallback<T>(online:()=>Promise<T>,offline:()=>Promise<T>){try{return await online()}catch(error){if(network(error))return offline();throw error}}

async function pendingStudentPatches(){
  const rows=await MobileSyncStore.pendingOperations(250);
  const patches=new Map<string,R>();
  for(const row of rows){if(row.moduleKey!==MODULE||row.collectionKey!=="students"||row.kind!=="upsert"||!row.payloadJson)continue;try{patches.set(row.recordId,{...(patches.get(row.recordId)||{}),...JSON.parse(row.payloadJson)})}catch{}}
  return patches;
}
async function studentsWithPending(){
  const rows=await localMobileRecords<R>(MODULE,"students",1000,0),patches=await pendingStudentPatches();
  return rows.map(row=>({...(row.payload||{}),...(patches.get(row.id)||{}),id:row.id}));
}

export async function offlineSetupList(key:string){
  const entityType=CONTEXT_TYPES[key];if(!entityType)return[];
  const rows=await localMobileRecords<R>(MODULE,"academic-context",1000,0);
  return rows.map(r=>r.payload).filter((x:any)=>x?.entityType===entityType).map((x:any)=>{const{entityType:_,...rest}=x;return rest});
}
export async function offlineStudents(params:R={}){
  let rows=await studentsWithPending();
  const q=String(params.q||"").trim().toLowerCase();
  if(q)rows=rows.filter(x=>[x.firstName,x.middleName,x.lastName,x.preferredName,x.admissionNumber,x.studentNumber].some(v=>String(v||"").toLowerCase().includes(q)));
  if(params.status)rows=rows.filter(x=>x.status===params.status);
  if(params.classId)rows=rows.filter(x=>x.currentClassId===params.classId);
  if(params.streamId)rows=rows.filter(x=>x.currentStreamId===params.streamId);
  if(params.academicYearId)rows=rows.filter(x=>x.currentAcademicYearId===params.academicYearId);
  return rows.slice(0,Math.max(1,Math.min(1000,Number(params.limit||200))));
}
export async function offlineStudent(id:string){
  const row=await localMobileRecord<R>(MODULE,"students",id);if(!row)throw new MobileApiError(404,"STUDENT_NOT_FOUND","Learner is not available in the offline replica.");
  const patches=await pendingStudentPatches();return{...(row.payload||{}),...(patches.get(id)||{}),id};
}
export async function offlineGuardians(){
  const rows=await localMobileRecords<R>(MODULE,"student-guardians",1000,0),byId=new Map<string,R>();
  for(const row of rows){const x=row.payload||{},id=String(x.guardianId||row.id);const current=byId.get(id);if(current){current.studentCount+=1;continue}byId.set(id,{id,firstName:x.firstName,middleName:x.middleName,lastName:x.lastName,phonePrimary:x.phonePrimary,phoneSecondary:x.phoneSecondary,email:x.email,occupation:x.occupation,physicalAddress:x.physicalAddress,active:x.active,studentCount:1})}
  return[...byId.values()];
}
export async function offlineEnrollmentReport(){
  const rows=await studentsWithPending(),groups=new Map<string,R>();
  for(const x of rows){const key=[x.currentAcademicYearId||"",x.currentClassId||"",x.currentStreamId||"",x.status||""].join("|");const g=groups.get(key)||{academicYear:x.academicYearName||null,className:x.className||null,streamName:x.streamName||null,status:x.status||"active",students:0};g.students+=1;groups.set(key,g)}
  return[...groups.values()];
}
export async function offlineDemographicsReport(){
  const rows=await studentsWithPending(),groups=new Map<string,R>();
  for(const x of rows){const key=[x.gender||"",x.nationality||"",x.residencyStatus||"",x.status||""].join("|");const g=groups.get(key)||{gender:x.gender||null,nationality:x.nationality||null,residencyStatus:x.residencyStatus||null,status:x.status||"active",students:0};g.students+=1;groups.set(key,g)}
  return[...groups.values()];
}
export async function queueOfflineStudentUpdate(id:string,body:R){
  const payload:R={},unsupported:string[]=[];
  for(const[key,value]of Object.entries(body||{})){if(SAFE_STUDENT_FIELDS.has(key))payload[key]=value;else unsupported.push(key)}
  if(unsupported.length)throw new MobileApiError(409,"OFFLINE_STUDENT_FIELDS_SERVER_MANAGED","These learner fields require an online connection.",unsupported);
  if(!Object.keys(payload).length)throw new MobileApiError(422,"OFFLINE_STUDENT_UPDATE_EMPTY","No offline-safe learner changes were supplied.");
  await queueMobileMutation({moduleKey:MODULE,collectionKey:"students",recordId:id,kind:"upsert",payload});
  return offlineStudent(id);
}
