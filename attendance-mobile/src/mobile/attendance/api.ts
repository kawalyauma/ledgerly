import type {MobileSession} from "../auth";
import {ledgerlyRequest,query,type SessionUpdater} from "../apiClient";
import type {AttendanceContext,AttendanceDevice,AttendanceEvent,AttendanceException,AttendanceIdentifier,AttendancePolicy,AttendanceRecord,AttendanceSession,BiometricJob,BiometricProfile,BiometricSettings,NotificationRule,OverviewData,PersonType,SummaryRow} from "./types";

type Client={session:MobileSession;onSession?:SessionUpdater};
const req=<T>(c:Client,path:string,init?:RequestInit)=>ledgerlyRequest<T>(c.session,path,init,c.onSession);
const json=(method:string,body?:unknown):RequestInit=>({method,body:body===undefined?undefined:JSON.stringify(body)});
export const attendanceApi={
  context:(c:Client)=>req<AttendanceContext>(c,"/attendance/context"),
  overview:(c:Client,date:string)=>req<OverviewData>(c,`/attendance/overview${query({date})}`),
  sessions:(c:Client,date:string)=>req<AttendanceSession[]>(c,`/attendance/sessions${query({date})}`),
  createSession:(c:Client,body:Record<string,unknown>)=>req<AttendanceSession>(c,"/attendance/sessions",json("POST",body)),
  saveRegister:(c:Client,id:string,records:Record<string,unknown>[])=>req<{sessionId:string;saved:number;markedCount:number}>(c,`/attendance/sessions/${encodeURIComponent(id)}/records`,json("PUT",{records})),
  finalizeSession:(c:Client,id:string)=>req<{id:string;status:string}>(c,`/attendance/sessions/${encodeURIComponent(id)}/finalize`,json("POST",{})),
  records:(c:Client,filters:{from:string;to:string;personType?:PersonType;personId?:string;status?:string})=>req<AttendanceRecord[]>(c,`/attendance/records${query(filters)}`),
  correctRecord:(c:Client,id:string,reason:string,changes:Record<string,unknown>)=>req<{id:string;correctionId:string}>(c,`/attendance/records/${encodeURIComponent(id)}/correct`,json("POST",{reason,changes})),
  staffDay:(c:Client,attendanceDate:string,records:Record<string,unknown>[])=>req<{attendanceDate:string;saved:number}>(c,"/attendance/staff/day",json("PUT",{attendanceDate,records})),
  events:(c:Client,date:string)=>req<AttendanceEvent[]>(c,`/attendance/events${query({date,limit:200})}`),
  captureEvent:(c:Client,body:Record<string,unknown>)=>req<Record<string,unknown>>(c,"/attendance/events",json("POST",body)),
  summaryReport:(c:Client,from:string,to:string)=>req<SummaryRow[]>(c,`/attendance/reports/summary${query({from,to})}`),
  devices:(c:Client)=>req<AttendanceDevice[]>(c,"/attendance/devices"),
  createDevice:(c:Client,body:Record<string,unknown>)=>req<Record<string,unknown>>(c,"/attendance/devices",json("POST",body)),
  updateDevice:(c:Client,id:string,body:Record<string,unknown>)=>req<Record<string,unknown>>(c,`/attendance/devices/${encodeURIComponent(id)}`,json("PATCH",body)),
  enableTestMode:(c:Client,id:string,body:Record<string,unknown>)=>req<Record<string,unknown>>(c,`/attendance/devices/${encodeURIComponent(id)}/test-mode`,json("POST",body)),
  disableTestMode:(c:Client,id:string)=>req<Record<string,unknown>>(c,`/attendance/devices/${encodeURIComponent(id)}/test-mode`,json("DELETE")),
  identifiers:(c:Client)=>req<AttendanceIdentifier[]>(c,"/attendance/identifiers"),
  createIdentifier:(c:Client,body:{personType:PersonType;personId:string;method:"QR"|"NFC";identifier:string})=>req<AttendanceIdentifier>(c,"/attendance/identifiers",json("POST",body)),
  deleteIdentifier:(c:Client,id:string)=>req<void>(c,`/attendance/identifiers/${encodeURIComponent(id)}`,json("DELETE")),
  biometricSettings:(c:Client)=>req<BiometricSettings>(c,"/attendance/biometric-settings"),
  updateBiometricSettings:(c:Client,body:BiometricSettings)=>req<BiometricSettings>(c,"/attendance/biometric-settings",json("PATCH",body)),
  biometrics:(c:Client)=>req<BiometricProfile[]>(c,"/attendance/biometrics"),
  deleteBiometric:(c:Client,id:string)=>req<Record<string,unknown>>(c,`/attendance/biometrics/${encodeURIComponent(id)}`,json("DELETE")),
  biometricJobs:(c:Client)=>req<BiometricJob[]>(c,"/attendance/biometric-enrollment-jobs"),
  createBiometricJob:(c:Client,body:Record<string,unknown>)=>req<{id:string;status:string}>(c,"/attendance/biometric-enrollment-jobs",json("POST",body)),
  cancelBiometricJob:(c:Client,id:string)=>req<Record<string,unknown>>(c,`/attendance/biometric-enrollment-jobs/${encodeURIComponent(id)}`,json("DELETE")),
  policies:(c:Client)=>req<AttendancePolicy[]>(c,"/attendance/policies"),
  createPolicy:(c:Client,body:Record<string,unknown>)=>req<AttendancePolicy>(c,"/attendance/policies",json("POST",body)),
  notificationRules:(c:Client)=>req<NotificationRule[]>(c,"/attendance/notification-rules"),
  createNotificationRule:(c:Client,body:Record<string,unknown>)=>req<NotificationRule>(c,"/attendance/notification-rules",json("POST",body)),
  exceptions:(c:Client)=>req<AttendanceException[]>(c,"/attendance/exceptions"),
  createException:(c:Client,body:Record<string,unknown>)=>req<AttendanceException>(c,"/attendance/exceptions",json("POST",body)),
};
