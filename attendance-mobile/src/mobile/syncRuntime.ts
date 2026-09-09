import {useEffect,useRef} from "react";
import {AppState,Platform} from "react-native";
import type {MobileSession} from "./auth";
import type {DevicePurpose} from "./device-purpose/devicePurpose";
import {eligibleMobileSyncCollections,initializeMobileSync} from "./syncClient";
import {syncMobileNow} from "./syncEngine";

const ACTIVE_SYNC_INTERVAL_MS=5*60*1000;
const registration={
  deviceName:"Ledgerly Mobile",
  platform:(Platform.OS==="ios"?"ios":"android") as "android"|"ios",
  appVersion:"1.2.0",
  clientSchemaVersion:1,
};

type SessionUpdater=(session:MobileSession)=>void|Promise<void>;

export function useNormalMobileSync(session:MobileSession|null,purpose:DevicePurpose|null,onSession:SessionUpdater){
  const sessionRef=useRef(session),onSessionRef=useRef(onSession);
  useEffect(()=>{sessionRef.current=session},[session]);
  useEffect(()=>{onSessionRef.current=onSession},[onSession]);

  useEffect(()=>{
    if(purpose!=="normal"||!session)return;
    let cancelled=false,running=false,collections:Array<{moduleKey:string;collectionKey:string}>|null=null;
    const updateSession=async(next:MobileSession)=>{sessionRef.current=next;await onSessionRef.current(next)};
    const run=async()=>{
      if(cancelled||running)return;
      const current=sessionRef.current;if(!current)return;
      running=true;
      try{
        await initializeMobileSync(current,registration,updateSession);
        if(!collections){
          const eligible=await eligibleMobileSyncCollections();
          collections=eligible.map(c=>({moduleKey:c.moduleKey,collectionKey:c.collectionKey}));
        }
        if(collections.length)await syncMobileNow(sessionRef.current||current,registration,collections,updateSession,{maxPushBatches:10,maxPullRounds:20,pullLimit:500});
      }catch(error:any){
        if(error?.code!=="NETWORK_ERROR")console.warn("Ledgerly mobile sync deferred",error?.code||error?.message||error);
      }finally{running=false}
    };
    void run();
    const subscription=AppState.addEventListener("change",state=>{if(state==="active")void run()});
    const timer=setInterval(()=>{if(AppState.currentState==="active")void run()},ACTIVE_SYNC_INTERVAL_MS);
    return()=>{cancelled=true;clearInterval(timer);subscription.remove()};
  },[purpose,session?.apiUrl,session?.identifier,session?.organizationId]);
}
