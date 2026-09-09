-- Printerly v1.13: service desk, incidents and SLA management.
CREATE TABLE IF NOT EXISTS prn_service_settings (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  auto_create_from_alerts INTEGER NOT NULL DEFAULT 1,
  auto_resolve_recovered INTEGER NOT NULL DEFAULT 1,
  p1_response_minutes INTEGER NOT NULL DEFAULT 30 CHECK(p1_response_minutes BETWEEN 1 AND 10080),
  p1_resolution_minutes INTEGER NOT NULL DEFAULT 240 CHECK(p1_resolution_minutes BETWEEN 1 AND 43200),
  p2_response_minutes INTEGER NOT NULL DEFAULT 120 CHECK(p2_response_minutes BETWEEN 1 AND 10080),
  p2_resolution_minutes INTEGER NOT NULL DEFAULT 480 CHECK(p2_resolution_minutes BETWEEN 1 AND 43200),
  p3_response_minutes INTEGER NOT NULL DEFAULT 480 CHECK(p3_response_minutes BETWEEN 1 AND 20160),
  p3_resolution_minutes INTEGER NOT NULL DEFAULT 1440 CHECK(p3_resolution_minutes BETWEEN 1 AND 86400),
  p4_response_minutes INTEGER NOT NULL DEFAULT 1440 CHECK(p4_response_minutes BETWEEN 1 AND 43200),
  p4_resolution_minutes INTEGER NOT NULL DEFAULT 4320 CHECK(p4_resolution_minutes BETWEEN 1 AND 172800),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(p1_resolution_minutes >= p1_response_minutes),
  CHECK(p2_resolution_minutes >= p2_response_minutes),
  CHECK(p3_resolution_minutes >= p3_response_minutes),
  CHECK(p4_resolution_minutes >= p4_response_minutes)
);

CREATE TABLE IF NOT EXISTS prn_service_tickets (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ticket_number TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'manual' CHECK(source_type IN ('manual','alert','maintenance')),
  source_alert_id TEXT REFERENCES prn_alerts(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'other' CHECK(category IN ('printer','node','scanner','scan_job','print_job','maintenance','supplies','other')),
  priority TEXT NOT NULL DEFAULT 'p3' CHECK(priority IN ('p1','p2','p3','p4')),
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','assigned','in_progress','waiting','resolved','closed','cancelled')),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  printer_id TEXT REFERENCES prn_printers(id) ON DELETE SET NULL,
  node_id TEXT REFERENCES prn_nodes(id) ON DELETE SET NULL,
  scanner_id TEXT REFERENCES prn_scanners(id) ON DELETE SET NULL,
  assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  response_due_at TEXT NOT NULL,
  resolution_due_at TEXT NOT NULL,
  first_responded_at TEXT,
  response_breached_at TEXT,
  resolution_breached_at TEXT,
  scheduled_start_at TEXT,
  scheduled_end_at TEXT,
  resolved_at TEXT,
  closed_at TEXT,
  resolution_notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,ticket_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prn_service_ticket_alert ON prn_service_tickets(organization_id,source_alert_id) WHERE source_alert_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prn_service_ticket_queue ON prn_service_tickets(organization_id,status,priority,resolution_due_at);
CREATE INDEX IF NOT EXISTS idx_prn_service_ticket_assignee ON prn_service_tickets(organization_id,assignee_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_prn_service_ticket_assets ON prn_service_tickets(organization_id,printer_id,node_id,scanner_id,status);

CREATE TABLE IF NOT EXISTS prn_service_ticket_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ticket_id TEXT NOT NULL REFERENCES prn_service_tickets(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_prn_service_ticket_events_ticket ON prn_service_ticket_events(organization_id,ticket_id,created_at);

UPDATE app_modules
SET version='1.13.0',
    description='Secure remote print and scan operations with governance, supplies, procurement and SLA-backed Printerly service desk.',
    updated_at=CURRENT_TIMESTAMP
WHERE module_key='printerly';
