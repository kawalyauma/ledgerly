import { canAccessCommunications, requireCommunicationsAccess } from '../communications-auth.mjs';
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{7,149}$/;
function requiredText(value,name,max){if(typeof value!=='string'||value.trim()===''){const e=new Error(`${name} is required`);e.code='VALIDATION_ERROR';throw e;}const text=value.trim();if(text.length>max){const e=new Error(`${name} is too long`);e.code='VALIDATION_ERROR';throw e;}return text;}
function payloadOf(operation){const p=operation?.payload;if(!p||typeof p!=='object'||Array.isArray(p)){const e=new Error('campaign draft payload is required');e.code='VALIDATION_ERROR';throw e;}return p;}
export async function createCollection({services}){
 if(!services?.database)throw new TypeError('database service required');
 return Object.freeze({
  moduleKey:'communications',collectionKey:'campaign-drafts',schemaVersion:1,
  async canRead({organizationId,userId}){return canAccessCommunications(services.database,{organizationId,userId,level:'read'});},
  async apply({transaction,organizationId,userId,operation}){
   await requireCommunicationsAccess(transaction,{organizationId,userId,level:'send'});
   if(operation.kind==='delete'){const e=new Error('offline campaign drafts cannot be deleted');e.code='APPEND_ONLY_COLLECTION';e.status=409;throw e;}
   if(!ID.test(String(operation.recordId||''))){const e=new Error('campaign draft IDs must be stable UUID-style identifiers');e.code='INVALID_CAMPAIGN_ID';e.status=422;throw e;}
   const p=payloadOf(operation),typeKey=requiredText(p.typeKey,'typeKey',80);
   const channels=[...new Set(Array.isArray(p.channels)?p.channels:[])];
   if(channels.length<1||channels.some((item)=>item!=='sms'&&item!=='whatsapp')){const e=new Error('channels must contain sms and/or whatsapp');e.code='VALIDATION_ERROR';e.status=422;throw e;}
   if(!p.audience||typeof p.audience!=='object'||Array.isArray(p.audience)){const e=new Error('audience must be an object');e.code='VALIDATION_ERROR';e.status=422;throw e;}
   const existing=await transaction.query(`SELECT organization_id FROM communication_campaigns WHERE id=$1 LIMIT 1`,[operation.recordId]);
   if(existing.rows[0]){const e=new Error('campaign id already exists');e.code='CAMPAIGN_ID_EXISTS';e.status=409;throw e;}
   const typeResult=await transaction.query(`SELECT * FROM communication_message_types WHERE organization_id=$1 AND type_key=$2 AND active=true LIMIT 1`,[organizationId,typeKey]);
   const type=typeResult.rows[0];if(!type){const e=new Error('message type not found or inactive');e.code='MESSAGE_TYPE_NOT_FOUND';e.status=404;throw e;}
   const org=(await transaction.query(`SELECT name FROM organizations WHERE id=$1`,[organizationId])).rows[0];
   const defaults=JSON.parse(type.audience_defaults_json||'{}'),audience={...defaults,...p.audience,kind:String(p.audience.kind||type.audience_kind)};
   const name=p.name?requiredText(p.name,'name',160):type.name;
   const senderName=p.senderName?requiredText(p.senderName,'senderName',160):(org?.name||'Ledgerly');
   const subject=p.subject?requiredText(p.subject,'subject',200):type.subject_template;
   const message=p.message?requiredText(p.message,'message',2000):type.message_template;
   const createdAt=operation.clientTimestamp||new Date().toISOString();
   await transaction.query(`INSERT INTO communication_campaigns(id,organization_id,message_type_id,type_key,module_key,name,sender_name,subject_template,message_template,channels_json,audience_kind,audience_json,status,scheduled_at,created_by,updated_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'draft',NULL,$13,$13,$14,$14)`,[operation.recordId,organizationId,type.id,type.type_key,type.module_key,name,senderName,subject,message,JSON.stringify(channels),audience.kind,JSON.stringify(audience),userId,createdAt]);
   return{payload:{id:operation.recordId,typeKey:type.type_key,name,channels,audience,status:'draft',createdAt},result:{campaignId:operation.recordId,status:'draft',requiresOnlineSend:true}};
  }
 });
}
