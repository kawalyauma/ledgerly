import { randomUUID } from 'node:crypto';

export class WorkConflictError extends Error {
  constructor(message, code = 'WORK_CONFLICT', status = 409) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function assertTaskTenant(tx, organizationId, taskId, { forUpdate = false } = {}) {
  const result = await tx.query(`SELECT id,organization_id,project_id,parent_task_id,task_number,title,description,status,priority,
    start_at,due_at,completed_at,estimated_minutes,actual_minutes,progress,recurrence_json,updated_by,updated_at,archived_at
    FROM work_tasks WHERE id=$1 AND organization_id=$2 ${forUpdate ? 'FOR UPDATE' : ''}`,[taskId,organizationId]);
  if (!result.rows[0]) throw new WorkConflictError('Task not found in this organization','TASK_SCOPE',404);
  return result.rows[0];
}

async function assertOrganizationUser(tx, organizationId, userId) {
  const result = await tx.query(`SELECT u.id
    FROM users u
    WHERE u.id=$2 AND (
      EXISTS(SELECT 1 FROM memberships m WHERE m.organization_id=$1 AND m.user_id=u.id)
      OR EXISTS(SELECT 1 FROM school_staff_profiles sp WHERE sp.organization_id=$1 AND sp.user_id=u.id AND sp.deleted_at IS NULL)
    )`,[organizationId,userId]);
  if (!result.rows[0]) throw new WorkConflictError('Assignee is not an organization member or linked staff user','ASSIGNEE_SCOPE');
}

export async function assignTask(database,{organizationId,taskId,userId,actorUserId,audit=null,events=null}) {
  const result = await database.transaction(async tx=>{
    await assertTaskTenant(tx,organizationId,taskId,{forUpdate:true});
    await assertOrganizationUser(tx,organizationId,userId);
    await tx.query(`INSERT INTO work_task_assignees(task_id,user_id,assigned_by,assigned_at) VALUES($1,$2,$3,now()) ON CONFLICT(task_id,user_id) DO NOTHING`,[taskId,userId,actorUserId??null]);
    return {taskId,userId};
  });
  await audit?.write?.({organizationId,actor:{type:'human',id:actorUserId},action:'tasks-work.task.assigned',entityType:'work_task',entityId:taskId,metadata:{userId}});
  await events?.publish?.({organizationId,type:'tasks-work.task.assigned',payload:{taskId,userId,actorUserId:actorUserId??null}});
  return result;
}

export async function updateTaskWithConflictCheck(database,{organizationId,taskId,expectedUpdatedAt,patch,actorUserId,emitChange=null}) {
  const allowed={title:'title',description:'description',status:'status',priority:'priority',startAt:'start_at',dueAt:'due_at',completedAt:'completed_at',estimatedMinutes:'estimated_minutes',actualMinutes:'actual_minutes',progress:'progress'};
  return database.transaction(async tx=>{
    const current=await assertTaskTenant(tx,organizationId,taskId,{forUpdate:true});
    if(expectedUpdatedAt&&new Date(current.updated_at).toISOString()!==new Date(expectedUpdatedAt).toISOString()) {
      throw new WorkConflictError('Task changed on another device; refresh before overwriting','OFFLINE_CONFLICT');
    }
    const entries=Object.entries(patch??{}).filter(([key])=>allowed[key]);
    if(!entries.length)return current;
    const values=[];
    const set=entries.map(([key,value])=>{values.push(value);return `${allowed[key]}=$${values.length}`});
    values.push(actorUserId??null,taskId,organizationId);
    const result=await tx.query(`UPDATE work_tasks SET ${set.join(',')},updated_by=$${values.length-2},updated_at=now() WHERE id=$${values.length-1} AND organization_id=$${values.length} RETURNING *`,values);
    const saved=result.rows[0];
    if(emitChange) await emitChange({transaction:tx,organizationId,moduleKey:'tasks-work',collectionKey:'tasks',recordId:taskId,operation:saved.archived_at?'delete':'upsert',payload:saved.archived_at?null:safeMobileTask(saved),changedBy:actorUserId??null});
    return saved;
  });
}

export async function createRecurringOccurrence(database,{organizationId,sourceTaskId,occurrenceKey,id,title,dueAt,actorUserId,emitChange=null}) {
  if(!occurrenceKey)throw new TypeError('occurrenceKey is required');
  return database.transaction(async tx=>{
    const source=await assertTaskTenant(tx,organizationId,sourceTaskId,{forUpdate:true});
    const generatedId=id??`task_${randomUUID()}`;
    const claim=await tx.query(`INSERT INTO work_recurrence_occurrences(organization_id,source_task_id,occurrence_key,due_at,created_by)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(organization_id,source_task_id,occurrence_key) DO NOTHING RETURNING occurrence_key`,[organizationId,sourceTaskId,String(occurrenceKey),dueAt??null,actorUserId??null]);
    if(!claim.rows[0]) {
      const prior=await tx.query(`SELECT generated_task_id FROM work_recurrence_occurrences WHERE organization_id=$1 AND source_task_id=$2 AND occurrence_key=$3`,[organizationId,sourceTaskId,String(occurrenceKey)]);
      return {created:false,id:prior.rows[0]?.generated_task_id??null};
    }
    const seq=await tx.query(`INSERT INTO work_sequences(organization_id,sequence_name,current_value) VALUES($1,'task',1)
      ON CONFLICT(organization_id,sequence_name) DO UPDATE SET current_value=work_sequences.current_value+1 RETURNING current_value`,[organizationId]);
    const created=await tx.query(`INSERT INTO work_tasks(id,organization_id,project_id,parent_task_id,task_number,title,description,status,priority,start_at,due_at,estimated_minutes,actual_minutes,progress,recurrence_json,custom_fields_json,created_by,updated_by)
      VALUES($1,$2,$3,NULL,$4,$5,$6,'todo',$7,NULL,$8,$9,0,0,$10,'{}',$11,$11) RETURNING *`,[generatedId,organizationId,source.project_id,seq.rows[0].current_value,title??source.title,source.description,source.priority,dueAt??null,source.estimated_minutes,source.recurrence_json,actorUserId??null]);
    await tx.query(`UPDATE work_recurrence_occurrences SET generated_task_id=$4 WHERE organization_id=$1 AND source_task_id=$2 AND occurrence_key=$3`,[organizationId,sourceTaskId,String(occurrenceKey),generatedId]);
    if(emitChange)await emitChange({transaction:tx,organizationId,moduleKey:'tasks-work',collectionKey:'tasks',recordId:generatedId,operation:'upsert',payload:safeMobileTask(created.rows[0]),changedBy:actorUserId??null});
    return {created:true,id:generatedId,task:created.rows[0]};
  });
}

export async function registerReminderSweep(scheduler,{organizationId,timezone='UTC',cron='* * * * *'}) {
  return scheduler.register({id:`tasks-work-reminders:${organizationId}`,name:'Tasks & Work reminder sweep',organizationId,kind:'tasks-work.reminders.scan',cron,timezone,payload:{organizationId}});
}

export async function recordReminder(database,{organizationId,taskId,userId,reminderType,reminderKey,id=null}) {
  const result=await database.query(`INSERT INTO work_task_reminders(id,organization_id,task_id,user_id,reminder_type,reminder_key,sent_at)
    VALUES($1,$2,$3,$4,$5,$6,now()) ON CONFLICT(reminder_key) DO NOTHING RETURNING *`,[id??`rem_${randomUUID()}`,organizationId,taskId,userId,reminderType,reminderKey]);
  return {created:Boolean(result.rows[0]),reminder:result.rows[0]??null};
}

export async function createNotification(database,{organizationId,userId,eventType,title,body,entityType=null,entityId=null,data={},id=null}) {
  const notificationId=id??`ntf_${randomUUID()}`;
  const result=await database.query(`INSERT INTO work_notifications(id,organization_id,user_id,event_type,title,body,entity_type,entity_id,data_json)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[notificationId,organizationId,userId,eventType,title,body,entityType,entityId,JSON.stringify(data??{})]);
  return result.rows[0];
}

export async function queueNotificationDelivery(database,{organizationId,notificationId,channel,recipient,provider,id=null}) {
  const deliveryId=id??`ndl_${randomUUID()}`;
  const result=await database.query(`INSERT INTO work_notification_deliveries(id,organization_id,notification_id,channel,recipient,provider,status)
    VALUES($1,$2,$3,$4,$5,$6,'queued') ON CONFLICT(notification_id,channel,recipient) DO NOTHING RETURNING *`,[deliveryId,organizationId,notificationId,channel,recipient,provider]);
  return {created:Boolean(result.rows[0]),delivery:result.rows[0]??null};
}

export async function postChatMessage(database,{organizationId,threadId,id=null,senderUserId=null,direction='internal',messageType='text',body=null,fileKey=null,fileName=null,mimeType=null,sizeBytes=null,externalMessageId=null,deliveryStatus=null}) {
  return database.transaction(async tx=>{
    const thread=await tx.query(`SELECT * FROM work_chat_threads WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[threadId,organizationId]);
    if(!thread.rows[0])throw new WorkConflictError('Chat thread not found in this organization','CHAT_SCOPE',404);
    if(thread.rows[0].status==='closed')throw new WorkConflictError('Chat thread is closed','CHAT_CLOSED');
    if(direction==='internal'&&senderUserId){const participant=await tx.query(`SELECT 1 FROM work_chat_participants WHERE thread_id=$1 AND user_id=$2`,[threadId,senderUserId]);if(!participant.rows[0])throw new WorkConflictError('Sender is not a thread participant','CHAT_PARTICIPANT');}
    if(externalMessageId){const prior=await tx.query(`SELECT * FROM work_chat_messages WHERE organization_id=$1 AND external_message_id=$2`,[organizationId,externalMessageId]);if(prior.rows[0])return prior.rows[0];}
    const result=await tx.query(`INSERT INTO work_chat_messages(id,organization_id,thread_id,sender_user_id,direction,message_type,body,file_key,file_name,mime_type,size_bytes,external_message_id,delivery_status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,[id??`msg_${randomUUID()}`,organizationId,threadId,senderUserId,direction,messageType,body,fileKey,fileName,mimeType,sizeBytes,externalMessageId,deliveryStatus]);
    await tx.query(`UPDATE work_chat_threads SET last_message_at=now(),updated_at=now() WHERE id=$1 AND organization_id=$2`,[threadId,organizationId]);
    await tx.query(`UPDATE work_chat_participants SET unread_count=unread_count+1 WHERE thread_id=$1 AND ($2::text IS NULL OR user_id<>$2)`,[threadId,senderUserId]);
    return result.rows[0];
  });
}

export function safeMobileTask(task){return {id:task.id,taskNumber:task.task_number,projectId:task.project_id,parentTaskId:task.parent_task_id,title:task.title,description:task.description,status:task.status,priority:task.priority,startAt:task.start_at,dueAt:task.due_at,completedAt:task.completed_at,estimatedMinutes:task.estimated_minutes,actualMinutes:task.actual_minutes,progress:task.progress,updatedBy:task.updated_by};}
