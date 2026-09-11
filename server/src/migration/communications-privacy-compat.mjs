const COMPATIBILITY_KEY = 'communications-mobile-privacy-v2';

export async function finalizeCommunicationsPrivacy(database) {
  const work = async (tx) => tx.query(`
    CREATE TABLE IF NOT EXISTS ledgerly_meta.compatibility_migrations (
      compatibility_key text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );

    DO $$
    DECLARE
      v_needs_rebuild boolean := false;
      v_cutoff timestamptz := now() - interval '400 days';
    BEGIN
      IF EXISTS (
        SELECT 1 FROM ledgerly_meta.compatibility_migrations
        WHERE compatibility_key='${COMPATIBILITY_KEY}'
      ) THEN
        RETURN;
      END IF;

      SELECT
        EXISTS (
          SELECT 1
          FROM mobile_sync_changes c
          CROSS JOIN LATERAL jsonb_object_keys(c.payload_json::jsonb) AS k(key)
          WHERE c.module_key='communications'
            AND c.collection_key='recipients'
            AND c.operation='upsert'
            AND c.payload_json IS NOT NULL
            AND k.key <> ALL (ARRAY[
              'id','campaignId','recipientType','recipientId','relatedEntityType','relatedEntityId',
              'recipientName','phone','status','skipReason','createdAt'
            ]::text[])
        )
        OR EXISTS (
          SELECT 1
          FROM mobile_sync_changes c
          CROSS JOIN LATERAL jsonb_object_keys(c.payload_json::jsonb) AS k(key)
          WHERE c.module_key='communications'
            AND c.collection_key='deliveries'
            AND c.operation='upsert'
            AND c.payload_json IS NOT NULL
            AND k.key <> ALL (ARRAY[
              'id','campaignId','recipientSnapshotId','channel','recipientPhone','provider',
              'renderedSubject','renderedMessage','status','attempts','queuedAt','sentAt','deliveredAt','failedAt'
            ]::text[])
        )
        OR EXISTS (
          SELECT 1 FROM mobile_sync_changes c
          WHERE c.module_key='communications'
            AND c.collection_key IN ('recipients','deliveries')
            AND c.operation='upsert'
            AND c.payload_json IS NULL
        )
        OR EXISTS (
          SELECT 1
          FROM communication_recipients r
          LEFT JOIN mobile_sync_record_versions v
            ON v.organization_id=r.organization_id AND v.module_key='communications'
           AND v.collection_key='recipients' AND v.record_id=r.id
          WHERE v.record_id IS NULL OR v.deleted IS DISTINCT FROM (r.created_at < v_cutoff)
        )
        OR EXISTS (
          SELECT 1
          FROM communication_deliveries d
          LEFT JOIN mobile_sync_record_versions v
            ON v.organization_id=d.organization_id AND v.module_key='communications'
           AND v.collection_key='deliveries' AND v.record_id=d.id
          WHERE v.record_id IS NULL OR v.deleted IS DISTINCT FROM (d.created_at < v_cutoff)
        )
        OR EXISTS (
          SELECT 1
          FROM communication_recipients r
          JOIN mobile_sync_record_versions v
            ON v.organization_id=r.organization_id AND v.module_key='communications'
           AND v.collection_key='recipients' AND v.record_id=r.id
          WHERE NOT EXISTS (
            SELECT 1 FROM mobile_sync_changes c
            WHERE c.organization_id=r.organization_id AND c.module_key='communications'
              AND c.collection_key='recipients' AND c.record_id=r.id AND c.version=v.version
              AND c.operation=CASE WHEN r.created_at < v_cutoff THEN 'delete' ELSE 'upsert' END
              AND (r.created_at < v_cutoff OR c.payload_json IS NOT NULL)
          )
        )
        OR EXISTS (
          SELECT 1
          FROM communication_deliveries d
          JOIN mobile_sync_record_versions v
            ON v.organization_id=d.organization_id AND v.module_key='communications'
           AND v.collection_key='deliveries' AND v.record_id=d.id
          WHERE NOT EXISTS (
            SELECT 1 FROM mobile_sync_changes c
            WHERE c.organization_id=d.organization_id AND c.module_key='communications'
              AND c.collection_key='deliveries' AND c.record_id=d.id AND c.version=v.version
              AND c.operation=CASE WHEN d.created_at < v_cutoff THEN 'delete' ELSE 'upsert' END
              AND (d.created_at < v_cutoff OR c.payload_json IS NOT NULL)
          )
        )
        OR EXISTS (
          SELECT 1
          FROM communication_recipients r
          JOIN mobile_sync_record_versions v
            ON v.organization_id=r.organization_id AND v.module_key='communications'
           AND v.collection_key='recipients' AND v.record_id=r.id
          LEFT JOIN mobile_sync_tombstones t
            ON t.organization_id=r.organization_id AND t.module_key='communications'
           AND t.collection_key='recipients' AND t.record_id=r.id
          WHERE (r.created_at < v_cutoff AND (t.record_id IS NULL OR t.version<>v.version))
             OR (r.created_at >= v_cutoff AND t.record_id IS NOT NULL)
        )
        OR EXISTS (
          SELECT 1
          FROM communication_deliveries d
          JOIN mobile_sync_record_versions v
            ON v.organization_id=d.organization_id AND v.module_key='communications'
           AND v.collection_key='deliveries' AND v.record_id=d.id
          LEFT JOIN mobile_sync_tombstones t
            ON t.organization_id=d.organization_id AND t.module_key='communications'
           AND t.collection_key='deliveries' AND t.record_id=d.id
          WHERE (d.created_at < v_cutoff AND (t.record_id IS NULL OR t.version<>v.version))
             OR (d.created_at >= v_cutoff AND t.record_id IS NOT NULL)
        )
        OR EXISTS (
          SELECT 1 FROM mobile_sync_tombstones t
          WHERE t.module_key='communications' AND t.collection_key IN ('recipients','deliveries')
            AND NOT EXISTS (
              SELECT 1 FROM communication_recipients r
              WHERE t.collection_key='recipients' AND r.organization_id=t.organization_id AND r.id=t.record_id
            )
            AND NOT EXISTS (
              SELECT 1 FROM communication_deliveries d
              WHERE t.collection_key='deliveries' AND d.organization_id=t.organization_id AND d.id=t.record_id
            )
            AND NOT EXISTS (
              SELECT 1 FROM mobile_sync_changes c
              WHERE c.organization_id=t.organization_id AND c.module_key=t.module_key
                AND c.collection_key=t.collection_key AND c.record_id=t.record_id
                AND c.operation='delete' AND c.version>=t.version
            )
        )
      INTO v_needs_rebuild;

      IF v_needs_rebuild THEN
        DELETE FROM mobile_sync_changes
        WHERE module_key='communications' AND collection_key IN ('recipients','deliveries');

        INSERT INTO mobile_sync_record_versions(
          organization_id,module_key,collection_key,record_id,version,deleted,server_updated_at,last_device_id
        )
        SELECT r.organization_id,'communications','recipients',r.id,1,r.created_at<v_cutoff,now(),NULL
        FROM communication_recipients r
        ON CONFLICT(organization_id,module_key,collection_key,record_id)
        DO UPDATE SET version=mobile_sync_record_versions.version+1,
                      deleted=EXCLUDED.deleted,server_updated_at=now(),last_device_id=NULL;

        DELETE FROM mobile_sync_tombstones t
        USING communication_recipients r
        WHERE t.organization_id=r.organization_id AND t.module_key='communications'
          AND t.collection_key='recipients' AND t.record_id=r.id AND r.created_at>=v_cutoff;

        INSERT INTO mobile_sync_tombstones(
          organization_id,module_key,collection_key,record_id,version,deleted_at,device_id
        )
        SELECT v.organization_id,v.module_key,v.collection_key,v.record_id,v.version,now(),NULL
        FROM mobile_sync_record_versions v
        JOIN communication_recipients r
          ON r.organization_id=v.organization_id AND r.id=v.record_id
        WHERE v.module_key='communications' AND v.collection_key='recipients' AND r.created_at<v_cutoff
        ON CONFLICT(organization_id,module_key,collection_key,record_id)
        DO UPDATE SET version=EXCLUDED.version,deleted_at=now(),device_id=NULL;

        INSERT INTO mobile_sync_changes(
          organization_id,module_key,collection_key,record_id,version,operation,payload_json,changed_by,device_id,changed_at
        )
        SELECT r.organization_id,'communications','recipients',r.id,v.version,
               CASE WHEN r.created_at>=v_cutoff THEN 'upsert' ELSE 'delete' END,
               CASE WHEN r.created_at>=v_cutoff THEN jsonb_build_object(
                 'id',r.id,'campaignId',r.campaign_id,'recipientType',r.recipient_type,'recipientId',r.recipient_id,
                 'relatedEntityType',r.related_entity_type,'relatedEntityId',r.related_entity_id,'recipientName',r.recipient_name,
                 'phone',r.phone,'status',r.status,'skipReason',r.skip_reason,'createdAt',r.created_at
               )::text ELSE NULL END,
               NULL,NULL,now()
        FROM communication_recipients r
        JOIN mobile_sync_record_versions v
          ON v.organization_id=r.organization_id AND v.module_key='communications'
         AND v.collection_key='recipients' AND v.record_id=r.id;

        INSERT INTO mobile_sync_record_versions(
          organization_id,module_key,collection_key,record_id,version,deleted,server_updated_at,last_device_id
        )
        SELECT d.organization_id,'communications','deliveries',d.id,1,d.created_at<v_cutoff,now(),NULL
        FROM communication_deliveries d
        ON CONFLICT(organization_id,module_key,collection_key,record_id)
        DO UPDATE SET version=mobile_sync_record_versions.version+1,
                      deleted=EXCLUDED.deleted,server_updated_at=now(),last_device_id=NULL;

        DELETE FROM mobile_sync_tombstones t
        USING communication_deliveries d
        WHERE t.organization_id=d.organization_id AND t.module_key='communications'
          AND t.collection_key='deliveries' AND t.record_id=d.id AND d.created_at>=v_cutoff;

        INSERT INTO mobile_sync_tombstones(
          organization_id,module_key,collection_key,record_id,version,deleted_at,device_id
        )
        SELECT v.organization_id,v.module_key,v.collection_key,v.record_id,v.version,now(),NULL
        FROM mobile_sync_record_versions v
        JOIN communication_deliveries d
          ON d.organization_id=v.organization_id AND d.id=v.record_id
        WHERE v.module_key='communications' AND v.collection_key='deliveries' AND d.created_at<v_cutoff
        ON CONFLICT(organization_id,module_key,collection_key,record_id)
        DO UPDATE SET version=EXCLUDED.version,deleted_at=now(),device_id=NULL;

        INSERT INTO mobile_sync_changes(
          organization_id,module_key,collection_key,record_id,version,operation,payload_json,changed_by,device_id,changed_at
        )
        SELECT d.organization_id,'communications','deliveries',d.id,v.version,
               CASE WHEN d.created_at>=v_cutoff THEN 'upsert' ELSE 'delete' END,
               CASE WHEN d.created_at>=v_cutoff THEN jsonb_build_object(
                 'id',d.id,'campaignId',d.campaign_id,'recipientSnapshotId',d.recipient_snapshot_id,'channel',d.channel,
                 'recipientPhone',d.recipient_phone,'provider',d.provider,'renderedSubject',d.rendered_subject,
                 'renderedMessage',d.rendered_message,'status',d.status,'attempts',d.attempts,'queuedAt',d.queued_at,
                 'sentAt',d.sent_at,'deliveredAt',d.delivered_at,'failedAt',d.failed_at
               )::text ELSE NULL END,
               NULL,NULL,now()
        FROM communication_deliveries d
        JOIN mobile_sync_record_versions v
          ON v.organization_id=d.organization_id AND v.module_key='communications'
         AND v.collection_key='deliveries' AND v.record_id=d.id;

        INSERT INTO mobile_sync_changes(
          organization_id,module_key,collection_key,record_id,version,operation,payload_json,changed_by,device_id,changed_at
        )
        SELECT t.organization_id,t.module_key,t.collection_key,t.record_id,t.version,'delete',NULL,NULL,t.device_id,now()
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
      END IF;

      INSERT INTO ledgerly_meta.compatibility_migrations(compatibility_key)
      VALUES('${COMPATIBILITY_KEY}')
      ON CONFLICT(compatibility_key) DO NOTHING;
    END $$;
  `);

  return typeof database.transaction === 'function' ? database.transaction(work) : work(database);
}
