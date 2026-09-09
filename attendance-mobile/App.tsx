import {useEffect,useState} from "react";
import {ActivityIndicator,Alert,StatusBar,StyleSheet,Text,View} from "react-native";
import {ActivationScreen} from "./src/ActivationScreen";
import {KioskScreen} from "./src/KioskScreen";
import {DeviceManager} from "./src/native";
import type {Registration} from "./src/types";
import {clearMobileSession,completeOnboarding,logoutMobile,onboardingComplete,readMobileSession,refreshMobile,saveMobileSession,type MobileSession} from "./src/mobile/auth";
import {HomeScreen} from "./src/mobile/HomeScreen";
import {LoginScreen} from "./src/mobile/LoginScreen";
import {OnboardingScreen} from "./src/mobile/OnboardingScreen";
import {AttendanceModuleScreen} from "./src/mobile/AttendanceModuleScreen";
import {AttendanceWorkspaceScreen} from "./src/mobile/attendance/AttendanceWorkspaceScreen";
import {SchoolWorkspaceScreen} from "./src/mobile/school/SchoolWorkspaceScreen";
import {AcademicsWorkspaceScreen} from "./src/mobile/academics/AcademicsWorkspaceScreen";
import {ExamsWorkspaceScreen} from "./src/mobile/exams/ExamsWorkspaceScreen";
import {BooksWorkspaceScreen} from "./src/mobile/books/BooksWorkspaceScreen";
import {HumanResourcesWorkspaceScreen} from "./src/mobile/human-resources/HumanResourcesWorkspaceScreen";
import {PayrollPaymentsWorkspaceScreen} from "./src/mobile/payroll-payments/PayrollPaymentsWorkspaceScreen";
import {ContactsWorkspaceScreen} from "./src/mobile/contacts/ContactsWorkspaceScreen";
import {CommunicationsWorkspaceScreen} from "./src/mobile/communications/CommunicationsWorkspaceScreen";
import {TasksWorkWorkspaceScreen} from "./src/mobile/tasks-work/TasksWorkWorkspaceScreen";
import {FinanceCoreWorkspaceScreen} from "./src/mobile/finance-core/FinanceCoreWorkspaceScreen";
import {PrinterlyWorkspaceScreen} from "./src/mobile/printerly/PrinterlyWorkspaceScreen";
import {SecurityCamerasWorkspaceScreen} from "./src/mobile/security-cameras/SecurityCamerasWorkspaceScreen";
import {DevicePurposeScreen} from "./src/mobile/device-purpose/DevicePurposeScreen";
import {clearDevicePurpose,readDevicePurpose,saveDevicePurpose,type DevicePurpose} from "./src/mobile/device-purpose/devicePurpose";
import {CameraModeScreen} from "./src/mobile/camera/CameraModeScreen";
import {clearCameraRegistration} from "./src/mobile/camera/api";
import {clearMobileSyncAccountData} from "./src/mobile/syncClient";
import {useNormalMobileSync} from "./src/mobile/syncRuntime";

type Route="home"|"attendance"|"school"|"academics"|"exams"|"books"|"human-resources"|"payroll-payments"|"contacts"|"communications"|"tasks-work"|"finance-core"|"printerly"|"security-cameras";
export default function App(){
  const[ready,setReady]=useState(false),[onboarded,setOnboarded]=useState(false),[session,setSession]=useState<MobileSession|null>(null),[purpose,setPurpose]=useState<DevicePurpose|null>(null),[route,setRoute]=useState<Route>("home"),[attendanceView,setAttendanceView]=useState<"landing"|"workspace"|"register"|"kiosk">("landing"),[registration,setRegistration]=useState<Registration|null|undefined>(undefined);
  useNormalMobileSync(session,purpose,updateSession);
  useEffect(()=>{let live=true;(async()=>{const[seen,saved,device,savedPurpose]=await Promise.all([onboardingComplete().catch(()=>false),readMobileSession().catch(()=>null),DeviceManager.getRegistration().catch(()=>null),readDevicePurpose().catch(()=>null)]);if(!live)return;setOnboarded(seen);setRegistration(device);setPurpose(savedPurpose);if(saved){try{const renewed=await refreshMobile(saved);if(live){await saveMobileSession(renewed);setSession(renewed)}}catch(e:any){if(e?.status===401){await clearMobileSession()}else if(live)setSession(saved)}}setReady(true)})();return()=>{live=false}},[]);
  async function finishOnboarding(){await completeOnboarding();setOnboarded(true)}
  async function signedIn(next:MobileSession){await saveMobileSession(next);setSession(next);setRoute("home")}
  async function updateSession(next:MobileSession){await saveMobileSession(next);setSession(next)}
  async function choosePurpose(next:DevicePurpose){await saveDevicePurpose(next);setPurpose(next);setRoute(next==="attendance-kiosk"?"attendance":"home");setAttendanceView(next==="attendance-kiosk"?(registration?"kiosk":"register"):"landing")}
  async function changePurpose(){await Promise.all([clearDevicePurpose(),clearCameraRegistration()]);setPurpose(null);setRoute("home");setAttendanceView("landing")}
  function requestLogout(){Alert.alert("Sign out?","You will need your Ledgerly credentials to sign in again.",[{text:"Cancel",style:"cancel"},{text:"Sign out",style:"destructive",onPress:()=>{const current=session;setSession(null);setRoute("home");void Promise.all([clearMobileSession(),clearMobileSyncAccountData()]);if(current)void logoutMobile(current)}}])}
  if(!ready)return <View style={s.loading}><StatusBar barStyle="light-content" backgroundColor="#071c16"/><View style={s.loaderMark}><Text style={s.loaderLetter}>L</Text></View><ActivityIndicator color="#55c894" style={{marginTop:18}}/><Text style={s.loadingText}>Preparing Ledgerly Mobile</Text></View>;
  if(!onboarded)return <OnboardingScreen onDone={()=>void finishOnboarding()}/>;
  if(!purpose)return <DevicePurposeScreen onSelect={next=>void choosePurpose(next)}/>;
  if(purpose==="security-camera")return <CameraModeScreen onChangePurpose={()=>void changePurpose()}/>;
  if(purpose==="attendance-kiosk"){if(registration===undefined)return <View style={s.loading}><ActivityIndicator color="#55c894"/></View>;if(!registration)return <ActivationScreen onActivated={(next:Registration)=>{setRegistration(next);setAttendanceView("kiosk")}}/>;return <><StatusBar hidden/><KioskScreen registration={registration} onReset={()=>{setRegistration(null);setAttendanceView("register")}}/></>}
  if(!session)return <LoginScreen onLogin={signedIn}/>;
  if(route==="school")return <SchoolWorkspaceScreen session={session} onSession={updateSession} onBack={()=>setRoute("home")}/>;
  if(route==="academics")return <AcademicsWorkspaceScreen session={session} onSession={updateSession} onBack={()=>setRoute("home")}/>;
  if(route==="exams")return <ExamsWorkspaceScreen session={session} onSession={updateSession} onBack={()=>setRoute("home")}/>;
  if(route==="books")return <BooksWorkspaceScreen session={session} onSession={updateSession} onBack={()=>setRoute("home")}/>;
  if(route==="human-resources")return <HumanResourcesWorkspaceScreen session={session} onSession={updateSession} onBack={()=>setRoute("home")}/>;
  if(route==="payroll-payments")return <PayrollPaymentsWorkspaceScreen session={session} onSession={updateSession} onBack={()=>setRoute("home")}/>;
  if(route==="contacts")return <ContactsWorkspaceScreen session={session} onSession={updateSession} onBack={()=>setRoute("home")}/>;
  if(route==="communications")return <CommunicationsWorkspaceScreen session={session} onSession={updateSession} onBack={()=>setRoute("home")}/>;
  if(route==="tasks-work")return <TasksWorkWorkspaceScreen session={session} onSession={updateSession} onBack={()=>setRoute("home")}/>;
  if(route==="finance-core")return <FinanceCoreWorkspaceScreen session={session} onSession={updateSession} onBack={()=>setRoute("home")}/>;
  if(route==="printerly")return <PrinterlyWorkspaceScreen session={session} onSession={updateSession} onBack={()=>setRoute("home")}/>;
  if(route==="security-cameras")return <SecurityCamerasWorkspaceScreen session={session} onSession={updateSession} onBack={()=>setRoute("home")}/>;
  if(route==="attendance"){if(registration===undefined)return <View style={s.loading}><ActivityIndicator color="#55c894"/></View>;if(attendanceView==="register")return <ActivationScreen onActivated={(next:Registration)=>{setRegistration(next);setAttendanceView("landing")}}/>;if(attendanceView==="kiosk"&&registration)return <><StatusBar hidden/><KioskScreen registration={registration} onReset={()=>{setRegistration(null);setAttendanceView("landing")}}/></>;if(attendanceView==="workspace")return <AttendanceWorkspaceScreen session={session} onSession={updateSession} onBack={()=>setAttendanceView("landing")} onOpenKiosk={()=>setAttendanceView(registration?"kiosk":"register")}/>;return <AttendanceModuleScreen registration={registration} onBack={()=>setRoute("home")} onWorkspace={()=>setAttendanceView("workspace")} onRegister={()=>setAttendanceView("register")} onLaunch={()=>setAttendanceView("kiosk")}/>}
  return <HomeScreen session={session} onAttendance={()=>{setAttendanceView("landing");setRoute("attendance")}} onSchool={()=>setRoute("school")} onAcademics={()=>setRoute("academics")} onExams={()=>setRoute("exams")} onBooks={()=>setRoute("books")} onHumanResources={()=>setRoute("human-resources")} onPayrollPayments={()=>setRoute("payroll-payments")} onContacts={()=>setRoute("contacts")} onCommunications={()=>setRoute("communications")} onTasksWork={()=>setRoute("tasks-work")} onFinanceCore={()=>setRoute("finance-core")} onPrinterly={()=>setRoute("printerly")} onSecurityCameras={()=>setRoute("security-cameras")} onLogout={requestLogout}/>;
}
const s=StyleSheet.create({loading:{flex:1,backgroundColor:"#071c16",alignItems:"center",justifyContent:"center"},loaderMark:{width:58,height:58,borderRadius:18,backgroundColor:"#19955f",alignItems:"center",justifyContent:"center"},loaderLetter:{color:"white",fontSize:30,fontWeight:"900"},loadingText:{color:"#9fb9ae",fontSize:12,fontWeight:"800",marginTop:10}});
