PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS communication_message_types (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type_key TEXT NOT NULL,
  name TEXT NOT NULL,
  module_key TEXT NOT NULL DEFAULT 'platform',
  category TEXT NOT NULL DEFAULT 'general',
  audience_kind TEXT NOT NULL,
  subject_template TEXT NOT NULL,
  message_template TEXT NOT NULL,
  audience_defaults_json TEXT NOT NULL DEFAULT '{}',
  system_type INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, type_key)
);
CREATE INDEX IF NOT EXISTS communication_types_org_idx ON communication_message_types(organization_id, module_key, active, name);

CREATE TABLE IF NOT EXISTS communication_campaigns (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  message_type_id TEXT REFERENCES communication_message_types(id) ON DELETE SET NULL,
  type_key TEXT NOT NULL,
  module_key TEXT NOT NULL DEFAULT 'platform',
  name TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  subject_template TEXT NOT NULL,
  message_template TEXT NOT NULL,
  channels_json TEXT NOT NULL DEFAULT '["sms"]',
  audience_kind TEXT NOT NULL,
  audience_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','scheduled','queued','sending','completed','partial','failed','cancelled')),
  scheduled_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  delivery_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS communication_campaigns_org_idx ON communication_campaigns(organization_id, status, scheduled_at, created_at);

CREATE TABLE IF NOT EXISTS communication_recipients (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL REFERENCES communication_campaigns(id) ON DELETE CASCADE,
  recipient_type TEXT NOT NULL,
  recipient_id TEXT,
  related_entity_type TEXT,
  related_entity_id TEXT,
  recipient_name TEXT NOT NULL,
  phone TEXT,
  data_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','queued','sent','partial','failed','skipped')),
  skip_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS communication_recipients_campaign_idx ON communication_recipients(organization_id, campaign_id, status, recipient_name);

CREATE TABLE IF NOT EXISTS communication_deliveries (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL REFERENCES communication_campaigns(id) ON DELETE CASCADE,
  recipient_snapshot_id TEXT NOT NULL REFERENCES communication_recipients(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK(channel IN ('sms','whatsapp')),
  recipient_phone TEXT NOT NULL,
  provider TEXT NOT NULL,
  template_name TEXT,
  template_language TEXT,
  template_variables_json TEXT NOT NULL DEFAULT '{}',
  rendered_subject TEXT NOT NULL,
  rendered_message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','sent','delivered','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  provider_message_id TEXT,
  last_error TEXT,
  queued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT,
  delivered_at TEXT,
  failed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(campaign_id, recipient_snapshot_id, channel)
);
CREATE INDEX IF NOT EXISTS communication_deliveries_status_idx ON communication_deliveries(status, created_at);
CREATE INDEX IF NOT EXISTS communication_deliveries_campaign_idx ON communication_deliveries(organization_id, campaign_id, channel, status);

CREATE TABLE IF NOT EXISTS communication_preferences (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  recipient_type TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  sms_enabled INTEGER NOT NULL DEFAULT 1,
  whatsapp_enabled INTEGER NOT NULL DEFAULT 1,
  do_not_contact INTEGER NOT NULL DEFAULT 0,
  quiet_hours_json TEXT NOT NULL DEFAULT '{}',
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(organization_id, recipient_type, recipient_id)
);

CREATE TABLE IF NOT EXISTS communication_provider_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  event_type TEXT,
  external_id TEXT,
  payload_hash TEXT,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT,
  UNIQUE(provider, external_id, event_type)
);

-- Existing schools: communications permissions.
INSERT OR IGNORE INTO school_role_permissions (organization_id, role_id, permission, effect)
SELECT organization_id,id,'school.communications:read','allow' FROM school_roles
WHERE code IN ('super_admin','school_admin','head_teacher','deputy_head','director','class_teacher','bursar','accountant','registrar','receptionist');

INSERT OR IGNORE INTO school_role_permissions (organization_id, role_id, permission, effect)
SELECT organization_id,id,'school.communications:send','allow' FROM school_roles
WHERE code IN ('super_admin','school_admin','head_teacher','deputy_head','director','class_teacher','bursar','accountant','registrar');

INSERT OR IGNORE INTO school_role_permissions (organization_id, role_id, permission, effect)
SELECT organization_id,id,'school.communications:manage','allow' FROM school_roles
WHERE code IN ('super_admin','school_admin','head_teacher','deputy_head','director');
