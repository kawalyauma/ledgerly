import {SafeAreaView,StatusBar,StyleSheet,Text,TouchableOpacity,View} from "react-native";
import type {MobileSession} from "../auth";
import type {SessionUpdater} from "../apiClient";
import {OverviewTab} from "./OverviewTab";
import {RegistersTab} from "./RegistersTab";
import {RecordsTab} from "./RecordsTab";
import {AdminTab} from "./AdminTab";
import {useState} from "react";

type Tab="overview"|"registers"|"records"|"admin";
const tabs:{id:Tab;label:string;icon:string}[]=[{id:"overview",label:"Overview",icon:"⌂"},{id:"registers",label:"Registers",icon:"✓"},{id:"records",label:"Records",icon:"≡"},{id:"admin",label:"Admin",icon:"⚙"}];
export function AttendanceWorkspaceScreen({session,onSession,onBack,onOpenKiosk}:{session:MobileSession;onSession:SessionUpdater;onBack:()=>void;onOpenKiosk:()=>void}){
  const[tab,setTab]=useState<Tab>("overview");
  const common={session,onSession};
  return <SafeAreaView style={s.root}><StatusBar barStyle="light-content" backgroundColor="#071c16"/>
    <View style={s.header}><TouchableOpacity onPress={onBack} style={s.back}><Text style={s.backText}>←</Text></TouchableOpacity><View style={{flex:1}}><Text style={s.eyebrow}>LEDGERLY MOBILE · MODULE 01</Text><Text style={s.title}>Attendance</Text></View><TouchableOpacity style={s.kiosk} onPress={onOpenKiosk}><Text style={s.kioskText}>Kiosk</Text></TouchableOpacity></View>
    <View style={s.body}>{tab==="overview"?<OverviewTab {...common} onOpenRegisters={()=>setTab("registers")} onOpenRecords={()=>setTab("records")}/>:tab==="registers"?<RegistersTab {...common}/>:tab==="records"?<RecordsTab {...common}/>:<AdminTab {...common}/>}</View>
    <View style={s.nav}>{tabs.map(x=><TouchableOpacity key={x.id} activeOpacity={.8} onPress={()=>setTab(x.id)} style={s.navItem}><View style={[s.navIcon,tab===x.id&&s.navIconActive]}><Text style={[s.navIconText,tab===x.id&&s.navIconTextActive]}>{x.icon}</Text></View><Text style={[s.navText,tab===x.id&&s.navTextActive]}>{x.label}</Text></TouchableOpacity>)}</View>
  </SafeAreaView>
}
const s=StyleSheet.create({root:{flex:1,backgroundColor:"#f3f6f4"},header:{height:72,backgroundColor:"#071c16",paddingHorizontal:16,flexDirection:"row",alignItems:"center"},back:{width:38,height:38,borderRadius:12,backgroundColor:"#14382d",alignItems:"center",justifyContent:"center",marginRight:11},backText:{color:"white",fontSize:21},eyebrow:{color:"#6e9987",fontSize:8,fontWeight:"900",letterSpacing:1},title:{color:"white",fontSize:20,fontWeight:"900",marginTop:1},kiosk:{borderRadius:12,backgroundColor:"#164a37",paddingHorizontal:13,paddingVertical:10},kioskText:{color:"#78d8ab",fontSize:10,fontWeight:"900"},body:{flex:1},nav:{height:72,backgroundColor:"white",borderTopWidth:1,borderTopColor:"#dfe7e2",flexDirection:"row",paddingHorizontal:7,paddingBottom:4},navItem:{flex:1,alignItems:"center",justifyContent:"center"},navIcon:{width:30,height:28,borderRadius:10,alignItems:"center",justifyContent:"center"},navIconActive:{backgroundColor:"#e6f6ee"},navIconText:{fontSize:15,color:"#7f8f87",fontWeight:"900"},navIconTextActive:{color:"#148e5b"},navText:{fontSize:8,fontWeight:"900",color:"#84928b",marginTop:2},navTextActive:{color:"#148e5b"}});
