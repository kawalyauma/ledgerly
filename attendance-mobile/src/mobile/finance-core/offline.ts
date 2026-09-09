import {MobileSyncStore} from "../../native";
import {MobileApiError} from "../auth";
import {localMobileRecord,localMobileRecords,queueMobileMutation} from "../syncEngine";
import type {Account,BankAccount,Dimension,FinanceDashboard,FinanceDocument,FinanceProject,FiscalPeriod,Journal,Product} from "./types";

type R=Record<string,any>;
const MODULE="ledgerly-core";
const uid=(prefix:string)=>`${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
export const financeNetworkError=(e:any)=>e?.code==="NETWORK_ERROR"||e?.status===0;
export async function financeOfflineFallback<T>(online:()=>Promise<T>,offline:()=>Promise<T>){try{return await online()}catch(e){if(financeNetworkError(e))return offline();throw e}}
const rows=async<T=R>(collection:string)=>((await localMobileRecords<T>(MODULE,collection,1000,0)).map(x=>({...(x.payload as any),id:x.id})) as T[]);
const record=async<T=R>(collection:string,id:string)=>{const x=await localMobileRecord<T>(MODULE,collection,id);return x?({...((x.payload||{}) as any),id:x.id} as T):null};
const pending=async(collection:string)=>(await MobileSyncStore.pendingOperations(250)).filter(x=>x.moduleKey===MODULE&&x.collectionKey===collection);

export const offlineAccounts=async()=>rows<Account>("accounts");
export const offlineProducts=async()=>rows<Product>("products");
export const offlineProjects=async()=>rows<FinanceProject>("projects");
export const offlineDimensions=async(type?:string)=>(await rows<Dimension>("dimensions")).filter(x=>!type||x.type===type);
export const offlineBankAccounts=async()=>rows<BankAccount>("bank-accounts");
export const offlinePeriods=async()=>rows<FiscalPeriod>("fiscal-periods");
export const offlineContacts=async()=>((await localMobileRecords<R>("contacts","contacts",1000,0)).map(x=>({...((x.payload||{}) as R),id:x.id}))).filter(x=>x.active!==false);
export const offlineDocuments=async(type?:string)=>((await rows<FinanceDocument>("documents")).filter(x=>!type||x.type===type));
export const offlineJournals=async()=>rows<Journal>("journals");
export async function offlineDocument(id:string){const doc=await record<R>("documents",id);if(!doc)throw new MobileApiError(404,"OFFLINE_DOCUMENT_NOT_FOUND","Document is not available in the offline replica.");const lines=(await rows<R>("document-lines")).filter(x=>x.documentId===id);return{...doc,lines}}
export async function offlineJournal(id:string){const journal=await record<R>("journals",id);if(!journal)throw new MobileApiError(404,"OFFLINE_JOURNAL_NOT_FOUND","Journal is not available in the offline replica.");const lines=(await rows<R>("journal-lines")).filter(x=>x.journalEntryId===id);return{...journal,lines}}

export async function offlineReference(){return{accounts:await offlineAccounts(),contacts:await offlineContacts(),products:await offlineProducts(),projects:await offlineProjects(),dimensions:await offlineDimensions(),taxCodes:[],bankAccounts:await offlineBankAccounts()}}
export async function offlineDashboard():Promise<FinanceDashboard>{
 const[journals,documents]=await Promise.all([offlineJournals(),offlineDocuments()]);
 const posted=journals.filter(x=>x.status==="posted"),outstanding=documents.filter(x=>Number(x.totalMinor||0)>Number(x.paidMinor||0));
 return{organization:{name:"Ledgerly",baseCurrency:String(posted[0]?.currency||documents[0]?.currency||"UGX")},user:{name:"Offline user"},period:{from:"",to:"",label:"Offline replica"},metrics:{balanceMinor:0,moneyInMinor:0,moneyOutMinor:0,outstandingMinor:outstanding.reduce((n,x)=>n+Math.max(0,Number(x.totalMinor||0)-Number(x.paidMinor||0)),0),outstandingCount:outstanding.length},cashFlow:[],transactions:posted.slice(0,50).map(x=>({id:x.id,entryNumber:Number(x.entryNumber||0),postingDate:x.postingDate,description:x.description,reference:x.reference,status:x.status,currency:x.currency,amountMinor:0,direction:"income" as const})),generatedAt:new Date().toISOString()};
}

export async function queueDocumentIntent(body:R){
 if(!["invoice","bill"].includes(String(body.type)))throw new MobileApiError(409,"OFFLINE_DOCUMENT_TYPE_NOT_ALLOWED","Only invoice and bill drafts can be created offline.");
 const id=uid("fdi");await queueMobileMutation({moduleKey:MODULE,collectionKey:"document-intents",recordId:id,payload:body,baseVersion:0});return{id,intentType:body.type,status:"pending",clientCreatedAt:new Date().toISOString(),offlineQueued:true};
}
export async function queueJournalIntent(body:R){
 const id=uid("fji");await queueMobileMutation({moduleKey:MODULE,collectionKey:"journal-intents",recordId:id,payload:body,baseVersion:0});return{id,status:"pending",clientCreatedAt:new Date().toISOString(),offlineQueued:true};
}
export async function offlineIntentStatuses(){const[d,j]=await Promise.all([rows<R>("document-intents"),rows<R>("journal-intents")]),pd=await pending("document-intents"),pj=await pending("journal-intents");return{documents:[...d,...pd.map(x=>({id:x.recordId,status:"queued",clientCreatedAt:x.clientTimestamp}))],journals:[...j,...pj.map(x=>({id:x.recordId,status:"queued",clientCreatedAt:x.clientTimestamp}))]}}
