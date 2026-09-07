CREATE TABLE IF NOT EXISTS work_chat_threads (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('internal','whatsapp')),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  task_id TEXT REFERENCES work_tasks(id) ON DELETE SET NULL,
  notification_id TEXT REFERENCES work_notifications(id) ON DELETE SET NULL,
  whatsapp_conversation_id TEXT,
  external_phone TEXT,
  external_name TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  closed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  closed_at TEXT,
  last_message_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS work_chat_participants (
  thread_id TEXT NOT NULL REFERENCES work_chat_threads(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  unread_count INTEGER NOT NULL DEFAULT 0,
  last_read_at TEXT,
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(thread_id,user_id)
);

CREATE TABLE IF NOT EXISTS work_chat_messages (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES work_chat_threads(id) ON DELETE CASCADE,
  sender_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  direction TEXT NOT NULL DEFAULT 'internal' CHECK(direction IN ('internal','inbound','outbound')),
  message_type TEXT NOT NULL DEFAULT 'text' CHECK(message_type IN ('text','image','audio','video','document','system')),
  body TEXT,
  file_key TEXT,
  file_name TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  external_message_id TEXT,
  delivery_status TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE work_notification_deliveries ADD COLUMN provider_conversation_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_work_chat_whatsapp ON work_chat_threads(whatsapp_conversation_id) WHERE whatsapp_conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_chat_org_recent ON work_chat_threads(organization_id,last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_chat_participant ON work_chat_participants(user_id,unread_count,thread_id);
CREATE INDEX IF NOT EXISTS idx_work_chat_messages ON work_chat_messages(thread_id,created_at);
CREATE INDEX IF NOT EXISTS idx_work_delivery_conversation ON work_notification_deliveries(provider_conversation_id);
