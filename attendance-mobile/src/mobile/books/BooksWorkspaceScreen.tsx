import {useState} from "react";
import {SafeAreaView,StatusBar,StyleSheet,Text,TouchableOpacity,View} from "react-native";
import type {MobileSession} from "../auth";
import type {SessionUpdater} from "../apiClient";
import {OverviewTab} from "./OverviewTab";
import {StockTab} from "./StockTab";
import {IssueTab} from "./IssueTab";
import {LedgerTab} from "./LedgerTab";
import {ReportsTab} from "./ReportsTab";

type Tab="overview"|"stock"|"issue"|"ledger"|"reports";

export function BooksWorkspaceScreen({session,onSession,onBack}:{session:MobileSession;onSession:SessionUpdater;onBack:()=>void}){
  const[tab,setTab]=useState<Tab>("overview");
  const render=()=>tab==="overview"?<OverviewTab session={session} onSession={onSession}/>:tab==="stock"?<StockTab session={session} onSession={onSession}/>:tab==="issue"?<IssueTab session={session} onSession={onSession}/>:tab==="ledger"?<LedgerTab session={session} onSession={onSession}/>:<ReportsTab session={session} onSession={onSession}/>;
  const tabs:[Tab,string,string][]=[["overview","Overview","⌂"],["stock","Stock","▣"],["issue","Issue","+"],["ledger","Ledger","L"],["reports","Reports","R"]];
  return <SafeAreaView style={s.root}><StatusBar barStyle="light-content" backgroundColor="#3b291d"/><View style={s.head}><TouchableOpacity style={s.back} onPress={onBack}><Text style={s.backText}>←</Text></TouchableOpacity><View><Text style={s.eyebrow}>LEDGERLY MOBILE · MODULE 05</Text><Text style={s.title}>Books</Text></View><View style={s.badge}><Text style={s.badgeText}>A4 · SMALL</Text></View></View><View style={s.body}>{render()}</View><View style={s.nav}>{tabs.map(([id,label,icon])=><TouchableOpacity key={id} onPress={()=>setTab(id)} style={s.navItem}><View style={[s.navIcon,tab===id&&s.navIconOn]}><Text style={[s.navGlyph,tab===id&&s.navGlyphOn]}>{icon}</Text></View><Text style={[s.navText,tab===id&&s.navTextOn]}>{label}</Text></TouchableOpacity>)}</View></SafeAreaView>;
}

const s=StyleSheet.create({root:{flex:1,backgroundColor:"#f7f5f1"},head:{height:74,backgroundColor:"#3b291d",flexDirection:"row",alignItems:"center",paddingHorizontal:14},back:{width:38,height:38,borderRadius:13,backgroundColor:"#5b4030",alignItems:"center",justifyContent:"center",marginRight:12},backText:{fontSize:21,color:"white"},eyebrow:{fontSize:7,fontWeight:"900",letterSpacing:1.1,color:"#e7bb7d"},title:{fontSize:20,fontWeight:"900",color:"white",marginTop:2},badge:{marginLeft:"auto",borderRadius:14,backgroundColor:"#f5e6d0",paddingHorizontal:10,paddingVertical:7},badgeText:{fontSize:8,fontWeight:"900",color:"#7d522f"},body:{flex:1},nav:{height:72,backgroundColor:"white",borderTopWidth:1,borderTopColor:"#e8e0d6",flexDirection:"row",paddingHorizontal:5,paddingTop:7},navItem:{flex:1,alignItems:"center"},navIcon:{width:31,height:28,borderRadius:10,alignItems:"center",justifyContent:"center"},navIconOn:{backgroundColor:"#f4e9dc"},navGlyph:{fontSize:12,fontWeight:"900",color:"#9a9086"},navGlyphOn:{color:"#8b5a34"},navText:{fontSize:7.5,fontWeight:"900",color:"#9a9086",marginTop:3},navTextOn:{color:"#8b5a34"}});
