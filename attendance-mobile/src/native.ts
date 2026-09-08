import {NativeEventEmitter,NativeModules} from "react-native";
import type {Registration} from "./types";
type QueueRow={id:string;payload:string;attempts:number;lastError?:string|null};
export const DeviceManager=NativeModules.DeviceManager as {deviceFingerprint():Promise<string>;saveRegistration(apiUrl:string,deviceId:string,credential:string,exitPin:string):Promise<boolean>;getRegistration():Promise<Registration|null>;verifyExitPin(pin:string):Promise<boolean>;clearRegistration():Promise<boolean>};
export const OfflineStore=NativeModules.OfflineStore as {enqueue(id:string,payload:string):Promise<string>;pending(limit:number):Promise<QueueRow[]>;failed(limit:number):Promise<QueueRow[]>;acknowledge(ids:string[]):Promise<number>;fail(ids:string[],message:string):Promise<number>;reject(ids:string[],message:string):Promise<number>;retryFailed():Promise<boolean>;count():Promise<number>;failedCount():Promise<number>;putSecure(key:string,value:string):Promise<boolean>;getSecure(key:string):Promise<string|null>;removeSecure(key:string):Promise<number>};
export const KioskManager=NativeModules.KioskManager as {status():Promise<{deviceOwner:boolean;lockTaskPermitted:boolean}>;enter():Promise<boolean>;exit():Promise<boolean>};
export const LedgerlyNfc=NativeModules.LedgerlyNfc as {isSupported():Promise<boolean>;enable():Promise<boolean>;disable():Promise<boolean>};
export const FaceEngine=NativeModules.FaceEngine as {
  configure(matchThreshold:number,ambiguityMargin:number,livenessThreshold:number,qualityThreshold:number):Promise<boolean>;
  healthCheck():Promise<{healthy:boolean;provider:string;livenessRequired:boolean;templateCount:number;modelError?:string|null}>;
  replaceTemplates(templatesJson:string):Promise<number>;
  inspect(imagePath:string):Promise<{quality:number;yaw:number;roll:number;leftEyeOpen:number;rightEyeOpen:number;brightness:number;sharpness:number;faceArea:number;guidance:string;ready:boolean;detectionMs:number}>;
  enroll(imagePaths:string[],challenge:"EYES_CLOSED"|"TURN_HEAD"):Promise<{algorithmVersion:string;embeddingBase64:string;embeddingsBase64:string[];qualityScore:number;livenessScore:number;poseCount:number;timings:FaceTimings}>;
  identify(imagePaths:string[],testMode:boolean,allowScreenImage:boolean,allowPrintedImage:boolean,challenge:"EYES_CLOSED"|"TURN_HEAD"):Promise<{personId:string;personType:"student"|"staff";confidence:number;secondBestConfidence:number;matchMargin:number;livenessScore:number;testMode:boolean;timings:FaceTimings}>;
  verify(personType:"student"|"staff",personId:string,imagePaths:string[],testMode:boolean,allowScreenImage:boolean,allowPrintedImage:boolean,challenge:"EYES_CLOSED"|"TURN_HEAD"):Promise<{matched:boolean;confidence:number;livenessScore:number;testMode:boolean}>;
};
export type FaceTimings={detectionMs:number;inferenceMs:number;searchMs?:number;totalMs:number;templates?:number};
export const nfcEvents=new NativeEventEmitter(NativeModules.LedgerlyNfc);
