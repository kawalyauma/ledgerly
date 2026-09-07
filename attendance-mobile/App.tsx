/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import {useEffect,useState} from "react";
import {StatusBar,View} from "react-native";
import {ActivationScreen} from "./src/ActivationScreen";
import {KioskScreen} from "./src/KioskScreen";
import {DeviceManager} from "./src/native";
import type {Registration} from "./src/types";

export default function App(){const[registration,setRegistration]=useState<Registration|null|undefined>(undefined);useEffect(()=>{DeviceManager.getRegistration().then(setRegistration).catch(()=>setRegistration(null))},[]);if(registration===undefined)return <View style={{flex:1,backgroundColor:"#081b14"}}/>;return <><StatusBar hidden/>{registration?<KioskScreen registration={registration} onReset={()=>setRegistration(null)}/>:<ActivationScreen onActivated={setRegistration}/>}</>}
