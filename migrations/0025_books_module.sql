-- Standalone Books module.
-- Depends on School Management for learner, class, stream and academic-period master data.

PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS bks_stock_movements (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  book_type TEXT NOT NULL CHECK(book_type IN ('small','a4')),
  movement_type TEXT NOT NULL CHECK(movement_type IN ('receipt','adjustment')),
  quantity_delta INTEGER NOT NULL CHECK(quantity_delta <> 0),
  movement_on TEXT NOT NULL,
  reference_text TEXT,
  notes TEXT,
  recorded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reversed_at TEXT,
  reversed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reversal_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS bks_stock_movements_org_idx
  ON bks_stock_movements(organization_id, book_type, movement_on, created_at);
CREATE INDEX IF NOT EXISTS bks_stock_movements_active_idx
  ON bks_stock_movements(organization_id, book_type, reversed_at);

CREATE TABLE IF NOT EXISTS bks_distribution_batches (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  academic_year_id TEXT REFERENCES school_academic_years(id) ON DELETE SET NULL,
  term_id TEXT REFERENCES school_terms(id) ON DELETE SET NULL,
  class_id TEXT NOT NULL REFERENCES school_classes(id) ON DELETE RESTRICT,
  stream_id TEXT REFERENCES school_streams(id) ON DELETE SET NULL,
  book_type TEXT NOT NULL CHECK(book_type IN ('small','a4')),
  quantity_per_learner INTEGER NOT NULL CHECK(quantity_per_learner > 0),
  learner_count INTEGER NOT NULL CHECK(learner_count >= 0),
  total_quantity INTEGER NOT NULL CHECK(total_quantity >= 0),
  distributed_on TEXT NOT NULL,
  notes TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reversed_at TEXT,
  reversed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reversal_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS bks_distribution_batches_org_idx
  ON bks_distribution_batches(organization_id, academic_year_id, term_id, class_id, stream_id, distributed_on);

CREATE TABLE IF NOT EXISTS bks_distributions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES school_students(id) ON DELETE RESTRICT,
  academic_year_id TEXT REFERENCES school_academic_years(id) ON DELETE SET NULL,
  term_id TEXT REFERENCES school_terms(id) ON DELETE SET NULL,
  class_id TEXT REFERENCES school_classes(id) ON DELETE SET NULL,
  stream_id TEXT REFERENCES school_streams(id) ON DELETE SET NULL,
  batch_id TEXT REFERENCES bks_distribution_batches(id) ON DELETE SET NULL,
  book_type TEXT NOT NULL CHECK(book_type IN ('small','a4')),
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  distributed_on TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'individual' CHECK(source IN ('individual','bulk')),
  notes TEXT,
  distributed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reversed_at TEXT,
  reversed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reversal_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS bks_distributions_org_date_idx
  ON bks_distributions(organization_id, distributed_on, book_type);
CREATE INDEX IF NOT EXISTS bks_distributions_student_idx
  ON bks_distributions(organization_id, student_id, academic_year_id, term_id, distributed_on);
CREATE INDEX IF NOT EXISTS bks_distributions_class_idx
  ON bks_distributions(organization_id, class_id, stream_id, academic_year_id, term_id, distributed_on);
CREATE INDEX IF NOT EXISTS bks_distributions_batch_idx
  ON bks_distributions(organization_id, batch_id);

-- Backfill sensible Books permissions for school roles that already exist.
INSERT OR IGNORE INTO school_role_permissions (organization_id, role_id, permission, effect)
SELECT organization_id,id,'school.books:read','allow' FROM school_roles
WHERE code IN (
  'super_admin','school_admin','head_teacher','deputy_head','director',
  'director_of_studies','head_of_department','teacher','class_teacher',
  'bursar','accountant','registrar','librarian','storekeeper'
);

INSERT OR IGNORE INTO school_role_permissions (organization_id, role_id, permission, effect)
SELECT organization_id,id,'school.books:write','allow' FROM school_roles
WHERE code IN (
  'super_admin','school_admin','head_teacher','deputy_head',
  'class_teacher','bursar','accountant','librarian','storekeeper'
);

INSERT OR IGNORE INTO school_role_permissions (organization_id, role_id, permission, effect)
SELECT organization_id,id,'school.books:manage','allow' FROM school_roles
WHERE code IN (
  'super_admin','school_admin','head_teacher','deputy_head','director',
  'bursar','librarian','storekeeper'
);

INSERT OR IGNORE INTO school_role_permissions (organization_id, role_id, permission, effect)
SELECT organization_id,id,'school.books:export','allow' FROM school_roles
WHERE code IN (
  'super_admin','school_admin','head_teacher','deputy_head','director',
  'director_of_studies','bursar','accountant','registrar','librarian','storekeeper'
);
