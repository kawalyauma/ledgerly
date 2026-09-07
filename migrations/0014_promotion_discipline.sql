PRAGMA foreign_keys = ON;

-- Operational student promotion engine ---------------------------------------
CREATE TABLE IF NOT EXISTS school_promotion_runs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  from_academic_year_id TEXT NOT NULL REFERENCES school_academic_years(id) ON DELETE RESTRICT,
  to_academic_year_id TEXT NOT NULL REFERENCES school_academic_years(id) ON DELETE RESTRICT,
  source_class_id TEXT REFERENCES school_classes(id) ON DELETE SET NULL,
  source_stream_id TEXT REFERENCES school_streams(id) ON DELETE SET NULL,
  effective_on TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','applied','cancelled')),
  notes TEXT,
  total_students INTEGER NOT NULL DEFAULT 0,
  recommended_promotions INTEGER NOT NULL DEFAULT 0,
  recommended_repeats INTEGER NOT NULL DEFAULT 0,
  recommended_graduations INTEGER NOT NULL DEFAULT 0,
  review_required INTEGER NOT NULL DEFAULT 0,
  applied_students INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  applied_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  applied_at TEXT,
  cancelled_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(from_academic_year_id <> to_academic_year_id)
);
CREATE INDEX IF NOT EXISTS school_promotion_runs_org_idx
  ON school_promotion_runs(organization_id, from_academic_year_id, to_academic_year_id, created_at DESC);

CREATE TABLE IF NOT EXISTS school_promotion_run_items (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES school_promotion_runs(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  from_class_id TEXT REFERENCES school_classes(id) ON DELETE SET NULL,
  from_stream_id TEXT REFERENCES school_streams(id) ON DELETE SET NULL,
  source_class_level_id TEXT REFERENCES school_class_levels(id) ON DELETE SET NULL,
  target_class_level_id TEXT REFERENCES school_class_levels(id) ON DELETE SET NULL,
  target_class_id TEXT REFERENCES school_classes(id) ON DELETE SET NULL,
  target_stream_id TEXT REFERENCES school_streams(id) ON DELETE SET NULL,
  average_percent REAL,
  failed_subjects INTEGER,
  attendance_percent REAL,
  metrics_json TEXT NOT NULL DEFAULT '{}',
  rule_snapshot_json TEXT NOT NULL DEFAULT '{}',
  recommended_decision TEXT NOT NULL CHECK(recommended_decision IN ('promoted','repeated','graduated','review')),
  recommendation_reason TEXT,
  final_decision TEXT CHECK(final_decision IN ('promoted','repeated','graduated','skipped')),
  override_reason TEXT,
  item_status TEXT NOT NULL DEFAULT 'pending' CHECK(item_status IN ('pending','applied','skipped','error')),
  applied_promotion_id TEXT REFERENCES school_student_promotions(id) ON DELETE SET NULL,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, run_id, student_id)
);
CREATE INDEX IF NOT EXISTS school_promotion_items_run_idx
  ON school_promotion_run_items(organization_id, run_id, item_status, recommended_decision);
CREATE INDEX IF NOT EXISTS school_promotion_items_student_idx
  ON school_promotion_run_items(organization_id, student_id, created_at DESC);

-- Discipline & behaviour ------------------------------------------------------
CREATE TABLE IF NOT EXISTS school_discipline_offence_types (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  default_severity TEXT NOT NULL DEFAULT 'medium' CHECK(default_severity IN ('low','medium','high','critical')),
  default_points INTEGER NOT NULL DEFAULT 0,
  default_action TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, code)
);

CREATE TABLE IF NOT EXISTS school_discipline_incidents (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  incident_number TEXT NOT NULL,
  student_id TEXT NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  academic_year_id TEXT REFERENCES school_academic_years(id) ON DELETE SET NULL,
  term_id TEXT REFERENCES school_terms(id) ON DELETE SET NULL,
  campus_id TEXT REFERENCES school_branches(id) ON DELETE SET NULL,
  offence_type_id TEXT REFERENCES school_discipline_offence_types(id) ON DELETE SET NULL,
  record_type TEXT NOT NULL DEFAULT 'incident' CHECK(record_type IN ('incident','merit','demerit')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium' CHECK(severity IN ('low','medium','high','critical')),
  points INTEGER NOT NULL DEFAULT 0,
  incident_at TEXT NOT NULL,
  location TEXT,
  witness_notes TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','investigating','actioned','resolved','closed')),
  follow_up_on TEXT,
  confidential INTEGER NOT NULL DEFAULT 0,
  reported_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,
  resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TEXT,
  resolution_notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, incident_number)
);
CREATE INDEX IF NOT EXISTS school_discipline_incident_student_idx
  ON school_discipline_incidents(organization_id, student_id, incident_at DESC);
CREATE INDEX IF NOT EXISTS school_discipline_incident_status_idx
  ON school_discipline_incidents(organization_id, status, follow_up_on, incident_at DESC);

CREATE TABLE IF NOT EXISTS school_discipline_actions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  incident_id TEXT NOT NULL REFERENCES school_discipline_incidents(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK(action_type IN ('warning','detention','suspension','counselling','community_service','parent_meeting','restorative','expulsion_recommendation','other')),
  title TEXT NOT NULL,
  notes TEXT,
  starts_on TEXT,
  ends_on TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','active','completed','cancelled')),
  issued_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  completed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS school_discipline_actions_incident_idx
  ON school_discipline_actions(organization_id, incident_id, created_at DESC);

CREATE TABLE IF NOT EXISTS school_discipline_parent_meetings (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  incident_id TEXT NOT NULL REFERENCES school_discipline_incidents(id) ON DELETE CASCADE,
  guardian_id TEXT REFERENCES school_guardians(id) ON DELETE SET NULL,
  scheduled_at TEXT NOT NULL,
  held_at TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','held','cancelled','no_show')),
  attendees TEXT,
  agenda TEXT,
  minutes TEXT,
  outcome TEXT,
  recorded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS school_discipline_meetings_incident_idx
  ON school_discipline_parent_meetings(organization_id, incident_id, scheduled_at DESC);

CREATE TABLE IF NOT EXISTS school_discipline_followups (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  incident_id TEXT NOT NULL REFERENCES school_discipline_incidents(id) ON DELETE CASCADE,
  due_on TEXT NOT NULL,
  note TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','cancelled')),
  completed_note TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  completed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS school_discipline_followup_due_idx
  ON school_discipline_followups(organization_id, status, due_on);

CREATE TABLE IF NOT EXISTS school_discipline_attachments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  incident_id TEXT NOT NULL REFERENCES school_discipline_incidents(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES school_files(id) ON DELETE RESTRICT,
  attachment_type TEXT NOT NULL DEFAULT 'evidence' CHECK(attachment_type IN ('evidence','letter','meeting_minutes','statement','other')),
  caption TEXT,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, incident_id, file_id)
);

-- Give existing built-in school roles sensible discipline access immediately.
INSERT OR IGNORE INTO school_role_permissions (organization_id, role_id, permission, effect)
SELECT organization_id, id, 'school.discipline:read', 'allow'
FROM school_roles
WHERE code IN ('super_admin','school_admin','head_teacher','deputy_head','director','teacher','class_teacher','warden','registrar');

INSERT OR IGNORE INTO school_role_permissions (organization_id, role_id, permission, effect)
SELECT organization_id, id, 'school.discipline:write', 'allow'
FROM school_roles
WHERE code IN ('super_admin','school_admin','head_teacher','deputy_head','director','class_teacher','warden');

INSERT OR IGNORE INTO school_role_permissions (organization_id, role_id, permission, effect)
SELECT organization_id, id, 'school.discipline:manage', 'allow'
FROM school_roles
WHERE code IN ('super_admin','school_admin','head_teacher','deputy_head','director');
