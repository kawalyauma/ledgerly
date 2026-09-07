import type { Env } from "../../../src/types";
import { AppError } from "../../../src/lib/errors";
import { cleanString, newId } from "./common";

const hubHeaders=(env:Env,idempotencyKey?:string)=>({"X-API-Key":env.WHATSAPP_SUPPORT_APP_KEY!,"Content-Type":"application/json",...(idempotencyKey?{"Idempotency-Key":idempotencyKey}:{})});
export async function hubChat(env:Env,path:string,init:RequestInit={}){if(!env.WHATSAPP_SUPPORT_HUB_URL||!env.WHATSAPP_SUPPORT_APP_KEY)throw new AppError(422,"WHATSAPP_NOT_CONFIGURED","WhatsApp is not configured");const r=await fetch(`${env.WHATSAPP_SUPPORT_HUB_URL.replace(/\/$/,"")}${path}`,{...init,headers:{...hubHeaders(env),...(init.headers||{})}});const p=await r.json<any>().catch(()=>({}));if(!r.ok||p.success===false)throw new AppError(422,"WHATSAPP_HUB_ERROR",p.error?.message||`WhatsApp Hub failed with HTTP ${r.status}`);return p.data??p}

export async function ensureChatAccess(db:D1Database,orgId:string,userId:string,threadId:string){const row=await db.prepare(`SELECT t.* FROM work_chat_threads t JOIN work_chat_participants p ON p.thread_id=t.id WHERE t.id=? AND t.organization_id=? AND p.user_id=?`).bind(threadId,orgId,userId).first<Record<string,unknown>>();if(!row)throw new AppError(404,"CHAT_NOT_FOUND","Chat not found");return row}

export async function appendChatMessage(env:Env,input:{organizationId:string;threadId:string;senderUserId?:string|null;direction:"internal"|"inbound"|"outbound";messageType?:string;body?:string|null;fileKey?:string|null;fileName?:string|null;mimeType?:string|null;sizeBytes?:number|null;externalMessageId?:string|null;deliveryStatus?:string|null}){const id=newId("wcm");await env.FINANCE_DB.batch([
 env.FINANCE_DB.prepare(`INSERT INTO work_chat_messages(id,organization_id,thread_id,sender_user_id,direction,message_type,body,file_key,file_name,mime_type,size_bytes,external_message_id,delivery_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,input.organizationId,input.threadId,input.senderUserId||null,input.direction,input.messageType||"text",input.body||null,input.fileKey||null,input.fileName||null,input.mimeType||null,input.sizeBytes||null,input.externalMessageId||null,input.deliveryStatus||null),
 env.FINANCE_DB.prepare(`UPDATE work_chat_threads SET status=CASE WHEN ?='inbound' THEN 'open' ELSE status END,closed_at=CASE WHEN ?='inbound' THEN NULL ELSE closed_at END,closed_by=CASE WHEN ?='inbound' THEN NULL ELSE closed_by END,last_message_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(input.direction,input.direction,input.direction,input.threadId),
 env.FINANCE_DB.prepare(`UPDATE work_chat_participants SET unread_count=unread_count+1 WHERE thread_id=? AND user_id<>COALESCE(?,'')`).bind(input.threadId,input.senderUserId||null)
]);return id}

export function messageType(mime:string){if(mime.startsWith("audio/"))return "audio";if(mime.startsWith("image/"))return "image";if(mime.startsWith("video/"))return "video";return "document"}
export function safeFileName(name:string){return name.replace(/[^a-zA-Z0-9._ -]/g,"_").slice(0,180)||"attachment"}
export function inboundParts(payload:any){const c=payload?.data?.conversation||payload?.conversation||{};const m=payload?.data?.message||payload?.message||{};return {event:String(payload?.event||payload?.type||""),conversation:c,message:m,phone:String(c.phoneNumber||c.phone_number||""),name:cleanString(c.displayName||c.display_name||m.senderName||m.sender_name,200)}}
