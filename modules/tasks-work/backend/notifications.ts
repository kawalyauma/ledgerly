import type { Env, WorkNotificationJob } from "../../../src/types";
import { sha256 } from "../../../src/lib/crypto";
import { newId } from "./common";
import { sendEmail, sendSms, sendWhatsApp, verifyWhatsAppSignature, workWebhookReceiptId } from "./communications";
import { appendChatMessage, inboundParts } from "./chat";

export type NotifyWorkInput = {
  organizationId: string;
  userId: string;
  eventType: string;
  title: string;
  body: string;
  entityType?: string;
  entityId?: string;
  data?: Record<string, unknown>;
};

export async function notifyWork(env: Env, input: NotifyWorkInput) {
  const notificationId = newId("wnt");
  await env.FINANCE_DB.prepare(`INSERT INTO work_notifications
    (id,organization_id,user_id,event_type,title,body,entity_type,entity_id,data_json)
    VALUES (?,?,?,?,?,?,?,?,?)`).bind(notificationId,input.organizationId,input.userId,input.eventType,input.title,input.body,input.entityType||null,input.entityId||null,JSON.stringify(input.data||{})).run();

  const user = await env.FINANCE_DB.prepare(`SELECT u.email,u.display_name AS displayName,COALESCE(sp.phone,sfp.phone) AS phone,o.name AS organizationName
    FROM users u
    JOIN organizations o ON o.id=?
    LEFT JOIN school_user_profiles sp ON sp.user_id=u.id AND sp.organization_id=o.id
    LEFT JOIN school_staff_profiles sfp ON sfp.user_id=u.id AND sfp.organization_id=o.id AND sfp.deleted_at IS NULL
    WHERE u.id=?`).bind(input.organizationId,input.userId).first<{email:string;displayName:string;phone:string|null;organizationName:string}>();
  const pref = await env.FINANCE_DB.prepare(`SELECT * FROM work_notification_preferences WHERE organization_id=? AND user_id=? AND event_type=?`).bind(input.organizationId,input.userId,input.eventType).first<Record<string,number>>();
  const channels = [
    {channel:"email" as const,recipient:user?.email||null,enabled:(pref?Boolean(pref.email):true)&&Boolean(env.RESEND_API_KEY&&env.RESEND_FROM_EMAIL),provider:"resend"},
    {channel:"sms" as const,recipient:user?.phone||null,enabled:Boolean(pref?.sms)&&Boolean(env.EGOSMS_USERNAME&&env.EGOSMS_PASSWORD&&env.EGOSMS_SENDER_ID),provider:"egosms"},
    {channel:"whatsapp" as const,recipient:user?.phone||null,enabled:Boolean(pref?.whatsapp)&&Boolean(env.WHATSAPP_SUPPORT_APP_KEY&&env.WHATSAPP_SUPPORT_HUB_URL),provider:"ulib_whatsapp_hub"},
  ];
  for (const item of channels) {
    if (!item.enabled || !item.recipient || !env.WORK_NOTIFICATION_QUEUE) continue;
    const deliveryId = newId("wnd");
    const insert = await env.FINANCE_DB.prepare(`INSERT OR IGNORE INTO work_notification_deliveries
      (id,organization_id,notification_id,channel,recipient,provider) VALUES (?,?,?,?,?,?)`).bind(deliveryId,input.organizationId,notificationId,item.channel,item.recipient,item.provider).run();
    if (!insert.meta.changes) continue;
    await env.WORK_NOTIFICATION_QUEUE.send({
      kind:"work-notification",deliveryId,organizationId:input.organizationId,notificationId,
      channel:item.channel,recipient:item.recipient,subject:input.title,body:input.body,
      ...(item.channel==="whatsapp"?{templateName:"general_app_update",templateLanguage:"en_US",variables:[user?.displayName||"Team member",user?.organizationName||"Ledgerly",input.title,input.body]}:{}),
    },{contentType:"json"});
  }
  return notificationId;
}

export async function consumeWorkNotifications(batch: MessageBatch<WorkNotificationJob>, env: Env) {
  for (const message of batch.messages) {
    const job = message.body;
    try {
      await env.FINANCE_DB.prepare(`UPDATE work_notification_deliveries SET status='sending',attempts=attempts+1 WHERE id=? AND status NOT IN ('sent','delivered')`).bind(job.deliveryId).run();
      let providerId = "";
      if (job.channel === "email") providerId = await sendEmail(env, job.recipient, job.subject || "Tasks & Work", job.body);
      else if (job.channel === "sms") providerId = await sendSms(env, job.recipient, job.body);
      else {
        const result = await sendWhatsApp(env, job.recipient, job.body, job.deliveryId, job.templateName ? {name:job.templateName,language:job.templateLanguage,variables:job.variables} : undefined);
        providerId = String(result.messageId || result.id || "");
        if(result.conversationId)await env.FINANCE_DB.prepare(`UPDATE work_notification_deliveries SET provider_conversation_id=? WHERE id=?`).bind(String(result.conversationId),job.deliveryId).run();
      }
      await env.FINANCE_DB.prepare(`UPDATE work_notification_deliveries SET status='sent',provider_message_id=?,sent_at=CURRENT_TIMESTAMP,last_error=NULL WHERE id=?`).bind(providerId,job.deliveryId).run();
      message.ack();
    } catch (error) {
      await env.FINANCE_DB.prepare(`UPDATE work_notification_deliveries SET status='failed',last_error=? WHERE id=?`).bind(error instanceof Error?error.message.slice(0,1000):"Unknown delivery error",job.deliveryId).run();
      message.retry({delaySeconds:Math.min(3600,30*2**message.attempts)});
    }
  }
}

export async function runWorkReminders(env: Env) {
  const rows = await env.FINANCE_DB.prepare(`SELECT t.id,t.organization_id,t.task_number,t.title,t.due_at,ta.user_id
    FROM work_tasks t JOIN work_task_assignees ta ON ta.task_id=t.id
    WHERE t.archived_at IS NULL AND t.status NOT IN ('completed','cancelled') AND t.due_at IS NOT NULL
      AND datetime(t.due_at)<=datetime('now','+24 hours') AND datetime(t.due_at)>datetime('now','-7 days')`).all<{id:string;organization_id:string;task_number:number;title:string;due_at:string;user_id:string}>();
  for (const task of rows.results) {
    const type = new Date(task.due_at).getTime() < Date.now() ? "overdue" : "due_soon";
    const key = `${task.id}:${task.user_id}:${type}:${new Date().toISOString().slice(0,10)}`;
    const inserted = await env.FINANCE_DB.prepare(`INSERT OR IGNORE INTO work_task_reminders (id,organization_id,task_id,user_id,reminder_type,reminder_key) VALUES (?,?,?,?,?,?)`).bind(newId("wrm"),task.organization_id,task.id,task.user_id,type,key).run();
    if (inserted.meta.changes) await notifyWork(env,{organizationId:task.organization_id,userId:task.user_id,eventType:`task.${type}`,title:type==="overdue"?"Task overdue":"Task due soon",body:`Task #${task.task_number}: ${task.title}`,entityType:"task",entityId:task.id});
  }
}

export async function handleWorkWhatsAppWebhook(request: Request, env: Env) {
  const rawBody = await request.text();
  if (!await verifyWhatsAppSignature(rawBody,request.headers.get("x-support-signature"),env.WHATSAPP_SUPPORT_WEBHOOK_SECRET)) {
    return Response.json({success:false,error:{code:"INVALID_SIGNATURE",message:"Invalid WhatsApp Hub signature"}},{status:401});
  }
  const deliveryId = await workWebhookReceiptId(request,rawBody);
  const payloadHash = await sha256(rawBody);
  let eventType: string | null = null;let payload:any=null;
  try { payload=JSON.parse(rawBody);eventType = String(payload.event || payload.type || "") || null; } catch { /* raw payload retained by hash only */ }
  const insert = await env.FINANCE_DB.prepare(`INSERT OR IGNORE INTO work_webhook_receipts (id,source,event_type,payload_hash) VALUES (?,?,?,?)`).bind(deliveryId,"ulib_whatsapp_hub",eventType,payloadHash).run();
  if (!insert.meta.changes) return Response.json({success:true,data:{received:true,duplicate:true,deliveryId}});
  if(payload&&(eventType==="message.received"||eventType==="conversation.started")){
    const {conversation,message,phone,name}=inboundParts(payload),hubId=String(conversation.id||conversation.conversationId||"");
    if(hubId){let thread=await env.FINANCE_DB.prepare(`SELECT * FROM work_chat_threads WHERE whatsapp_conversation_id=?`).bind(hubId).first<any>();
      if(!thread){const delivery=await env.FINANCE_DB.prepare(`SELECT d.organization_id,d.notification_id,n.user_id,n.title FROM work_notification_deliveries d JOIN work_notifications n ON n.id=d.notification_id WHERE d.provider_conversation_id=? OR (d.channel='whatsapp' AND d.recipient=? ) ORDER BY d.created_at DESC LIMIT 1`).bind(hubId,phone).first<any>();
        if(delivery){const id=newId("wct");await env.FINANCE_DB.prepare(`INSERT INTO work_chat_threads(id,organization_id,kind,title,notification_id,whatsapp_conversation_id,external_phone,external_name,created_by) VALUES(?,?,?,?,?,?,?,?,?)`).bind(id,delivery.organization_id,"whatsapp",delivery.title||`WhatsApp · ${name||phone}`,delivery.notification_id,hubId,phone||null,name||null,delivery.user_id).run();await env.FINANCE_DB.prepare(`INSERT INTO work_chat_participants(thread_id,user_id,unread_count) VALUES(?,?,0)`).bind(id,delivery.user_id).run();thread={id,organization_id:delivery.organization_id}}
      }
      if(thread&&message.id&&!await env.FINANCE_DB.prepare(`SELECT 1 FROM work_chat_messages WHERE external_message_id=?`).bind(String(message.id)).first()){await appendChatMessage(env,{organizationId:thread.organization_id,threadId:thread.id,direction:"inbound",messageType:String(message.type||message.messageType||"text"),body:String(message.content||message.text||""),externalMessageId:String(message.id)});}
    }
  }
  await env.FINANCE_DB.prepare("UPDATE work_webhook_receipts SET processed_at=CURRENT_TIMESTAMP WHERE id=?").bind(deliveryId).run();
  return Response.json({success:true,data:{received:true,deliveryId}});
}
