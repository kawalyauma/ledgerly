import { randomUUID } from "node:crypto";

function id(prefix){return `${prefix}_${randomUUID().replaceAll('-','')}`;}
function parse(value,fallback){if(value==null)return fallback;if(typeof value!=="string")return value;try{return JSON.parse(value)}catch{return fallback}}

export class TasksWorkWorker {
  constructor({queue,database,notifications,maxAttempts=5}){if(!queue||!database||!notifications)throw new TypeError("TasksWorkWorker requires queue, database and notifications");this.queue=queue;this.database=database;this.notifications=notifications;this.maxAttempts=maxAttempts;}

  async scanReminders(organizationId,now=new Date()){
    const result=await this.database.query(`SELECT t.id,t.task_number,t.title,t.due_at,a.user_id,u.email,u.display_name,
      COALESCE(sp.phone,sfp.phone) AS phone,o.name AS organization_name
      FROM work_tasks t JOIN work_task_assignees a ON a.task_id=t.id JOIN users u ON u.id=a.user_id JOIN organizations o ON o.id=t.organization_id
      LEFT JOIN school_user_profiles sp ON sp.organization_id=t.organization_id AND sp.user_id=a.user_id
      LEFT JOIN school_staff_profiles sfp ON sfp.organization_id=t.organization_id AND sfp.user_id=a.user_id AND sfp.deleted_at IS NULL
      WHERE t.organization_id=$1 AND t.archived_at IS NULL AND t.status NOT IN ('completed','cancelled') AND t.due_at IS NOT NULL
        AND t.due_at<=$2::timestamptz+interval '24 hours' AND t.due_at>$2::timestamptz-interval '7 days'`,[organizationId,now.toISOString()]);
    let created=0,queued=0;
    for(const task of result.rows){
      const type=new Date(task.due_at).getTime()<now.getTime()?"overdue":"due_soon";
      const day=now.toISOString().slice(0,10),key=`${task.id}:${task.user_id}:${type}:${day}`;
      const inserted=await this.database.query(`INSERT INTO work_task_reminders(id,organization_id,task_id,user_id,reminder_type,reminder_key,sent_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(reminder_key) DO NOTHING RETURNING id`,[id("wrm"),organizationId,task.id,task.user_id,type,key,now.toISOString()]);
      if(!inserted.rows[0])continue;
      created+=1;
      const title=type==="overdue"?"Task overdue":"Task due soon",body=`Task #${task.task_number}: ${task.title}`;
      const notificationId=id("wnt");
      await this.database.query(`INSERT INTO work_notifications(id,organization_id,user_id,event_type,title,body,entity_type,entity_id,data_json) VALUES($1,$2,$3,$4,$5,$6,'task',$7,'{}')`,[notificationId,organizationId,task.user_id,`task.${type}`,title,body,task.id]);
      const pref=(await this.database.query(`SELECT email,sms,whatsapp FROM work_notification_preferences WHERE organization_id=$1 AND user_id=$2 AND event_type=$3`,[organizationId,task.user_id,`task.${type}`])).rows[0]??null;
      const channels=[
        {channel:"email",recipient:task.email,enabled:pref?Boolean(pref.email):true},
        {channel:"sms",recipient:task.phone,enabled:Boolean(pref?.sms)},
        {channel:"whatsapp",recipient:task.phone,enabled:Boolean(pref?.whatsapp)},
      ];
      for(const item of channels){
        if(!item.enabled||!item.recipient)continue;
        const deliveryId=id("wnd");
        const delivery=await this.database.query(`INSERT INTO work_notification_deliveries(id,organization_id,notification_id,channel,recipient,provider,status) VALUES($1,$2,$3,$4,$5,$6,'queued') ON CONFLICT(notification_id,channel,recipient) DO NOTHING RETURNING id`,[deliveryId,organizationId,notificationId,item.channel,item.recipient,item.channel==="email"?"resend":item.channel==="sms"?"egosms":"whatsapp-support-hub"]);
        if(!delivery.rows[0])continue;
        await this.queue.enqueue({jobId:id("job"),kind:"tasks-work.notification-delivery",organizationId,payload:{deliveryId,notificationId,channel:item.channel,recipient:item.recipient,title,body,recipientName:task.display_name,senderName:task.organization_name},attempt:0,idempotencyKey:`tasks-work-delivery:${deliveryId}`});
        queued+=1;
      }
    }
    return{created,queued};
  }

  async deliver(job){
    const deliveryId=job.payload?.deliveryId;
    const delivery=(await this.database.query(`SELECT id,status,attempts FROM work_notification_deliveries WHERE id=$1 AND organization_id=$2`,[deliveryId,job.organizationId])).rows[0];
    if(!delivery||["sent","delivered"].includes(delivery.status))return{skipped:true};
    await this.database.query(`UPDATE work_notification_deliveries SET status='sending',attempts=attempts+1,last_error=NULL WHERE id=$1 AND organization_id=$2`,[deliveryId,job.organizationId]);
    try{
      const result=await this.notifications.send({organizationId:job.organizationId,deliveryId,channel:job.payload.channel,recipient:job.payload.recipient,subject:job.payload.title,body:job.payload.body,recipientName:job.payload.recipientName,senderName:job.payload.senderName});
      await this.database.query(`UPDATE work_notification_deliveries SET status='sent',provider_message_id=$1,sent_at=now(),last_error=NULL WHERE id=$2 AND organization_id=$3`,[result.providerMessageId??null,deliveryId,job.organizationId]);
      return{sent:true};
    }catch(error){
      await this.database.query(`UPDATE work_notification_deliveries SET status='failed',last_error=$1 WHERE id=$2 AND organization_id=$3`,[error instanceof Error?error.message.slice(0,1000):String(error),deliveryId,job.organizationId]);
      throw error;
    }
  }

  async runOnce(){
    const taken=await this.queue.take();if(!taken)return{processed:0};const{job,receipt}=taken;
    try{
      if(job.kind==="tasks-work.reminders.scan")await this.scanReminders(job.organizationId,new Date(job.payload?.scheduledFor??Date.now()));
      else if(job.kind==="tasks-work.notification-delivery")await this.deliver(job);
      else{const retried=await this.queue.retry(receipt,{reason:"unsupported_tasks_work_job"});return{processed:0,unsupported:true,deadLettered:Boolean(retried?.deadLettered)};}
      await this.queue.ack(receipt);return{processed:1,jobId:job.jobId};
    }catch(error){
      const attempt=Number(job.attempt??0)+1;
      const delay=new Date(Date.now()+Math.min(3600000,30000*(2**Math.min(attempt,7))));
      const retried=await this.queue.retry(receipt,{reason:error instanceof Error?error.message:String(error),delayUntil:delay});
      return{processed:0,retried:!retried?.deadLettered,deadLettered:Boolean(retried?.deadLettered)};
    }
  }
}
