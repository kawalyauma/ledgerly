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
  `);
}
