import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {AppState,SafeAreaView,StyleSheet,Text,TextInput,TouchableOpacity,View} from "react-native";
import {Camera,useCameraDevice,useCameraPermission,useCodeScanner} from "react-native-vision-camera";
import {claimEnrollmentJob,completeEnrollmentJob,failEnrollmentJob,fetchBootstrap,fetchFaceState,fetchFaceTemplates} from "./api";
import {DeviceManager,FaceEngine,KioskManager,LedgerlyNfc,OfflineStore,nfcEvents} from "./native";
import {cacheBootstrap,cachedBootstrap,enqueue,eventId} from "./storage";
import {flush} from "./sync";
import type {AttendanceEvent,Bootstrap,CaptureMethod,Direction,EnrollmentJob,FaceChallenge,FaceState,Registration,RosterPerson} from "./types";

type Result={person:RosterPerson;method:CaptureMethod;verificationMode?:"STANDARD"|"TEST"};
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(()=>resolve(),ms));
type Inspection=Awaited<ReturnType<typeof FaceEngine.inspect>>;

export function KioskScreen({registration,onReset}:{registration:Registration;onReset:()=>void}){
  const[bootstrap,setBootstrap]=useState<Bootstrap|null>(null),[faceState,setFaceState]=useState<FaceState|null>(null);
  const[pendingCount,setPendingCount]=useState(0),[failedCount,setFailedCount]=useState(0),[online,setOnline]=useState(false);
  const[direction,setDirection]=useState<Direction>("IN"),[result,setResult]=useState<Result|null>(null),[error,setError]=useState(""),[query,setQuery]=useState("");
  const[logoTaps,setLogoTaps]=useState(0),[exitOpen,setExitOpen]=useState(false),[exitPin,setExitPin]=useState("");
  const[faceBusy,setFaceBusy]=useState(false),[facePrompt,setFacePrompt]=useState(""),[cameraFacing,setCameraFacing]=useState<"front"|"back">("front");
  const busy=useRef(false),camera=useRef<any>(null),lastCode=useRef({value:"",at:0});
  const device=useCameraDevice(cameraFacing),permission=useCameraPermission();

  const syncNow=useCallback(async()=>{try{const r=await flush(registration);setPendingCount(r.remaining);setFailedCount(r.failed);setOnline(true)}catch{setOnline(false);setPendingCount(await OfflineStore.count());setFailedCount(await OfflineStore.failedCount())}},[registration]);
  const syncFace=useCallback(async()=>{try{const state=await fetchFaceState(registration);setFaceState(state);await FaceEngine.configure(state.settings.matchThreshold,state.settings.ambiguityMargin,state.settings.livenessThreshold,state.settings.qualityThreshold);const health=await FaceEngine.healthCheck();if(health.healthy){const remoteSignature=`${state.templates.version||"0"}:${state.templates.count}`;const localSignature=await OfflineStore.getSecure("face.templates.signature");if(localSignature!==remoteSignature||health.templateCount!==state.templates.count){const templates=await fetchFaceTemplates(registration);await FaceEngine.replaceTemplates(JSON.stringify(templates.templates));await OfflineStore.putSecure("face.templates.signature",remoteSignature)}}return state}catch(e){return null}},[registration]);
  const refresh=useCallback(async()=>{try{const fresh=await fetchBootstrap(registration);setBootstrap(fresh);await cacheBootstrap(fresh);setOnline(true);if(fresh.camera?.preferredFacing)setCameraFacing(fresh.camera.preferredFacing);if(fresh.device.direction!=="BOTH")setDirection(fresh.device.direction);await Promise.all([syncNow(),syncFace()])}catch(e){setOnline(false);setError(e instanceof Error?e.message:String(e));const cached=await cachedBootstrap();if(cached)setBootstrap(cached)}},[registration,syncNow,syncFace]);

  const index=useMemo(()=>{const map=new Map<string,RosterPerson>();for(const p of bootstrap?.roster||[])for(const key of[p.id,p.admissionNumber,p.studentNumber,p.staffNumber])if(key)map.set(String(key).trim().toLowerCase(),p);for(const x of bootstrap?.identifiers||[]){const person=bootstrap?.roster.find(p=>p.id===x.personId);if(person)map.set(x.identifier.trim().toLowerCase(),person)}return map},[bootstrap]);
  const record=useCallback(async(person:RosterPerson,method:CaptureMethod,extra:Partial<AttendanceEvent>={})=>{if(busy.current)return;busy.current=true;setError("");try{const event:AttendanceEvent={clientEventId:eventId(),personType:person.staffNumber?"staff":"student",personId:person.id,direction,method,verificationMode:extra.verificationMode||((method==="MANUAL")?"SUPERVISED":"STANDARD"),confidence:extra.confidence,matchMargin:extra.matchMargin,livenessScore:extra.livenessScore,capturedAt:new Date().toISOString(),metadata:{deviceCapturedOffline:!online,cameraSource:method==="FACE"?"device":undefined,cameraFacing:method==="FACE"?cameraFacing:undefined,...(extra.metadata||{})}};setPendingCount(await enqueue(event));setResult({person,method,verificationMode:event.verificationMode==="TEST"?"TEST":"STANDARD"});setQuery("");void syncNow();setTimeout(()=>setResult(null),2800)}finally{busy.current=false}},[cameraFacing,direction,online,syncNow]);
  const identifyCode=useCallback(async(value:string,method:CaptureMethod)=>{const clean=value.trim().toLowerCase();if(!clean||busy.current)return;const now=Date.now();if(lastCode.current.value===clean&&now-lastCode.current.at<3000)return;lastCode.current={value:clean,at:now};const person=index.get(clean);if(!person){setError("Unknown card or person");return}await record(person,method)},[index,record]);

  useEffect(()=>{void permission.requestPermission();void refresh();void KioskManager.enter().catch(()=>{});void LedgerlyNfc.enable().catch(()=>{});const timer=setInterval(()=>{void syncNow();void syncFace()},20000);const state=AppState.addEventListener("change",x=>{if(x==="active"){void syncNow();void syncFace()}});return()=>{state.remove();clearInterval(timer);void LedgerlyNfc.disable()}},[permission,refresh,syncNow,syncFace]);
  useEffect(()=>{const listener=nfcEvents.addListener("LedgerlyNfcTag",(value:Object)=>void identifyCode(String(value),"NFC"));return()=>listener.remove()},[identifyCode]);
  const scanner=useCodeScanner({codeTypes:["qr","code-128","code-39","ean-13","ean-8"],onCodeScanned:codes=>{const value=codes[0]?.value;if(value)void identifyCode(value,"QR")}});
  const testMode=!!(bootstrap?.testMode&&new Date(bootstrap.testMode.expiresAt)>new Date());

  async function captureSequence(test=false,enrollment=false):Promise<{photos:string[];challenge:FaceChallenge;captureMs:number}>{
    if(!camera.current)throw new Error("Device camera is unavailable");
    const started=Date.now();
    const challenge="DISABLED" as FaceChallenge;
    const photos:string[]=[];
    async function waitFor(prompt:string,accept:(x:Inspection)=>boolean,timeout=9000){
      const until=Date.now()+timeout;let last="";
      while(Date.now()<until){
        setFacePrompt(last&&last!=="ready"?last:prompt);
        try{const shot=await camera.current.takeSnapshot({quality:85});const check=await FaceEngine.inspect(shot.path);last=check.guidance;if(accept(check)){photos.push(shot.path);return check}}catch(e){last=e instanceof Error&&/Only one face/.test(e.message)?"Only one face allowed":"Move your face into the frame"}
        await sleep(140);
      }
      throw new Error(`${last||prompt}. Face capture timed out—follow the guide and try again.`)
    }
    const usable=(x:Inspection)=>x.faceArea>=.08&&x.brightness>=.22&&x.sharpness>=.18;
    const ready=(x:Inspection)=>usable(x)&&x.ready;
    await waitFor("Show your face",ready);
    if(enrollment)for(let i=1;i<3;i++){await sleep(120);await waitFor("Hold still",ready,3500)}
    setFacePrompt("");return{photos,challenge,captureMs:Date.now()-started};
  }
  async function face(){
    if(faceBusy||!camera.current||!device||!permission.hasPermission)return;setFaceBusy(true);setError("");
    try{const health=await FaceEngine.healthCheck();if(!health.healthy)throw new Error(health.modelError||"Face recognition model is not installed. Use QR, NFC or supervised lookup.");if(!health.templateCount)throw new Error("No face templates are synced to this kiosk yet.");const allowScreen=!!bootstrap?.testMode?.allowScreenImage,allowPrinted=!!bootstrap?.testMode?.allowPrintedImage;const capture=await captureSequence(testMode);const match=await FaceEngine.identify(capture.photos,testMode,allowScreen,allowPrinted,capture.challenge);const person=bootstrap?.roster.find(p=>p.id===match.personId);if(!person||((person.staffNumber?"staff":"student")!==match.personType))throw new Error("Recognized person is not available on this kiosk roster.");await record(person,"FACE",{verificationMode:testMode?"TEST":"STANDARD",confidence:match.confidence,matchMargin:match.matchMargin,livenessScore:match.livenessScore,metadata:{testAllowScreenImage:allowScreen,testAllowPrintedImage:allowPrinted,activeLiveness:false,livenessChallenge:"DISABLED",secondBestConfidence:match.secondBestConfidence,matchMargin:match.matchMargin,faceModel:"facenet-128-v1",performance:{captureMs:capture.captureMs,...match.timings}}})}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setFacePrompt("");setFaceBusy(false)}
  }
  async function enroll(job:NonNullable<EnrollmentJob>){
    if(faceBusy||!camera.current)return;setFaceBusy(true);setError("");
    let claimed=false;try{const health=await FaceEngine.healthCheck();if(!health.healthy)throw new Error(health.modelError||"Face recognition model is unavailable");const capture=await captureSequence(false,true);await claimEnrollmentJob(registration,job.id);claimed=true;const result=await FaceEngine.enroll(capture.photos,capture.challenge);await completeEnrollmentJob(registration,job.id,{...result,timings:{captureMs:capture.captureMs,...result.timings}});setFacePrompt("Enrollment saved");await syncFace();await refresh();setTimeout(()=>setFacePrompt(""),1600)}catch(e){const msg=e instanceof Error?e.message:String(e);setError(msg);if(claimed)await failEnrollmentJob(registration,job.id,msg).catch(()=>{})}finally{setFaceBusy(false)}
  }

  const job=faceState?.enrollmentJob;
  useEffect(()=>{if(!device||!permission.hasPermission||!bootstrap||result||exitOpen||faceBusy)return;const timer=setTimeout(()=>{if(job)void enroll(job);else if((faceState?.templates.count||0)>0)void face()},450);return()=>clearTimeout(timer)},[bootstrap,device,permission.hasPermission,result,exitOpen,faceBusy,job?.id,faceState?.templates.count]);

  function tapLogo(){const next=logoTaps+1;if(next>=5){setExitOpen(true);setLogoTaps(0)}else{setLogoTaps(next);setTimeout(()=>setLogoTaps(0),2500)}}
  async function exit(){if(!await DeviceManager.verifyExitPin(exitPin)){setError("Incorrect administrator PIN");return}await KioskManager.exit();setExitOpen(false)}
  return <SafeAreaView style={s.root}>
    {testMode?<View style={s.test}><Text style={s.testTitle}>⚠ FACE TEST MODE ACTIVE</Text><Text style={s.testText}>{bootstrap?.testMode?.allowScreenImage?"Phone/screen images allowed. ":""}{bootstrap?.testMode?.allowPrintedImage?"Printed images allowed. ":""}Face events are untrusted and do not become official attendance. Expires {new Date(bootstrap!.testMode!.expiresAt).toLocaleTimeString()}.</Text></View>:null}
    <View style={s.top}><TouchableOpacity onPress={tapLogo}><Text style={s.logo}>ledgerly</Text></TouchableOpacity><View><Text style={s.location}>{bootstrap?.device.name||"Attendance kiosk"}</Text><Text style={s.connection}>{online?"● Online":"● Offline"} · {pendingCount} pending{failedCount?` · ${failedCount} rejected`:""}</Text></View></View>
    {job?<View style={s.enroll}><View><Text style={s.enrollTitle}>Automatic face enrollment</Text><Text style={s.enrollText}>{job.personName}{job.groupName?` · ${job.groupName}`:""} · Look at the camera</Text></View></View>:null}
    <View style={s.camera}>
      {device&&permission.hasPermission?<Camera ref={camera} style={StyleSheet.absoluteFill} device={device} isActive={!result&&!exitOpen} photo codeScanner={scanner}/>:<View style={s.cameraEmpty}><Text style={s.cameraEmptyTitle}>Device camera unavailable</Text><Text style={s.cameraEmptyText}>QR/NFC and supervised lookup remain available.</Text></View>}
      <View pointerEvents="none" style={s.guide}><View style={s.faceGuide}/><Text style={s.guideText}>{facePrompt||"Face recognition starts automatically"}</Text></View>
      {bootstrap?.camera?.allowFacingSwitch?<TouchableOpacity style={s.flip} onPress={()=>setCameraFacing(x=>x==="front"?"back":"front")}><Text style={s.flipText}>{cameraFacing==="front"?"Front":"Rear"} camera</Text></TouchableOpacity>:null}
    </View>
    <View style={s.methods}><View style={s.autoFace}><Text style={s.autoFaceText}>{faceBusy?"Detecting face…":"Automatic face scan ready"}</Text></View><TouchableOpacity disabled={bootstrap?.device.direction!=="BOTH"} style={s.direction} onPress={()=>setDirection(x=>x==="IN"?"OUT":"IN")}><Text style={s.directionLabel}>DIRECTION</Text><Text style={s.directionValue}>{direction}</Text></TouchableOpacity></View>
    <View style={s.lookup}><TextInput style={s.search} value={query} onChangeText={setQuery} placeholder="Admission or staff number" placeholderTextColor="#84938c" onSubmitEditing={()=>void identifyCode(query,"MANUAL")}/><TouchableOpacity style={s.lookupButton} onPress={()=>void identifyCode(query,"MANUAL")}><Text style={s.lookupButtonText}>Find</Text></TouchableOpacity></View>
    {error?<Text style={s.error}>{error}</Text>:null}
    {result?<View style={s.success}><Text style={s.check}>✓</Text><Text style={s.successTitle}>{result.person.name}</Text><Text style={s.successGroup}>{result.person.groupName||"School member"}</Text><Text style={s.signed}>{result.verificationMode==="TEST"?"TEST CAPTURE":"SIGNED"} {direction} · {new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})} · {result.method}</Text></View>:null}
    {exitOpen?<View style={s.exit}><Text style={s.exitTitle}>Administrator exit</Text><TextInput style={s.exitInput} secureTextEntry keyboardType="number-pad" value={exitPin} onChangeText={setExitPin} placeholder="Exit PIN"/><View style={s.exitActions}><TouchableOpacity onPress={()=>setExitOpen(false)}><Text>Cancel</Text></TouchableOpacity><TouchableOpacity onPress={()=>void exit()}><Text style={s.exitConfirm}>Exit kiosk</Text></TouchableOpacity><TouchableOpacity onPress={async()=>{await DeviceManager.clearRegistration();onReset()}}><Text style={s.reset}>Reset</Text></TouchableOpacity></View></View>:null}
  </SafeAreaView>
}

const s=StyleSheet.create({
  root:{flex:1,backgroundColor:"#081b14"},test:{backgroundColor:"#f8b81f",paddingHorizontal:18,paddingVertical:10},testTitle:{fontWeight:"900",color:"#281d00"},testText:{fontSize:12,color:"#493800",marginTop:2},top:{height:72,paddingHorizontal:20,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},logo:{fontSize:25,fontWeight:"900",color:"white"},location:{textAlign:"right",color:"white",fontWeight:"700"},connection:{color:"#8fb8a8",fontSize:12,textAlign:"right",marginTop:3},enroll:{marginHorizontal:16,marginBottom:10,padding:12,borderRadius:14,backgroundColor:"#e8f6ef",flexDirection:"row",alignItems:"center",justifyContent:"space-between"},enrollTitle:{fontWeight:"900",color:"#0d4b32"},enrollText:{color:"#39715c",fontSize:12,marginTop:2},camera:{flex:1,marginHorizontal:16,borderRadius:22,overflow:"hidden",backgroundColor:"#17372b"},cameraEmpty:{flex:1,alignItems:"center",justifyContent:"center"},cameraEmptyTitle:{color:"white",fontSize:21,fontWeight:"800"},cameraEmptyText:{color:"#aac0b7",marginTop:6},guide:{position:"absolute",left:0,right:0,top:0,bottom:0,alignItems:"center",justifyContent:"center"},faceGuide:{width:210,height:270,borderWidth:3,borderColor:"rgba(255,255,255,.75)",borderRadius:105},guideText:{color:"white",fontWeight:"700",marginTop:18,textShadowColor:"#000",textShadowRadius:6},flip:{position:"absolute",right:12,top:12,backgroundColor:"rgba(8,27,20,.72)",paddingHorizontal:11,paddingVertical:7,borderRadius:9},flipText:{color:"white",fontSize:12,fontWeight:"800"},methods:{flexDirection:"row",gap:10,padding:14},autoFace:{flex:1,backgroundColor:"#123c2c",borderRadius:13,padding:15,alignItems:"center"},autoFaceText:{color:"#b8e5d1",fontWeight:"900",fontSize:15},direction:{width:110,borderWidth:1,borderColor:"#315747",borderRadius:13,alignItems:"center",justifyContent:"center"},directionLabel:{fontSize:9,color:"#89aa9d",fontWeight:"800"},directionValue:{fontSize:18,color:"white",fontWeight:"900"},lookup:{flexDirection:"row",gap:8,paddingHorizontal:14,paddingBottom:18},search:{flex:1,backgroundColor:"#f4f7f5",borderRadius:11,paddingHorizontal:13,color:"#15271f"},lookupButton:{backgroundColor:"#dceae4",paddingHorizontal:22,justifyContent:"center",borderRadius:11},lookupButtonText:{fontWeight:"800",color:"#123c2c"},error:{color:"#ffb3b8",textAlign:"center",paddingBottom:10,paddingHorizontal:14},success:{position:"absolute",left:25,right:25,top:"27%",backgroundColor:"white",borderRadius:22,padding:25,alignItems:"center",elevation:12},check:{width:55,height:55,borderRadius:28,backgroundColor:"#19a567",color:"white",fontSize:34,textAlign:"center",fontWeight:"900"},successTitle:{fontSize:26,fontWeight:"900",color:"#11261e",marginTop:12},successGroup:{color:"#64746c",marginTop:3},signed:{color:"#168957",fontWeight:"900",marginTop:14},exit:{position:"absolute",left:25,right:25,top:"32%",backgroundColor:"white",borderRadius:18,padding:20,elevation:15},exitTitle:{fontSize:20,fontWeight:"900",color:"#17251f",marginBottom:12},exitInput:{borderWidth:1,borderColor:"#d5ded9",borderRadius:10,padding:12},exitActions:{flexDirection:"row",justifyContent:"space-between",marginTop:17},exitConfirm:{color:"#168957",fontWeight:"800"},reset:{color:"#b4232c",fontWeight:"800"}
});
