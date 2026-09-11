import { createJobEnvelope } from "../contracts.mjs";

const CHANNEL_PREF={sms:"sms_enabled",whatsapp:"whatsapp_enabled",email:"email_enabled"};
const terminal=new Set(["sent","delivered","cancelled"]);
function actor(value={}) { return {actorType:value.actorType ?? value.actor_type ?? "system",actorId:value.actorId ?? value.actor_id ?? "communications"}; }
function chunks(items,size){const out=[];for(let i=0;i<items.length;i+=size)out.push(items.slice(i,i+size));return out;}
function retryAt(attempt,now=new Date()){const seconds=Math.min(3600,Math.max(5,2**Math.max(0,attempt-1)*5));return new Date(now.getTime()+seconds*1000);}

export class CommunicationsService {
  constructor({repository,queue,notifications,audit,batchSize=100}) {
    if(!repository||!queue||!notifications||!audit) throw new TypeError("communications service requires repository, queue, notifications and audit");
    this.repository=repository; this.queue=queue; this.notifications=notifications; this.audit=audit; this.batchSize=Math.max(1,Math.min(Number(batchSize)||100,500));
  }
  async queueCampaign({organizationId,campaignId,actor:who={}}) {
    const campaign=await this.repository.getCampaign(organizationId,campaignId);
    if(!campaign) throw new Error("campaign not found");
    if(["cancelled","completed"].includes(campaign.status)) return {campaignId,queued:0,status:campaign.status};
    await this.repository.setCampaignState(organizationId,campaignId,"queued",{actorId:actor(who).actorId});
    let afterId=null, queued=0, batch=0;
    while(true){
      const ids=await this.repository.listSendableDeliveryIds(organizationId,campaignId,{afterId,limit:this.batchSize});
      if(!ids.length) break;
      for(const group of chunks(ids,this.batchSize)){
        batch+=1; const first=group[0],last=group[group.length-1];
        const job=createJobEnvelope({kind:"communications.delivery-batch",organizationId,idempotencyKey:`communications:${campaignId}:${first}:${last}`,payload:{campaignId,deliveryIds:group,actor:actor(who)}});
        const result=await this.queue.enqueue(job); if(result.queued!==false) queued+=group.length;
      }
      afterId=ids.at(-1); if(ids.length<this.batchSize) break;
    }
    await this.audit.write({organizationId,...actor(who),action:"communications.campaign.queued",entityType:"communication_campaign",entityId:campaignId,metadata:{deliveries:queued,batches:batch}});
    return {campaignId,queued,batches:batch};
  }
  async queueDueCampaigns({organizationId,now=new Date(),limit=100,actor:who={actorType:"system",actorId:"scheduler"}}) {
    const ids=await this.repository.listDueCampaignIds(organizationId,now,limit); const results=[];
    for(const campaignId of ids) results.push(await this.queueCampaign({organizationId,campaignId,actor:who}));
    return results;
  }
  async pauseCampaign({organizationId,campaignId,actor:who={}}){
    const row=await this.repository.setCampaignState(organizationId,campaignId,"paused",{actorId:actor(who).actorId}); if(!row) throw new Error("campaign not found");
    await this.audit.write({organizationId,...actor(who),action:"communications.campaign.paused",entityType:"communication_campaign",entityId:campaignId}); return row;
  }
  async resumeCampaign(args){ await this.repository.setCampaignState(args.organizationId,args.campaignId,"queued",{actorId:actor(args.actor).actorId}); return this.queueCampaign(args); }
  async cancelCampaign({organizationId,campaignId,actor:who={}}){
    const row=await this.repository.setCampaignState(organizationId,campaignId,"cancelled",{actorId:actor(who).actorId,completedAt:new Date().toISOString()}); if(!row) throw new Error("campaign not found");
    await this.audit.write({organizationId,...actor(who),action:"communications.campaign.cancelled",entityType:"communication_campaign",entityId:campaignId}); return row;
  }
  async processDelivery({organizationId,deliveryId,actor:who={actorType:"system",actorId:"communications-worker"}}){
    const claimed=await this.repository.claimDelivery(organizationId,deliveryId);
    if(!claimed){const state=await this.repository.getDeliveryState(organizationId,deliveryId);if(!state)return {deliveryId,skipped:true,reason:"not_found"};if(terminal.has(state.status)||state.provider_message_id)return {deliveryId,skipped:true,reason:"already_final"};return {deliveryId,skipped:true,reason:"not_sendable"};}
    const recipient=await this.repository.getRecipient(organizationId,claimed.recipient_snapshot_id);
    if(!recipient){await this.repository.cancelDelivery(organizationId,deliveryId,"recipient_snapshot_missing");return {deliveryId,skipped:true,reason:"recipient_snapshot_missing"};}
    const pref=await this.repository.getPreference(organizationId,recipient.recipient_type,recipient.recipient_id); const prefKey=CHANNEL_PREF[claimed.channel];
    if(pref?.do_not_contact || (prefKey && pref?.[prefKey] === false)){
      await this.repository.cancelDelivery(organizationId,deliveryId,"recipient_opt_out");
      await this.audit.write({organizationId,...actor(who),action:"communications.delivery.opted_out",entityType:"communication_delivery",entityId:deliveryId,metadata:{campaignId:claimed.campaign_id,channel:claimed.channel,recipientReference:recipient.recipient_id}});
      await this.repository.refreshCampaignProgress(organizationId,claimed.campaign_id); return {deliveryId,skipped:true,reason:"recipient_opt_out"};
    }
    const recipientAddress=claimed.channel==="email" ? (claimed.recipient_email||recipient.email) : (claimed.recipient_phone||recipient.phone);
    try{
      const result=await this.notifications.send({organizationId,channel:claimed.channel,recipient:recipientAddress,recipientName:recipient.recipient_name,deliveryId:claimed.id,subject:claimed.rendered_subject,body:claimed.rendered_message,templateName:claimed.template_name,templateLanguage:claimed.template_language,variables:JSON.parse(claimed.template_variables_json||"{}")});
      const sent=await this.repository.markDeliverySent(organizationId,deliveryId,{provider:result.provider,providerMessageId:result.providerMessageId});
      await this.audit.write({organizationId,...actor(who),action:"communications.delivery.sent",entityType:"communication_delivery",entityId:deliveryId,metadata:{campaignId:claimed.campaign_id,channel:claimed.channel,recipientReference:recipient.recipient_id,template:claimed.template_name,provider:result.provider,providerDeliveryId:result.providerMessageId,state:"sent"}});
      await this.repository.refreshCampaignProgress(organizationId,claimed.campaign_id); return {deliveryId,sent:true,provider:result.provider,providerMessageId:result.providerMessageId,row:sent};
    }catch(error){
      const message=error instanceof Error?error.message:String(error); const next=retryAt(claimed.attempts);
      await this.repository.markDeliveryFailed(organizationId,deliveryId,{error:message,nextAttemptAt:next});
      await this.audit.write({organizationId,...actor(who),action:"communications.delivery.failed",entityType:"communication_delivery",entityId:deliveryId,reason:message,metadata:{campaignId:claimed.campaign_id,channel:claimed.channel,recipientReference:recipient.recipient_id,template:claimed.template_name,provider:claimed.provider,state:"failed",attempt:claimed.attempts}});
      await this.repository.refreshCampaignProgress(organizationId,claimed.campaign_id); throw error;
    }
  }
}
