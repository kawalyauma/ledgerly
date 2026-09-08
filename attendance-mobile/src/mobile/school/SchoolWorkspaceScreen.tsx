import {useState} from "react";
import {SafeAreaView,StatusBar,StyleSheet,Text,TouchableOpacity,View} from "react-native";
import type {MobileSession} from "../auth";
import type {SessionUpdater} from "../apiClient";
import {AdminTab} from "./AdminTab";
import {OperationsTab} from "./OperationsTab";
import {OverviewTab} from "./OverviewTab";
import {StaffTab} from "./StaffTab";
import {StudentsTab} from "./StudentsTab";

type Tab="overview"|"students"|"staff"|"operations"|"admin";
const tabs:{id:Tab;label:string;icon:string}[]=[{id:"overview",label:"Overview",icon:"⌂"},{id:"students",label:"Learners",icon:"◎"},{id:"staff",label:"Staff",icon:"♙"},{id:"operations",label:"Operations",icon:"▦"},{id:"admin",label:"Admin",icon:"⚙"}];
export function SchoolWorkspaceScreen({session,onSession,onBack}:{session:MobileSession;onSession:SessionUpdater;onBack:()=>void}){
 const[tab,setTab]=useState<Tab>("overview"),common={session,onSession};
 return <SafeAreaView style={s.root}><StatusBar barStyle="light-content" backgroundColor="#071c16"/>
  <View style={s.header}><TouchableOpacity style={s.back} onPress={onBack}><Text style={s.backText}>←</Text></TouchableOpacity><View style={{flex:1}}><Text style={s.eyebrow}>LEDGERLY MOBILE · MODULE 02</Text><Text style={s.title}>School Management</Text></View><View style={s.badge}><Text style={s.badgeText}>LIVE</Text></View></View>
  <View style={s.body}>{tab==="overview"?<OverviewTab {...common}/>:tab==="students"?<StudentsTab {...common}/>:tab==="staff"?<StaffTab {...common}/>:tab==="operations"?<OperationsTab {...common}/>:<AdminTab {...common}/>}</View>
  <View style={s.nav}>{tabs.map(x=><TouchableOpacity key={x.id} style={s.navItem} onPress={()=>setTab(x.id)}><View style={[s.navIcon,tab===x.id&&s.navIconActive]}><Text style={[s.navIconText,tab===x.id&&s.navIconTextActive]}>{x.icon}</Text></View><Text style={[s.navText,tab===x.id&&s.navTextActive]}>{x.label}</Text></TouchableOpacity>)}</View>
 </SafeAreaView>
}
const s=StyleSheet.create({root:{flex:1,backgroundColor:"#f3f6f4"},header:{height:72,backgroundColor:"#071c16",paddingHorizontal:16,flexDirection:"row",alignItems:"center"},back:{width:38,height:38,borderRadius:12,backgroundColor:"#14382d",alignItems:"center",justifyContent:"center",marginRight:11},backText:{color:"white",fontSize:21},eyebrow:{color:"#6e9987",fontSize:8,fontWeight:"900",letterSpacing:1},title:{color:"white",fontSize:19,fontWeight:"900",marginTop:1},badge:{borderRadius:12,backgroundColor:"#174735",paddingHorizontal:10,paddingVertical:7},badgeText:{fontSize:8,fontWeight:"900",color:"#67d5a1",letterSpacing:.8},body:{flex:1},nav:{height:72,backgroundColor:"white",borderTopWidth:1,borderTopColor:"#dfe7e2",flexDirection:"row",paddingHorizontal:3,paddingBottom:4},navItem:{flex:1,alignItems:"center",justifyContent:"center"},navIcon:{width:29,height:27,borderRadius:9,alignItems:"center",justifyContent:"center"},navIconActive:{backgroundColor:"#e6f6ee"},navIconText:{fontSize:14,color:"#7f8f87",fontWeight:"900"},navIconTextActive:{color:"#148e5b"},navText:{fontSize:7.5,fontWeight:"900",color:"#84928b",marginTop:2},navTextActive:{color:"#148e5b"}});
