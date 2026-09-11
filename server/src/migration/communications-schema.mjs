export async function ensureCommunicationsSchema(database) {
  await database.query(`
    CREATE TABLE IF NOT EXISTS communication_message_types (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      type_key text NOT NULL, name text NOT NULL, module_key text NOT NULL DEFAULT 'platform', category text NOT NULL DEFAULT 'general',
      audience_kind text NOT NULL, subject_template text NOT NULL, message_template text NOT NULL, audience_defaults_json text NOT NULL DEFAULT '{}',
      system_type boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true, created_by text REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,type_key)
    );
    CREATE INDEX IF NOT EXISTS communication_types_org_idx ON communication_message_types(organization_id,module_key,active,name);
    CREATE TABLE IF NOT EXISTS communication_campaigns (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      message_type_id text REFERENCES communication_message_types(id) ON DELETE SET NULL, type_key text NOT NULL,
      module_key text NOT NULL DEFAULT 'platform', name text NOT NULL, sender_name text NOT NULL,
      subject_template text NOT NULL, message_template text NOT NULL, channels_json text NOT NULL DEFAULT '["sms"]',
      audience_kind text NOT NULL, audience_json text NOT NULL DEFAULT '{}',
      status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','scheduled','queued','sending','paused','completed','partial','failed','cancelled')),
      scheduled_at timestamptz, started_at timestamptz, completed_at timestamptz,
      recipient_count integer NOT NULL DEFAULT 0, skipped_count integer NOT NULL DEFAULT 0, delivery_count integer NOT NULL DEFAULT 0,
      sent_count integer NOT NULL DEFAULT 0, failed_count integer NOT NULL DEFAULT 0,
      created_by text REFERENCES users(id) ON DELETE SET NULL, updated_by text REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS communication_campaigns_org_idx ON communication_campaigns(organization_id,status,scheduled_at,created_at);
    CREATE TABLE IF NOT EXISTS communication_recipients (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      campaign_id text NOT NULL REFERENCES communication_campaigns(id) ON DELETE CASCADE,
      recipient_type text NOT NULL, recipient_id text, related_entity_type text, related_entity_id text,
      recipient_name text NOT NULL, phone text, email text, data_json text NOT NULL DEFAULT '{}',
      status text NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','queued','sent','partial','failed','skipped')),
      skip_reason text, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS communication_recipients_campaign_idx ON communication_recipients(organization_id,campaign_id,status,recipient_name);
    CREATE TABLE IF NOT EXISTS communication_deliveries (
      id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      campaign_id text NOT NULL REFERENCES communication_campaigns(id) ON DELETE CASCADE,
      recipient_snapshot_id text NOT NULL REFERENCES communication_recipients(id) ON DELETE CASCADE,
      channel text NOT NULL CHECK(channel IN ('sms','whatsapp','email')), recipient_phone text, recipient_email text,
      provider text NOT NULL, template_name text, template_language text, template_variables_json text NOT NULL DEFAULT '{}',
      rendered_subject text NOT NULL, rendered_message text NOT NULL,
      status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','sent','delivered','failed','cancelled')),
      attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0), provider_message_id text, last_error text,
      idempotency_key text, next_attempt_at timestamptz, queued_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz,
      delivered_at timestamptz, failed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(campaign_id,recipient_snapshot_id,channel), UNIQUE(organization_id,idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS communication_deliveries_status_idx ON communication_deliveries(status,next_attempt_at,created_at);
    CREATE INDEX IF NOT EXISTS communication_deliveries_campaign_idx ON communication_deliveries(organization_id,campaign_id,channel,status);
    CREATE INDEX IF NOT EXISTS communication_deliveries_provider_id_idx ON communication_deliveries(provider,provider_message_id) WHERE provider_message_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS communication_preferences (
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      recipient_type text NOT NULL, recipient_id text NOT NULL,
      sms_enabled boolean NOT NULL DEFAULT true, whatsapp_enabled boolean NOT NULL DEFAULT true, email_enabled boolean NOT NULL DEFAULT true,
      do_not_contact boolean NOT NULL DEFAULT false, quiet_hours_json text NOT NULL DEFAULT '{}',
      updated_by text REFERENCES users(id) ON DELETE SET NULL, updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(organization_id,recipient_type,recipient_id)
    );
    CREATE TABLE IF NOT EXISTS communication_provider_events (
      id text PRIMARY KEY, organization_id text REFERENCES organizations(id) ON DELETE CASCADE,
      provider text NOT NULL, event_type text, external_id text, payload_hash text,
      received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz, UNIQUE(provider,external_id,event_type)
    );
    CREATE INDEX IF NOT EXISTS communication_provider_events_org_time_idx ON communication_provider_events(organization_id,received_at DESC);

    CREATE OR REPLACE FUNCTION ledgerly_emit_communication_sync(
      p_organization_id text, p_collection_key text, p_record_id text,
      p_operation text, p_payload jsonb, p_changed_by text DEFAULT NULL
    ) RETURNS bigint AS $$
    DECLARE v_version bigint;
    BEGIN
      IF p_operation NOT IN ('upsert','delete') THEN RAISE EXCEPTION 'invalid communications sync operation: %', p_operation; END IF;
      INSERT INTO mobile_sync_record_versions(organization_id,module_key,collection_key,record_id,version,deleted,server_updated_at,last_device_id)
      VALUES(p_organization_id,'communications',p_collection_key,p_record_id,1,p_operation='delete',now(),NULL)
      ON CONFLICT(organization_id,module_key,collection_key,record_id)
      DO UPDATE SET version=mobile_sync_record_versions.version+1,deleted=EXCLUDED.deleted,server_updated_at=now(),last_device_id=NULL
      RETURNING version INTO v_version;
      IF p_operation='delete' THEN
        INSERT INTO mobile_sync_tombstones(organization_id,module_key,collection_key,record_id,version,deleted_at,device_id)
        VALUES(p_organization_id,'communications',p_collection_key,p_record_id,v_version,now(),NULL)
        ON CONFLICT(organization_id,module_key,collection_key,record_id)
        DO UPDATE SET version=EXCLUDED.version,deleted_at=now(),device_id=NULL;
      ELSE
        DELETE FROM mobile_sync_tombstones WHERE organization_id=p_organization_id AND module_key='communications' AND collection_key=p_collection_key AND record_id=p_record_id;
      END IF;
      INSERT INTO mobile_sync_changes(organization_id,module_key,collection_key,record_id,version,operation,payload_json,changed_by,device_id,changed_at)
      VALUES(p_organization_id,'communications',p_collection_key,p_record_id,v_version,p_operation,CASE WHEN p_operation='delete' THEN NULL ELSE p_payload::text END,p_changed_by,NULL,now());
      RETURN v_version;
    END;
    $$ LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION ledgerly_communication_sync_trigger() RETURNS trigger AS $$
    DECLARE v_org text; v_id text; v_collection text; v_operation text := 'upsert'; v_payload jsonb; v_changed_by text;
    BEGIN
      IF TG_OP='DELETE' THEN
        v_org:=OLD.organization_id; v_id:=OLD.id; v_operation:='delete'; v_payload:=NULL;
      ELSE
        v_org:=NEW.organization_id; v_id:=NEW.id;
      END IF;
      IF TG_TABLE_NAME='communication_message_types' THEN
        v_collection:='message-types';
        IF TG_OP<>'DELETE' THEN
          IF NEW.active=false THEN v_operation:='delete'; v_payload:=NULL;
          ELSE v_payload:=jsonb_build_object('id',NEW.id,'typeKey',NEW.type_key,'name',NEW.name,'moduleKey',NEW.module_key,'category',NEW.category,'audienceKind',NEW.audience_kind,'subjectTemplate',NEW.subject_template,'messageTemplate',NEW.message_template,'audienceDefaults',NEW.audience_defaults_json::jsonb,'systemType',NEW.system_type,'active',NEW.active); END IF;
          v_changed_by:=NEW.created_by;
        END IF;
      ELSIF TG_TABLE_NAME='communication_campaigns' THEN
        v_collection:='campaigns';
        IF TG_OP<>'DELETE' THEN
          v_payload:=jsonb_build_object('id',NEW.id,'messageTypeId',NEW.message_type_id,'typeKey',NEW.type_key,'moduleKey',NEW.module_key,'name',NEW.name,'senderName',NEW.sender_name,'subjectTemplate',NEW.subject_template,'messageTemplate',NEW.message_template,'channels',NEW.channels_json::jsonb,'audienceKind',NEW.audience_kind,'audience',NEW.audience_json::jsonb,'status',NEW.status,'scheduledAt',NEW.scheduled_at,'startedAt',NEW.started_at,'completedAt',NEW.completed_at,'recipientCount',NEW.recipient_count,'skippedCount',NEW.skipped_count,'deliveryCount',NEW.delivery_count,'sentCount',NEW.sent_count,'failedCount',NEW.failed_count,'createdBy',NEW.created_by,'createdAt',NEW.created_at,'updatedAt',NEW.updated_at);
          v_changed_by:=COALESCE(NEW.updated_by,NEW.created_by);
        END IF;
      ELSIF TG_TABLE_NAME='communication_recipients' THEN
        v_collection:='recipients';
        IF TG_OP<>'DELETE' THEN v_payload:=jsonb_build_object('id',NEW.id,'campaignId',NEW.campaign_id,'recipientType',NEW.recipient_type,'recipientId',NEW.recipient_id,'relatedEntityType',NEW.related_entity_type,'relatedEntityId',NEW.related_entity_id,'recipientName',NEW.recipient_name,'phone',NEW.phone,'status',NEW.status,'skipReason',NEW.skip_reason,'createdAt',NEW.created_at); END IF;
      ELSIF TG_TABLE_NAME='communication_deliveries' THEN
        v_collection:='deliveries';
        IF TG_OP<>'DELETE' THEN v_payload:=jsonb_build_object('id',NEW.id,'campaignId',NEW.campaign_id,'recipientSnapshotId',NEW.recipient_snapshot_id,'channel',NEW.channel,'recipientPhone',NEW.recipient_phone,'provider',NEW.provider,'renderedSubject',NEW.rendered_subject,'renderedMessage',NEW.rendered_message,'status',NEW.status,'attempts',NEW.attempts,'queuedAt',NEW.queued_at,'sentAt',NEW.sent_at,'deliveredAt',NEW.delivered_at,'failedAt',NEW.failed_at,'updatedAt',NEW.updated_at); END IF;
      ELSE
        RAISE EXCEPTION 'unsupported communications sync table: %',TG_TABLE_NAME;
      END IF;
      PERFORM ledgerly_emit_communication_sync(v_org,v_collection,v_id,v_operation,v_payload,v_changed_by);
      RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS communication_sync_message_types_insert_delete ON communication_message_types;
    DROP TRIGGER IF EXISTS communication_sync_message_types_update ON communication_message_types;
    CREATE TRIGGER communication_sync_message_types_insert_delete AFTER INSERT OR DELETE ON communication_message_types FOR EACH ROW EXECUTE FUNCTION ledgerly_communication_sync_trigger();
    CREATE TRIGGER communication_sync_message_types_update AFTER UPDATE ON communication_message_types FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW) EXECUTE FUNCTION ledgerly_communication_sync_trigger();
    DROP TRIGGER IF EXISTS communication_sync_campaigns_insert_delete ON communication_campaigns;
    DROP TRIGGER IF EXISTS communication_sync_campaigns_update ON communication_campaigns;
    CREATE TRIGGER communication_sync_campaigns_insert_delete AFTER INSERT OR DELETE ON communication_campaigns FOR EACH ROW EXECUTE FUNCTION ledgerly_communication_sync_trigger();
    CREATE TRIGGER communication_sync_campaigns_update AFTER UPDATE ON communication_campaigns FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW) EXECUTE FUNCTION ledgerly_communication_sync_trigger();
    DROP TRIGGER IF EXISTS communication_sync_recipients_insert_delete ON communication_recipients;
    DROP TRIGGER IF EXISTS communication_sync_recipients_update ON communication_recipients;
    CREATE TRIGGER communication_sync_recipients_insert_delete AFTER INSERT OR DELETE ON communication_recipients FOR EACH ROW EXECUTE FUNCTION ledgerly_communication_sync_trigger();
    CREATE TRIGGER communication_sync_recipients_update AFTER UPDATE ON communication_recipients FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW) EXECUTE FUNCTION ledgerly_communication_sync_trigger();
    DROP TRIGGER IF EXISTS communication_sync_deliveries_insert_delete ON communication_deliveries;
    DROP TRIGGER IF EXISTS communication_sync_deliveries_update ON communication_deliveries;
    CREATE TRIGGER communication_sync_deliveries_insert_delete AFTER INSERT OR DELETE ON communication_deliveries FOR EACH ROW EXECUTE FUNCTION ledgerly_communication_sync_trigger();
    CREATE TRIGGER communication_sync_deliveries_update AFTER UPDATE ON communication_deliveries FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW) EXECUTE FUNCTION ledgerly_communication_sync_trigger();
  `);
}

export async function finalizeCommunicationsSchema(database) {
  const work = async (tx) => tx.query(`
    UPDATE mobile_sync_changes c SET payload_json=jsonb_strip_nulls(jsonb_build_object(
      'id',parsed.p->'id','campaignId',COALESCE(parsed.p->'campaignId',parsed.p->'campaign_id'),'recipientType',COALESCE(parsed.p->'recipientType',parsed.p->'recipient_type'),
      'recipientId',COALESCE(parsed.p->'recipientId',parsed.p->'recipient_id'),'relatedEntityType',COALESCE(parsed.p->'relatedEntityType',parsed.p->'related_entity_type'),
      'relatedEntityId',COALESCE(parsed.p->'relatedEntityId',parsed.p->'related_entity_id'),'recipientName',COALESCE(parsed.p->'recipientName',parsed.p->'recipient_name'),
      'phone',parsed.p->'phone','status',parsed.p->'status','skipReason',COALESCE(parsed.p->'skipReason',parsed.p->'skip_reason'),'createdAt',COALESCE(parsed.p->'createdAt',parsed.p->'created_at')
    ))::text
    FROM LATERAL (SELECT c.payload_json::jsonb AS p) parsed
    WHERE c.module_key='communications' AND c.collection_key='recipients' AND c.operation='upsert' AND c.payload_json IS NOT NULL;

    UPDATE mobile_sync_changes c SET payload_json=jsonb_strip_nulls(jsonb_build_object(
      'id',parsed.p->'id','campaignId',COALESCE(parsed.p->'campaignId',parsed.p->'campaign_id'),'recipientSnapshotId',COALESCE(parsed.p->'recipientSnapshotId',parsed.p->'recipient_snapshot_id'),
      'channel',parsed.p->'channel','recipientPhone',COALESCE(parsed.p->'recipientPhone',parsed.p->'recipient_phone'),'provider',parsed.p->'provider',
      'renderedSubject',COALESCE(parsed.p->'renderedSubject',parsed.p->'rendered_subject'),'renderedMessage',COALESCE(parsed.p->'renderedMessage',parsed.p->'rendered_message'),
      'status',parsed.p->'status','attempts',parsed.p->'attempts','queuedAt',COALESCE(parsed.p->'queuedAt',parsed.p->'queued_at'),'sentAt',COALESCE(parsed.p->'sentAt',parsed.p->'sent_at'),
      'deliveredAt',COALESCE(parsed.p->'deliveredAt',parsed.p->'delivered_at'),'failedAt',COALESCE(parsed.p->'failedAt',parsed.p->'failed_at'),'updatedAt',COALESCE(parsed.p->'updatedAt',parsed.p->'updated_at')
    ))::text
    FROM LATERAL (SELECT c.payload_json::jsonb AS p) parsed
    WHERE c.module_key='communications' AND c.collection_key='deliveries' AND c.operation='upsert' AND c.payload_json IS NOT NULL;

    DO $$ DECLARE r record; BEGIN
      FOR r IN SELECT x.organization_id,x.id FROM communication_recipients x LEFT JOIN mobile_sync_record_versions v ON v.organization_id=x.organization_id AND v.module_key='communications' AND v.collection_key='recipients' AND v.record_id=x.id WHERE x.created_at<now()-interval '400 days' AND COALESCE(v.deleted,false)=false
      LOOP PERFORM ledgerly_emit_communication_sync(r.organization_id,'recipients',r.id,'delete',NULL,NULL); END LOOP;
      FOR r IN SELECT x.organization_id,x.id FROM communication_deliveries x LEFT JOIN mobile_sync_record_versions v ON v.organization_id=x.organization_id AND v.module_key='communications' AND v.collection_key='deliveries' AND v.record_id=x.id WHERE x.created_at<now()-interval '400 days' AND COALESCE(v.deleted,false)=false
      LOOP PERFORM ledgerly_emit_communication_sync(r.organization_id,'deliveries',r.id,'delete',NULL,NULL); END LOOP;
    END $$;

    INSERT INTO mobile_sync_changes(organization_id,module_key,collection_key,record_id,version,operation,payload_json,changed_by,device_id,changed_at)
    SELECT t.organization_id,t.module_key,t.collection_key,t.record_id,t.version,'delete',NULL,NULL,t.device_id,now()
    FROM mobile_sync_tombstones t
    WHERE t.module_key='communications' AND t.collection_key IN ('recipients','deliveries')
      AND NOT EXISTS(SELECT 1 FROM communication_recipients r WHERE t.collection_key='recipients' AND r.organization_id=t.organization_id AND r.id=t.record_id)
      AND NOT EXISTS(SELECT 1 FROM communication_deliveries d WHERE t.collection_key='deliveries' AND d.organization_id=t.organization_id AND d.id=t.record_id)
      AND NOT EXISTS(SELECT 1 FROM mobile_sync_changes c WHERE c.organization_id=t.organization_id AND c.module_key=t.module_key AND c.collection_key=t.collection_key AND c.record_id=t.record_id AND c.operation='delete' AND c.version>=t.version);
  `);
  return typeof database.transaction==='function' ? database.transaction(work) : work(database);
}
