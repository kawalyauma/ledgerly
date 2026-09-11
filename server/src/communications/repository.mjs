function iso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("invalid date");
  return date.toISOString();
}

export class PostgresCommunicationsRepository {
  constructor({ database }) {
    if (!database?.query) throw new TypeError("communications repository requires database");
    this.database = database;
  }

  async getCampaign(organizationId, campaignId) {
    const r = await this.database.query(`SELECT * FROM communication_campaigns WHERE organization_id=$1 AND id=$2`,[organizationId,campaignId]);
    return r.rows[0] ?? null;
  }
  async listDueCampaignIds(organizationId, now=new Date(), limit=100) {
    const r = await this.database.query(`SELECT id FROM communication_campaigns WHERE organization_id=$1 AND status='scheduled' AND scheduled_at <= $2::timestamptz ORDER BY scheduled_at,id LIMIT $3`,[organizationId,iso(now),Math.max(1,Math.min(Number(limit)||100,500))]);
    return r.rows.map((x)=>x.id);
  }
  async setCampaignState(organizationId,campaignId,status,{actorId=null,completedAt=null}={}) {
    const r=await this.database.query(`UPDATE communication_campaigns SET status=$3, updated_by=COALESCE($4,updated_by), started_at=CASE WHEN $3='sending' THEN COALESCE(started_at,now()) ELSE started_at END, completed_at=COALESCE($5::timestamptz,completed_at), updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,[organizationId,campaignId,status,actorId,completedAt]);
    return r.rows[0] ?? null;
  }
  async listSendableDeliveryIds(organizationId,campaignId,{afterId=null,limit=100}={}) {
    const values=[organizationId,campaignId]; let after="";
    if(afterId){values.push(afterId);after=` AND d.id > $${values.length}`;}
    values.push(Math.max(1,Math.min(Number(limit)||100,500)));
    const r=await this.database.query(`SELECT d.id FROM communication_deliveries d JOIN communication_campaigns c ON c.id=d.campaign_id AND c.organization_id=d.organization_id WHERE d.organization_id=$1 AND d.campaign_id=$2 AND c.status IN ('queued','sending') AND d.status IN ('queued','failed') AND d.provider_message_id IS NULL AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= now()) ${after} ORDER BY d.id LIMIT $${values.length}`,values);
    return r.rows.map((x)=>x.id);
  }
  async claimDelivery(organizationId,deliveryId) {
    const r=await this.database.query(`UPDATE communication_deliveries d SET status='sending', attempts=attempts+1, updated_at=now() FROM communication_campaigns c WHERE d.id=$2 AND d.organization_id=$1 AND c.id=d.campaign_id AND c.organization_id=d.organization_id AND c.status IN ('queued','sending') AND d.status IN ('queued','failed') AND d.provider_message_id IS NULL AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= now()) RETURNING d.*`,[organizationId,deliveryId]);
    return r.rows[0] ?? null;
  }
  async getDeliveryState(organizationId,deliveryId) {
    const r=await this.database.query(`SELECT id,status,provider_message_id,campaign_id,recipient_snapshot_id FROM communication_deliveries WHERE organization_id=$1 AND id=$2`,[organizationId,deliveryId]);
    return r.rows[0] ?? null;
  }
  async getPreference(organizationId, recipientType, recipientId) {
    if(!recipientType || !recipientId) return null;
    const r=await this.database.query(`SELECT * FROM communication_preferences WHERE organization_id=$1 AND recipient_type=$2 AND recipient_id=$3`,[organizationId,recipientType,recipientId]);
    return r.rows[0] ?? null;
  }
  async getRecipient(organizationId,recipientSnapshotId) {
    const r=await this.database.query(`SELECT * FROM communication_recipients WHERE organization_id=$1 AND id=$2`,[organizationId,recipientSnapshotId]);
    return r.rows[0] ?? null;
  }
  async markDeliverySent(organizationId,deliveryId,{provider,providerMessageId}) {
    const r=await this.database.query(`UPDATE communication_deliveries SET status='sent',provider=$3,provider_message_id=$4,last_error=NULL,sent_at=COALESCE(sent_at,now()),next_attempt_at=NULL,updated_at=now() WHERE organization_id=$1 AND id=$2 AND status='sending' RETURNING *`,[organizationId,deliveryId,provider,providerMessageId]);
    return r.rows[0] ?? null;
  }
  async markDeliveryFailed(organizationId,deliveryId,{error,nextAttemptAt=null}) {
    const r=await this.database.query(`UPDATE communication_deliveries SET status='failed',last_error=$3,failed_at=now(),next_attempt_at=$4::timestamptz,updated_at=now() WHERE organization_id=$1 AND id=$2 AND status='sending' RETURNING *`,[organizationId,deliveryId,String(error).slice(0,4000),nextAttemptAt ? iso(nextAttemptAt) : null]);
    return r.rows[0] ?? null;
  }
  async cancelDelivery(organizationId,deliveryId,reason) {
    const r=await this.database.query(`UPDATE communication_deliveries SET status='cancelled',last_error=$3,updated_at=now() WHERE organization_id=$1 AND id=$2 AND status IN ('queued','failed','sending') RETURNING *`,[organizationId,deliveryId,reason]);
    return r.rows[0] ?? null;
  }
  async refreshCampaignProgress(organizationId,campaignId) {
    const r=await this.database.query(`WITH stats AS (SELECT count(*)::int delivery_count,count(*) FILTER(WHERE status IN ('sent','delivered'))::int sent_count,count(*) FILTER(WHERE status='failed')::int failed_count,count(*) FILTER(WHERE status='cancelled')::int cancelled_count,count(*) FILTER(WHERE status IN ('queued','sending'))::int pending_count FROM communication_deliveries WHERE organization_id=$1 AND campaign_id=$2) UPDATE communication_campaigns c SET delivery_count=stats.delivery_count,sent_count=stats.sent_count,failed_count=stats.failed_count,status=CASE WHEN stats.pending_count>0 THEN c.status WHEN stats.failed_count>0 THEN 'partial' WHEN c.status='cancelled' THEN 'cancelled' ELSE 'completed' END,completed_at=CASE WHEN stats.pending_count=0 THEN COALESCE(c.completed_at,now()) ELSE c.completed_at END,updated_at=now() FROM stats WHERE c.organization_id=$1 AND c.id=$2 RETURNING c.*,stats.pending_count,stats.cancelled_count`,[organizationId,campaignId]);
    return r.rows[0] ?? null;
  }
}
