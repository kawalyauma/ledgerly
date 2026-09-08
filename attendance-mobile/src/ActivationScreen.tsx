import {useEffect,useRef,useState} from "react";
import {SafeAreaView,StyleSheet,Text,TouchableOpacity,View} from "react-native";
import {Camera,useCameraDevice,useCameraPermission,useCodeScanner} from "react-native-vision-camera";
import {deviceHealth,enrollDevice} from "./api";
import {DeviceManager,KioskManager} from "./native";
import type {Registration} from "./types";

const LEDGERLY_API_URL="https://your-finance-pro-api.ulib5000.workers.dev";
const QR_PREFIX="LEDGERLY-ATTENDANCE:1:";

function parseEnrollmentQr(value:string){
  if(!value.startsWith(QR_PREFIX))throw new Error("Scan the kiosk QR code shown in Ledgerly Attendance on the web");
  const parts=value.slice(QR_PREFIX.length).split(":");
  if(parts.length!==2||parts[0].length<20||!/^\d{4,10}$/.test(parts[1]))throw new Error("This Ledgerly kiosk QR code is invalid");
  return {token:parts[0],exitPin:parts[1]};
}

export function ActivationScreen({onActivated}:{onActivated:(r:Registration)=>void}){
  const[busy,setBusy]=useState(false),[error,setError]=useState(""),[status,setStatus]=useState("Point the camera at the QR code shown on the web app");
  const scanLock=useRef(false),device=useCameraDevice("back"),permission=useCameraPermission();
  useEffect(()=>{void permission.requestPermission();void KioskManager.enter().catch(()=>{})},[]);

  async function activate(raw:string){
    if(scanLock.current)return;
    scanLock.current=true;setBusy(true);setError("");setStatus("Registering kiosk…");
    try{
      const qr=parseEnrollmentQr(raw),enrolled=await enrollDevice(LEDGERLY_API_URL,qr.token),reg:Registration={apiUrl:LEDGERLY_API_URL,deviceId:enrolled.deviceId,credential:enrolled.credential};
      await deviceHealth(reg);
      await DeviceManager.saveRegistration(reg.apiUrl,reg.deviceId,reg.credential,qr.exitPin);
      setStatus(`Registered as ${enrolled.name}`);
      onActivated(reg);
    }catch(e){
      setError(e instanceof Error?e.message:String(e));setStatus("Scan a valid, unexpired kiosk QR code");
      setTimeout(()=>{scanLock.current=false},1800);
    }finally{setBusy(false)}
  }

  const scanner=useCodeScanner({codeTypes:["qr"],onCodeScanned:codes=>{const value=codes[0]?.value;if(value)void activate(value)}});
  return <SafeAreaView style={s.root}>
    <View style={s.header}><View style={s.mark}><Text style={s.markText}>L</Text></View><View><Text style={s.title}>Register this kiosk</Text><Text style={s.copy}>Scan the one-time QR code created in Ledgerly web.</Text></View></View>
    <View style={s.cameraBox}>{device&&permission.hasPermission?<Camera style={StyleSheet.absoluteFill} device={device} isActive={!busy} codeScanner={scanner}/>:<View style={s.permission}><Text style={s.permissionTitle}>Camera permission required</Text><Text style={s.permissionText}>Ledgerly needs the rear camera to scan the kiosk registration QR code.</Text><TouchableOpacity style={s.permissionButton} onPress={()=>void permission.requestPermission()}><Text style={s.permissionButtonText}>Allow camera</Text></TouchableOpacity></View>}<View pointerEvents="none" style={s.overlay}><View style={s.scanFrame}/><Text style={s.hint}>{busy?"Registering…":"Place the QR code inside the frame"}</Text></View></View>
    <View style={s.statusCard}><Text style={s.status}>{status}</Text>{error?<Text style={s.error}>{error}</Text>:<Text style={s.note}>The QR code works once and expires after 10 minutes. No permanent credential is displayed or typed.</Text>}</View>
  </SafeAreaView>
}

const s=StyleSheet.create({root:{flex:1,backgroundColor:"#071b13",padding:20},header:{flexDirection:"row",alignItems:"center",gap:14,paddingVertical:18},mark:{width:52,height:52,borderRadius:15,backgroundColor:"#168957",alignItems:"center",justifyContent:"center"},markText:{color:"white",fontWeight:"900",fontSize:28},title:{fontSize:25,fontWeight:"900",color:"white"},copy:{color:"#a8c1b6",fontSize:13,marginTop:3},cameraBox:{flex:1,borderRadius:24,overflow:"hidden",backgroundColor:"#17372b",position:"relative"},overlay:{...StyleSheet.absoluteFill,alignItems:"center",justifyContent:"center"},scanFrame:{width:235,height:235,borderWidth:4,borderColor:"white",borderRadius:24,backgroundColor:"transparent"},hint:{color:"white",fontWeight:"800",marginTop:20,textShadowColor:"#000",textShadowRadius:7},permission:{flex:1,alignItems:"center",justifyContent:"center",padding:32},permissionTitle:{color:"white",fontSize:20,fontWeight:"900"},permissionText:{color:"#b5c9c0",textAlign:"center",lineHeight:20,marginTop:8},permissionButton:{backgroundColor:"#168957",borderRadius:11,paddingHorizontal:18,paddingVertical:12,marginTop:16},permissionButtonText:{color:"white",fontWeight:"900"},statusCard:{backgroundColor:"#f4f7f5",borderRadius:16,padding:16,marginTop:16},status:{color:"#173129",fontWeight:"800",fontSize:15},note:{color:"#66766f",fontSize:12,lineHeight:18,marginTop:5},error:{color:"#b4232c",fontSize:13,lineHeight:18,marginTop:6}});
