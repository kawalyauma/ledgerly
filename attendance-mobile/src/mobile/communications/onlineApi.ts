import type {MobileSession} from "../auth";
import {ledgerlyRequest,query,type SessionUpdater} from "../apiClient";
import type {AudiencePreview,AudienceSpec,Campaign,CampaignDetail,CommunicationContext,CommunicationPreference,CommunicationProviderStatus,CommunicationSummary,Delivery,DisciplineIncidentOption,MessageType} from "./types";
type Client={session:MobileSession;onSession?:SessionUpdater};
const req=<T>(c:Client,path:string,init:RequestInit={})=>ledgerlyRequest<T>(c.session,path,init,c.onSession);
const json=(method:string,body?:unknown):RequestInit=>({method,headers:{"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
const num=(v:any)=>Number(v||0),yes=(v:any)=>v===true||v===1||v==="1";
const mt=(x:any):MessageType=>({...x,id:String(x.id),audienceDefaults:x.audienceDefaults&&typeof x.audienceDefaults==="object"?x.audienceDefaults:{},systemType:yes(x.systemType),active:x.active===undefined?true:yes(x.active)});
const campaign=(x:any):Campaign=>({id:String(x.id),typeKey:String(x.typeKey||x.type_key||""),moduleKey:String(x.moduleKey||x.module_key||""),name:String(x.name||"Campaign"),senderName:x.senderName??x.sender_name??null,subjectTemplate:x.subjectTemplate??x.subject_template??null,channels:Array.isArray(x.channels)?x.channels:JSON.parse(x.channels_json||"[]"),audienceKind:String(x.audienceKind||x.audience_kind||""),status:String(x.status||"draft"),scheduledAt:x.scheduledAt??x.scheduled_at??null,startedAt:x.startedAt??x.started_at??null,completedAt:x.completedAt??x.completed_at??null,recipientCount:num(x.recipientCount??x.recipient_count),skippedCount:num(x.skippedCount??x.skipped_count),deliveryCount:num(x.deliveryCount??x.delivery_count),sentCount:num(x.sentCount??x.sent_count),failedCount:num(x.failedCount??x.failed_count),createdAt:String(x.createdAt||x.created_at||""),createdByName:x.createdByName??null});
export const communicationsApi={
  manifest:(c:Client)=>req<any>(c,"/communications/manifest"),
  providers:(c:Client)=>req<CommunicationProviderStatus>(c,"/communications/providers"),
  summary:(c:Client)=>req<CommunicationSummary>(c,"/communications/summary"),
  context:(c:Client)=>req<CommunicationContext>(c,"/communications/context"),
  disciplineIncidents:(c:Client)=>req<DisciplineIncidentOption[]>(c,"/communications/audience-context/discipline-incidents"),
  messageTypes:async(c:Client)=>(await req<any[]>(c,"/communications/message-types")).map(mt),
  manageMessageTypes:async(c:Client)=>(await req<any[]>(c,"/communications/message-types/manage")).map(mt),
  createMessageType:async(c:Client,body:any)=>mt(await req<any>(c,"/communications/message-types",json("POST",body))),
  updateMessageType:async(c:Client,id:string,body:any)=>mt(await req<any>(c,`/communications/message-types/${id}`,json("PATCH",body))),
  preview:(c:Client,audience:AudienceSpec,channels:string[])=>req<AudiencePreview>(c,"/communications/audience/preview",json("POST",{audience,channels})),
  campaigns:async(c:Client,status?:string)=>{const d=await req<any>(c,`/communications/campaigns${query({status,limit:200})}`);return {items:(d.items||[]).map(campaign),pagination:d.pagination}},
  campaignDetail:async(c:Client,id:string)=>{const d=await req<any>(c,`/communications/campaigns/${id}`);return {...campaign(d),messageTemplate:d.message_template??d.messageTemplate,audience:d.audience||{},recipients:d.recipients||[],deliveries:d.deliveries||[]} as CampaignDetail},
  createCampaign:(c:Client,body:any)=>req<any>(c,"/communications/campaigns",json("POST",body)),
  sendCampaign:(c:Client,id:string)=>req<any>(c,`/communications/campaigns/${id}/send`,json("POST",{})),
  retryFailed:(c:Client,id:string)=>req<any>(c,`/communications/campaigns/${id}/retry-failed`,json("POST",{})),
  cancelCampaign:(c:Client,id:string)=>req<any>(c,`/communications/campaigns/${id}/cancel`,json("POST",{})),
  deliveries:async(c:Client,params:{channel?:string;status?:string}={})=>(await req<any[]>(c,`/communications/deliveries${query({...params,limit:500})}`)).map((x:any)=>({...x,attempts:num(x.attempts)} as Delivery)),
  preference:(c:Client,recipientType:string,recipientId:string)=>req<CommunicationPreference>(c,`/communications/preferences/${encodeURIComponent(recipientType)}/${encodeURIComponent(recipientId)}`),
  updatePreference:(c:Client,recipientType:string,recipientId:string,body:any)=>req<CommunicationPreference>(c,`/communications/preferences/${encodeURIComponent(recipientType)}/${encodeURIComponent(recipientId)}`,json("PUT",body)),
};
