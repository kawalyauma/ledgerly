PRAGMA foreign_keys = ON;

-- Tasks & Work module ported from kawalyauma/tasks-work-backend.
-- Core Ledgerly organizations, users, sessions and memberships are reused.

CREATE TABLE IF NOT EXISTS work_teams (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  lead_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,name)
);

CREATE TABLE IF NOT EXISTS work_team_members (
  team_id TEXT NOT NULL REFERENCES work_teams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('lead','manager','member','viewer')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(team_id,user_id)
);

CREATE TABLE IF NOT EXISTS work_contacts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ledger_contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'person' CHECK(kind IN ('person','company')),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  company_name TEXT,
  notes TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  custom_fields_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS work_projects (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  finance_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  team_id TEXT REFERENCES work_teams(id) ON DELETE SET NULL,
  contact_id TEXT REFERENCES work_contacts(id) ON DELETE SET NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'planning' CHECK(status IN ('planning','active','on_hold','completed','cancelled')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','urgent')),
  owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  start_date TEXT,
  due_date TEXT,
  progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT,
  UNIQUE(organization_id,code)
);

CREATE TABLE IF NOT EXISTS work_project_members (
  project_id TEXT NOT NULL REFERENCES work_projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('owner','manager','member','viewer')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(project_id,user_id)
);

CREATE TABLE IF NOT EXISTS work_sequences (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sequence_name TEXT NOT NULL,
  current_value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(organization_id,sequence_name)
);

CREATE TABLE IF NOT EXISTS work_tasks (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES work_projects(id) ON DELETE SET NULL,
  parent_task_id TEXT REFERENCES work_tasks(id) ON DELETE CASCADE,
  task_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('backlog','todo','in_progress','blocked','in_review','completed','cancelled')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','urgent')),
  start_at TEXT,
  due_at TEXT,
  completed_at TEXT,
  estimated_minutes INTEGER,
  actual_minutes INTEGER NOT NULL DEFAULT 0,
  progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
  recurrence_json TEXT,
  custom_fields_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT,
  UNIQUE(organization_id,task_number)
);

CREATE TABLE IF NOT EXISTS work_task_assignees (
  task_id TEXT NOT NULL REFERENCES work_tasks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(task_id,user_id)
);

CREATE TABLE IF NOT EXISTS work_task_followers (
  task_id TEXT NOT NULL REFERENCES work_tasks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(task_id,user_id)
);

CREATE TABLE IF NOT EXISTS work_task_checklist_items (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES work_tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  is_completed INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  completed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS work_comments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES work_tasks(id) ON DELETE CASCADE,
  author_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  mentions_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS work_time_entries (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES work_tasks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  description TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  minutes INTEGER NOT NULL DEFAULT 0,
  billable INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS work_notifications (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  data_json TEXT NOT NULL DEFAULT '{}',
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS work_notification_preferences (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  in_app INTEGER NOT NULL DEFAULT 1,
  email INTEGER NOT NULL DEFAULT 1,
  sms INTEGER NOT NULL DEFAULT 0,
  whatsapp INTEGER NOT NULL DEFAULT 0,
  quiet_hours_json TEXT,
  PRIMARY KEY(organization_id,user_id,event_type)
);

CREATE TABLE IF NOT EXISTS work_notification_deliveries (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  notification_id TEXT NOT NULL REFERENCES work_notifications(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK(channel IN ('email','sms','whatsapp')),
  recipient TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','sent','delivered','failed')),
  provider_message_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(notification_id,channel,recipient)
);

CREATE TABLE IF NOT EXISTS work_webhook_receipts (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  event_type TEXT,
  payload_hash TEXT,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT
);

CREATE TABLE IF NOT EXISTS work_task_reminders (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES work_tasks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reminder_type TEXT NOT NULL,
  reminder_key TEXT NOT NULL UNIQUE,
  sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_work_team_members_user ON work_team_members(user_id,team_id);
CREATE INDEX IF NOT EXISTS idx_work_contacts_org ON work_contacts(organization_id,archived_at,name);
CREATE INDEX IF NOT EXISTS idx_work_projects_org ON work_projects(organization_id,status,archived_at);
CREATE INDEX IF NOT EXISTS idx_work_tasks_org_status ON work_tasks(organization_id,status,archived_at);
CREATE INDEX IF NOT EXISTS idx_work_tasks_due ON work_tasks(organization_id,due_at,status);
CREATE INDEX IF NOT EXISTS idx_work_task_assignees_user ON work_task_assignees(user_id,task_id);
CREATE INDEX IF NOT EXISTS idx_work_comments_task ON work_comments(task_id,created_at);
CREATE INDEX IF NOT EXISTS idx_work_time_task ON work_time_entries(task_id,user_id,started_at);
CREATE INDEX IF NOT EXISTS idx_work_notifications_user ON work_notifications(organization_id,user_id,read_at,created_at);
CREATE INDEX IF NOT EXISTS idx_work_deliveries_status ON work_notification_deliveries(status,created_at);
CREATE INDEX IF NOT EXISTS idx_work_reminders_task ON work_task_reminders(task_id,user_id);

INSERT OR IGNORE INTO app_modules (module_key,name,version,description,category,core,manifest_json,active)
VALUES ('tasks-work','Tasks & Work','1.0.0','Multi-tenant task and work management with projects, teams, contacts, comments, time tracking and multi-channel notifications.','operations',0,'{"backendModules":["teams","contacts","projects","tasks","subtasks","assignees","followers","checklists","comments","time-tracking","notifications","reminders","whatsapp-webhook"],"communications":["resend","egosms","ulib-whatsapp-hub"]}',1);

-- This requested module is enabled for existing organizations on installation.
INSERT OR IGNORE INTO organization_modules (organization_id,module_key,enabled,configuration_json,enabled_at)
SELECT id,'tasks-work',1,'{}',CURRENT_TIMESTAMP FROM organizations;
