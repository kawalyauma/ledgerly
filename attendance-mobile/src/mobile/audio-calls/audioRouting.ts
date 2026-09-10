import {NativeModules,Platform} from "react-native";

type AudioCallAudioNative={start:(speaker:boolean,peerName:string)=>void;setSpeaker:(speaker:boolean)=>void;stop:()=>void};
const native=NativeModules.AudioCallAudio as AudioCallAudioNative|undefined;

export const audioRouting={
 start(speaker=false,peerName="Ledgerly worker"){if(Platform.OS==="android")native?.start(speaker,peerName)},
 setSpeaker(speaker:boolean){if(Platform.OS==="android")native?.setSpeaker(speaker)},
 stop(){if(Platform.OS==="android")native?.stop()},
};
