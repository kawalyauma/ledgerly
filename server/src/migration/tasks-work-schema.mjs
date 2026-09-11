export async function ensureTasksWorkSchema(database) {
  await database.query(`
CREATE TABLE IF NOT EXISTS work_teams (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  lead_user_id text REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,name)
);
CREATE TABLE IF NOT EXISTS work_team_members (
  team_id text NOT NULL REFERENCES work_teams(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK(role IN ('lead','manager','member','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(team_id,user_id)
);
CREATE TABLE IF NOT EXISTS work_contacts (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ledger_contact_id text,
  kind text NOT NULL DEFAULT 'person' CHECK(kind IN ('person','company')),
  name text NOT NULL,
  email text,
  phone text,
  company_name text,
  notes text,
  tags_json text NOT NULL DEFAULT '[]',
  custom_fields_json text NOT NULL DEFAULT '{}',
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE TABLE IF NOT EXISTS work_projects (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  finance_project_id text,
  team_id text REFERENCES work_teams(id) ON DELETE SET NULL,
  contact_id text REFERENCES work_contacts(id) ON DELETE SET NULL,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'planning' CHECK(status IN ('planning','active','on_hold','completed','cancelled')),
  priority text NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','urgent')),
  owner_user_id text REFERENCES users(id) ON DELETE SET NULL,
  start_date date,
  due_date date,
  progress integer NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  ledger_contact_id text,
  CHECK(due_date IS NULL OR start_date IS NULL OR start_date<=due_date),
  UNIQUE(organization_id,code)
);
CREATE TABLE IF NOT EXISTS work_project_members (
  project_id text NOT NULL REFERENCES work_projects(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK(role IN ('owner','manager','member','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(project_id,user_id)
);
CREATE TABLE IF NOT EXISTS work_sequences (
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sequence_name text NOT NULL,
  current_value integer NOT NULL DEFAULT 0 CHECK(current_value>=0),
  PRIMARY KEY(organization_id,sequence_name)
);
CREATE TABLE IF NOT EXISTS work_tasks (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id text REFERENCES work_projects(id) ON DELETE SET NULL,
  parent_task_id text REFERENCES work_tasks(id) ON DELETE CASCADE,
  task_number integer NOT NULL,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'todo' CHECK(status IN ('backlog','todo','in_progress','blocked','in_review','completed','cancelled')),
  priority text NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','urgent')),
  start_at timestamptz,
  due_at timestamptz,
  completed_at timestamptz,
  estimated_minutes integer CHECK(estimated_minutes IS NULL OR estimated_minutes>=0),
  actual_minutes integer NOT NULL DEFAULT 0 CHECK(actual_minutes>=0),
  progress integer NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
  recurrence_json text,
  custom_fields_json text NOT NULL DEFAULT '{}',
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CHECK(parent_task_id IS NULL OR parent_task_id<>id),
  CHECK(due_at IS NULL OR start_at IS NULL OR start_at<=due_at),
  UNIQUE(organization_id,task_number)
);
CREATE TABLE IF NOT EXISTS work_task_assignees (
  task_id text NOT NULL REFERENCES work_tasks(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by text REFERENCES users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(task_id,user_id)
);
CREATE TABLE IF NOT EXISTS work_task_followers (
  task_id text NOT NULL REFERENCES work_tasks(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(task_id,user_id)
);
CREATE TABLE IF NOT EXISTS work_task_checklist_items (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES work_tasks(id) ON DELETE CASCADE,
  title text NOT NULL,
  is_completed boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  completed_by text REFERENCES users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK((is_completed AND completed_at IS NOT NULL) OR NOT is_completed)
);
CREATE TABLE IF NOT EXISTS work_comments (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id text NOT NULL REFERENCES work_tasks(id) ON DELETE CASCADE,
  author_user_id text REFERENCES users(id) ON DELETE SET NULL,
  body text NOT NULL,
  mentions_json text NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE TABLE IF NOT EXISTS work_time_entries (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id text NOT NULL REFERENCES work_tasks(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  description text,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  minutes integer NOT NULL DEFAULT 0 CHECK(minutes>=0),
  billable boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(ended_at IS NULL OR ended_at>=started_at)
);
CREATE TABLE IF NOT EXISTS work_notifications (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  entity_type text,
  entity_id text,
  data_json text NOT NULL DEFAULT '{}',
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS work_notification_preferences (
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  in_app boolean NOT NULL DEFAULT true,
  email boolean NOT NULL DEFAULT true,
  sms boolean NOT NULL DEFAULT false,
  whatsapp boolean NOT NULL DEFAULT false,
  quiet_hours_json text,
  PRIMARY KEY(organization_id,user_id,event_type)
);
CREATE TABLE IF NOT EXISTS work_notification_deliveries (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  notification_id text NOT NULL REFERENCES work_notifications(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK(channel IN ('email','sms','whatsapp')),
  recipient text NOT NULL,
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','sent','delivered','failed')),
  provider_message_id text,
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
  last_error text,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  provider_conversation_id text,
  UNIQUE(notification_id,channel,recipient)
);
CREATE TABLE IF NOT EXISTS work_webhook_receipts (
  id text PRIMARY KEY,
  source text NOT NULL,
  event_type text,
  payload_hash text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE TABLE IF NOT EXISTS work_task_reminders (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id text NOT NULL REFERENCES work_tasks(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reminder_type text NOT NULL,
  reminder_key text NOT NULL UNIQUE,
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS work_chat_threads (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('internal','whatsapp')),
  title text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  task_id text REFERENCES work_tasks(id) ON DELETE SET NULL,
  notification_id text REFERENCES work_notifications(id) ON DELETE SET NULL,
  whatsapp_conversation_id text,
  external_phone text,
  external_name text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  closed_by text REFERENCES users(id) ON DELETE SET NULL,
  closed_at timestamptz,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK((status='closed' AND closed_at IS NOT NULL) OR status='open')
);
CREATE TABLE IF NOT EXISTS work_chat_participants (
  thread_id text NOT NULL REFERENCES work_chat_threads(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  unread_count integer NOT NULL DEFAULT 0 CHECK(unread_count>=0),
  last_read_at timestamptz,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(thread_id,user_id)
);
CREATE TABLE IF NOT EXISTS work_chat_messages (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  thread_id text NOT NULL REFERENCES work_chat_threads(id) ON DELETE CASCADE,
  sender_user_id text REFERENCES users(id) ON DELETE SET NULL,
  direction text NOT NULL DEFAULT 'internal' CHECK(direction IN ('internal','inbound','outbound')),
  message_type text NOT NULL DEFAULT 'text' CHECK(message_type IN ('text','image','audio','video','document','system')),
  body text,
  file_key text,
  file_name text,
  mime_type text,
  size_bytes bigint CHECK(size_bytes IS NULL OR size_bytes>=0),
  external_message_id text,
  delivery_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(body IS NOT NULL OR file_key IS NOT NULL OR message_type='system')
);

-- PostgreSQL-only durable recurrence/idempotency ledger. Source task/reminder rows stay untouched.
CREATE TABLE IF NOT EXISTS work_recurrence_occurrences (
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_task_id text NOT NULL REFERENCES work_tasks(id) ON DELETE CASCADE,
  occurrence_key text NOT NULL,
  generated_task_id text REFERENCES work_tasks(id) ON DELETE SET NULL,
  due_at timestamptz,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,source_task_id,occurrence_key),
  UNIQUE(organization_id,generated_task_id)
);

CREATE INDEX IF NOT EXISTS idx_work_team_members_user ON work_team_members(user_id,team_id);
CREATE INDEX IF NOT EXISTS idx_work_contacts_org ON work_contacts(organization_id,archived_at,name);
CREATE INDEX IF NOT EXISTS idx_work_projects_org ON work_projects(organization_id,status,archived_at);
CREATE INDEX IF NOT EXISTS idx_work_projects_contact ON work_projects(organization_id,ledger_contact_id,archived_at);
CREATE INDEX IF NOT EXISTS idx_work_tasks_org_status ON work_tasks(organization_id,status,archived_at);
CREATE INDEX IF NOT EXISTS idx_work_tasks_due ON work_tasks(organization_id,due_at,status);
CREATE INDEX IF NOT EXISTS idx_work_task_assignees_user ON work_task_assignees(user_id,task_id);
CREATE INDEX IF NOT EXISTS idx_work_comments_task ON work_comments(task_id,created_at);
CREATE INDEX IF NOT EXISTS idx_work_time_task ON work_time_entries(task_id,user_id,started_at);
CREATE INDEX IF NOT EXISTS idx_work_notifications_user ON work_notifications(organization_id,user_id,read_at,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_deliveries_status ON work_notification_deliveries(status,created_at);
CREATE INDEX IF NOT EXISTS idx_work_reminders_task ON work_task_reminders(task_id,user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_chat_whatsapp ON work_chat_threads(whatsapp_conversation_id) WHERE whatsapp_conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_chat_org_recent ON work_chat_threads(organization_id,last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_chat_participant ON work_chat_participants(user_id,unread_count,thread_id);
CREATE INDEX IF NOT EXISTS idx_work_chat_messages ON work_chat_messages(thread_id,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_chat_external_message ON work_chat_messages(organization_id,external_message_id) WHERE external_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_delivery_conversation ON work_notification_deliveries(provider_conversation_id);
CREATE INDEX IF NOT EXISTS idx_work_recurrence_due ON work_recurrence_occurrences(organization_id,due_at,source_task_id);
  `);
}
