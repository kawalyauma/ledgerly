-- Complete the long-offline privacy migration.
-- 1) scrub unsafe historical Contacts and Communications payloads;
-- 2) republish safe current projections;
-- 3) republish retained tombstones so devices offline through the scrub still receive deletes.

-- Contacts: v2 projection is already safe, but v1 changes may still contain financial/custom data.
DELETE FROM mobile_sync_changes
WHERE module_key='contacts' AND collection_key='contacts';

INSERT INTO contacts_mobile_change_events(organization_id,collection_key,record_id,operation,payload_json)
SELECT c.organization_id,'contacts',c.id,
       CASE WHEN c.archived_at IS NULL THEN 'upsert' ELSE 'delete' END,
       CASE WHEN c.archived_at IS NULL THEN json_object(
         'id',c.id,'type',c.type,'code',c.code,'name',c.name,'email',c.email,'active',c.active
       ) ELSE NULL END
FROM contacts c;

-- Republish hard-delete tombstones which have no surviving domain row.
INSERT INTO mobile_sync_changes(organization_id,module_key,collection_key,record_id,version,operation,payload_json,changed_by,device_id,changed_at)
SELECT t.organization_id,t.module_key,t.collection_key,t.record_id,t.version,'delete',NULL,NULL,t.device_id,CURRENT_TIMESTAMP
FROM mobile_sync_tombstones t
WHERE t.module_key='contacts' AND t.collection_key='contacts'
  AND NOT EXISTS(SELECT 1 FROM contacts c WHERE c.organization_id=t.organization_id AND c.id=t.record_id);

-- Students/Tasks privacy scrubs republished active rows. Re-emit their retained tombstones too,
-- otherwise a device offline across the scrub could keep an already-deleted local record.
INSERT INTO mobile_sync_changes(organization_id,module_key,collection_key,record_id,version,operation,payload_json,changed_by,device_id,changed_at)
SELECT t.organization_id,t.module_key,t.collection_key,t.record_id,t.version,'delete',NULL,NULL,t.device_id,CURRENT_TIMESTAMP
FROM mobile_sync_tombstones t
WHERE (t.module_key='school-management' AND t.collection_key='students')
   OR (t.module_key='tasks-work' AND t.collection_key='tasks');

-- Communications recipient variables and raw provider errors/IDs are server-only.
DROP TRIGGER IF EXISTS comm_sync_recipient_i;
DROP TRIGGER IF EXISTS comm_sync_recipient_u;
DROP TRIGGER IF EXISTS comm_sync_delivery_i;
DROP TRIGGER IF EXISTS comm_sync_delivery_u;

CREATE TRIGGER comm_sync_recipient_i AFTER INSERT ON communication_recipients BEGIN
 INSERT INTO communication_mobile_change_events VALUES(NULL,NEW.organization_id,'recipients',NEW.id,'upsert',json_object(
   'id',NEW.id,'campaignId',NEW.campaign_id,'recipientType',NEW.recipient_type,'recipientId',NEW.recipient_id,
   'relatedEntityType',NEW.related_entity_type,'relatedEntityId',NEW.related_entity_id,'recipientName',NEW.recipient_name,
   'phone',NEW.phone,'status',NEW.status,'skipReason',NEW.skip_reason,'createdAt',NEW.created_at));
END;
CREATE TRIGGER comm_sync_recipient_u AFTER UPDATE ON communication_recipients BEGIN
 INSERT INTO communication_mobile_change_events VALUES(NULL,NEW.organization_id,'recipients',NEW.id,'upsert',json_object(
   'id',NEW.id,'campaignId',NEW.campaign_id,'recipientType',NEW.recipient_type,'recipientId',NEW.recipient_id,
   'relatedEntityType',NEW.related_entity_type,'relatedEntityId',NEW.related_entity_id,'recipientName',NEW.recipient_name,
   'phone',NEW.phone,'status',NEW.status,'skipReason',NEW.skip_reason,'createdAt',NEW.created_at));
END;
CREATE TRIGGER comm_sync_delivery_i AFTER INSERT ON communication_deliveries BEGIN
 INSERT INTO communication_mobile_change_events VALUES(NULL,NEW.organization_id,'deliveries',NEW.id,'upsert',json_object(
   'id',NEW.id,'campaignId',NEW.campaign_id,'recipientSnapshotId',NEW.recipient_snapshot_id,'channel',NEW.channel,
   'recipientPhone',NEW.recipient_phone,'provider',NEW.provider,'renderedSubject',NEW.rendered_subject,
   'renderedMessage',NEW.rendered_message,'status',NEW.status,'attempts',NEW.attempts,'queuedAt',NEW.queued_at,
   'sentAt',NEW.sent_at,'deliveredAt',NEW.delivered_at,'failedAt',NEW.failed_at));
END;
CREATE TRIGGER comm_sync_delivery_u AFTER UPDATE ON communication_deliveries BEGIN
 INSERT INTO communication_mobile_change_events VALUES(NULL,NEW.organization_id,'deliveries',NEW.id,'upsert',json_object(
   'id',NEW.id,'campaignId',NEW.campaign_id,'recipientSnapshotId',NEW.recipient_snapshot_id,'channel',NEW.channel,
   'recipientPhone',NEW.recipient_phone,'provider',NEW.provider,'renderedSubject',NEW.rendered_subject,
   'renderedMessage',NEW.rendered_message,'status',NEW.status,'attempts',NEW.attempts,'queuedAt',NEW.queued_at,
   'sentAt',NEW.sent_at,'deliveredAt',NEW.delivered_at,'failedAt',NEW.failed_at));
END;

DELETE FROM mobile_sync_changes
WHERE module_key='communications' AND collection_key IN ('recipients','deliveries');

-- Keep only the same 400-day offline history window used by snapshots. Older records are emitted as deletes
-- so long-lived local databases actively discard them rather than retaining stale sensitive v1 data.
INSERT INTO communication_mobile_change_events(organization_id,collection_key,record_id,operation,payload_json)
SELECT r.organization_id,'recipients',r.id,
       CASE WHEN r.created_at>=datetime('now','-400 days') THEN 'upsert' ELSE 'delete' END,
       CASE WHEN r.created_at>=datetime('now','-400 days') THEN json_object(
         'id',r.id,'campaignId',r.campaign_id,'recipientType',r.recipient_type,'recipientId',r.recipient_id,
         'relatedEntityType',r.related_entity_type,'relatedEntityId',r.related_entity_id,'recipientName',r.recipient_name,
         'phone',r.phone,'status',r.status,'skipReason',r.skip_reason,'createdAt',r.created_at
       ) ELSE NULL END
FROM communication_recipients r;

INSERT INTO communication_mobile_change_events(organization_id,collection_key,record_id,operation,payload_json)
SELECT d.organization_id,'deliveries',d.id,
       CASE WHEN d.created_at>=datetime('now','-400 days') THEN 'upsert' ELSE 'delete' END,
       CASE WHEN d.created_at>=datetime('now','-400 days') THEN json_object(
         'id',d.id,'campaignId',d.campaign_id,'recipientSnapshotId',d.recipient_snapshot_id,'channel',d.channel,
         'recipientPhone',d.recipient_phone,'provider',d.provider,'renderedSubject',d.rendered_subject,
         'renderedMessage',d.rendered_message,'status',d.status,'attempts',d.attempts,'queuedAt',d.queued_at,
         'sentAt',d.sent_at,'deliveredAt',d.delivered_at,'failedAt',d.failed_at
       ) ELSE NULL END
FROM communication_deliveries d;

-- Hard-deleted communication records are not present above; replay their retained tombstones.
INSERT INTO mobile_sync_changes(organization_id,module_key,collection_key,record_id,version,operation,payload_json,changed_by,device_id,changed_at)
SELECT t.organization_id,t.module_key,t.collection_key,t.record_id,t.version,'delete',NULL,NULL,t.device_id,CURRENT_TIMESTAMP
FROM mobile_sync_tombstones t
WHERE t.module_key='communications' AND t.collection_key IN ('recipients','deliveries')
  AND NOT EXISTS(
    SELECT 1 FROM communication_recipients r
    WHERE t.collection_key='recipients' AND r.organization_id=t.organization_id AND r.id=t.record_id
  )
  AND NOT EXISTS(
    SELECT 1 FROM communication_deliveries d
    WHERE t.collection_key='deliveries' AND d.organization_id=t.organization_id AND d.id=t.record_id
  );
