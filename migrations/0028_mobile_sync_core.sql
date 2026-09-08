-- Ledgerly Mobile Sync Core v1
-- Durable offline devices, long-lived revocable grants, ordered/idempotent pushes,
-- per-collection pull acknowledgements, record versions, tombstones and recovery state.

CREATE TABLE IF NOT EXISTS mobile_sync_devices (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  installation_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('android','ios')),
  device_model TEXT,
  os_version TEXT,
  app_version TEXT NOT NULL,
  client_schema_version INTEGER NOT NULL DEFAULT 1 CHECK (client_schema_version >= 1),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','revoked')),
  last_push_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_push_sequence >= 0),
  last_seen_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,user_id,installation_id)
);
CREATE INDEX IF NOT EXISTS idx_mobile_sync_devices_org_user ON mobile_sync_devices(organization_id,user_id,status);

CREATE TABLE IF NOT EXISTS mobile_offline_grants (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES mobile_sync_devices(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  last_used_at TEXT,
  rotated_at TEXT,
  revoked_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mobile_offline_grants_active_device
  ON mobile_offline_grants(device_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mobile_offline_grants_expiry ON mobile_offline_grants(expires_at,revoked_at);

CREATE TABLE IF NOT EXISTS mobile_sync_device_schemas (
  device_id TEXT NOT NULL REFERENCES mobile_sync_devices(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  collection_key TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  acknowledged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (device_id,module_key,collection_key)
);

CREATE TABLE IF NOT EXISTS mobile_sync_cas_checks (
  check_id TEXT PRIMARY KEY,
  ok INTEGER NOT NULL,
  CONSTRAINT mobile_sync_cas_version_match CHECK (ok = 1)
);

CREATE TABLE IF NOT EXISTS mobile_sync_record_versions (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  collection_key TEXT NOT NULL,
  record_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0,1)),
  server_updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_device_id TEXT REFERENCES mobile_sync_devices(id) ON DELETE SET NULL,
  PRIMARY KEY (organization_id,module_key,collection_key,record_id)
);
CREATE INDEX IF NOT EXISTS idx_mobile_sync_record_versions_collection
  ON mobile_sync_record_versions(organization_id,module_key,collection_key,server_updated_at);

CREATE TABLE IF NOT EXISTS mobile_sync_tombstones (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  collection_key TEXT NOT NULL,
  record_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  device_id TEXT REFERENCES mobile_sync_devices(id) ON DELETE SET NULL,
  PRIMARY KEY (organization_id,module_key,collection_key,record_id)
);
CREATE INDEX IF NOT EXISTS idx_mobile_sync_tombstones_retention
  ON mobile_sync_tombstones(organization_id,module_key,collection_key,deleted_at);

CREATE TABLE IF NOT EXISTS mobile_sync_changes (
  change_id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  collection_key TEXT NOT NULL,
  record_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  operation TEXT NOT NULL CHECK (operation IN ('upsert','delete')),
  payload_json TEXT,
  changed_by TEXT,
  device_id TEXT REFERENCES mobile_sync_devices(id) ON DELETE SET NULL,
  changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_mobile_sync_changes_pull
  ON mobile_sync_changes(organization_id,module_key,collection_key,change_id);
CREATE INDEX IF NOT EXISTS idx_mobile_sync_changes_record
  ON mobile_sync_changes(organization_id,module_key,collection_key,record_id,change_id DESC);

CREATE TABLE IF NOT EXISTS mobile_sync_batches (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES mobile_sync_devices(id) ON DELETE CASCADE,
  batch_uuid TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','partial','completed','failed')),
  first_sequence INTEGER NOT NULL,
  last_sequence INTEGER NOT NULL,
  received_count INTEGER NOT NULL DEFAULT 0,
  applied_count INTEGER NOT NULL DEFAULT 0,
  conflict_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  blocked_count INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  result_json TEXT,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (device_id,batch_uuid)
);
CREATE INDEX IF NOT EXISTS idx_mobile_sync_batches_recovery ON mobile_sync_batches(device_id,status,received_at DESC);

CREATE TABLE IF NOT EXISTS mobile_sync_operations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES mobile_sync_devices(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL REFERENCES mobile_sync_batches(id) ON DELETE CASCADE,
  operation_uuid TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  sequence_number INTEGER NOT NULL CHECK (sequence_number >= 1),
  module_key TEXT NOT NULL,
  collection_key TEXT NOT NULL,
  record_id TEXT NOT NULL,
  operation_kind TEXT NOT NULL CHECK (operation_kind IN ('upsert','delete')),
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  base_version INTEGER NOT NULL DEFAULT 0 CHECK (base_version >= 0),
  client_timestamp TEXT NOT NULL,
  payload_json TEXT,
  dependencies_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','applied','duplicate','conflict','blocked','rejected')),
  retryable INTEGER NOT NULL DEFAULT 1 CHECK (retryable IN (0,1)),
  server_version INTEGER,
  result_json TEXT,
  error_code TEXT,
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT,
  UNIQUE (device_id,operation_uuid),
  UNIQUE (device_id,sequence_number)
);
CREATE INDEX IF NOT EXISTS idx_mobile_sync_operations_batch ON mobile_sync_operations(batch_id,sequence_number);
CREATE INDEX IF NOT EXISTS idx_mobile_sync_operations_recovery ON mobile_sync_operations(device_id,status,sequence_number);

CREATE TABLE IF NOT EXISTS mobile_sync_conflicts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES mobile_sync_devices(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL REFERENCES mobile_sync_batches(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  module_key TEXT NOT NULL,
  collection_key TEXT NOT NULL,
  record_id TEXT NOT NULL,
  client_base_version INTEGER NOT NULL,
  server_version INTEGER NOT NULL,
  client_payload_json TEXT,
  server_payload_json TEXT,
  resolution TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_mobile_sync_conflicts_record ON mobile_sync_conflicts(organization_id,module_key,collection_key,record_id,created_at DESC);

CREATE TABLE IF NOT EXISTS mobile_sync_pull_state (
  device_id TEXT NOT NULL REFERENCES mobile_sync_devices(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  collection_key TEXT NOT NULL,
  last_acked_change_id INTEGER NOT NULL DEFAULT 0 CHECK (last_acked_change_id >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (device_id,module_key,collection_key)
);

CREATE TABLE IF NOT EXISTS mobile_sync_pull_deliveries (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES mobile_sync_devices(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  module_key TEXT NOT NULL,
  collection_key TEXT NOT NULL,
  from_change_id INTEGER NOT NULL DEFAULT 0,
  to_change_id INTEGER NOT NULL DEFAULT 0,
  payload_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','acknowledged')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  acknowledged_at TEXT,
  UNIQUE (device_id,request_id,module_key,collection_key)
);
CREATE INDEX IF NOT EXISTS idx_mobile_sync_pull_pending ON mobile_sync_pull_deliveries(device_id,status,created_at);

CREATE TABLE IF NOT EXISTS mobile_sync_bootstraps (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES mobile_sync_devices(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','acknowledged','superseded')),
  watermarks_json TEXT NOT NULL,
  collection_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  acknowledged_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mobile_sync_bootstrap_device ON mobile_sync_bootstraps(device_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS mobile_sync_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  device_id TEXT REFERENCES mobile_sync_devices(id) ON DELETE SET NULL,
  user_id TEXT,
  event_type TEXT NOT NULL,
  batch_id TEXT,
  operation_id TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_mobile_sync_events_device ON mobile_sync_events(organization_id,device_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mobile_sync_events_type ON mobile_sync_events(organization_id,event_type,created_at DESC);
