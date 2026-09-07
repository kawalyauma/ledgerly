PRAGMA foreign_keys = ON;

-- Tasks & Work v1.1: blend identity/people with Ledgerly instead of maintaining a parallel people store.
-- Legacy work_contacts rows are preserved for compatibility, migrated into Ledgerly contacts, then retired from active use.

INSERT OR IGNORE INTO contacts
  (id,organization_id,type,code,name,email,tax_number,payment_terms_days,active,custom_fields,credit_limit_minor,pricing_tier,archived_at,created_at,updated_at)
SELECT
  wc.id,
  wc.organization_id,
  CASE WHEN wc.kind='company' THEN 'customer' ELSE 'other' END,
  NULL,
  CASE WHEN wc.kind='company' AND COALESCE(wc.company_name,'')<>'' THEN wc.company_name ELSE wc.name END,
  wc.email,
  NULL,
  0,
  CASE WHEN wc.archived_at IS NULL THEN 1 ELSE 0 END,
  json_object(
    'tasksWorkLegacy',1,
    'legacyKind',wc.kind,
    'legacyName',wc.name,
    'legacyPhone',COALESCE(wc.phone,''),
    'legacyNotes',COALESCE(wc.notes,''),
    'legacyTags',json(wc.tags_json)
  ),
  0,
  NULL,
  wc.archived_at,
  wc.created_at,
  wc.updated_at
FROM work_contacts wc
WHERE wc.ledger_contact_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.id=wc.id);

UPDATE work_contacts
SET ledger_contact_id=id
WHERE ledger_contact_id IS NULL
  AND EXISTS (SELECT 1 FROM contacts c WHERE c.id=work_contacts.id AND c.organization_id=work_contacts.organization_id);

-- Preserve phone/person detail from legacy Work contacts in Ledgerly's shared contact people table.
INSERT OR IGNORE INTO contact_people
  (id,organization_id,contact_id,name,email,phone,role,is_primary,created_at,updated_at)
SELECT
  'cpr_work_' || substr(wc.id,1,48),
  wc.organization_id,
  wc.ledger_contact_id,
  wc.name,
  wc.email,
  wc.phone,
  CASE WHEN wc.kind='company' THEN 'Primary contact' ELSE 'Contact' END,
  1,
  wc.created_at,
  wc.updated_at
FROM work_contacts wc
WHERE wc.ledger_contact_id IS NOT NULL
  AND (COALESCE(wc.phone,'')<>'' OR (wc.kind='company' AND wc.name<>COALESCE(wc.company_name,wc.name)))
  AND NOT EXISTS (
    SELECT 1 FROM contact_people cp
    WHERE cp.organization_id=wc.organization_id AND cp.contact_id=wc.ledger_contact_id AND cp.is_primary=1
  );

ALTER TABLE work_projects ADD COLUMN ledger_contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL;

UPDATE work_projects
SET ledger_contact_id=(
  SELECT wc.ledger_contact_id FROM work_contacts wc
  WHERE wc.id=work_projects.contact_id AND wc.organization_id=work_projects.organization_id
)
WHERE contact_id IS NOT NULL AND ledger_contact_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_work_projects_ledger_contact
  ON work_projects(organization_id,ledger_contact_id,archived_at);

UPDATE app_modules
SET version='1.1.0',
    description='Projects, tasks, teams and execution workflows blended with Ledgerly users, contacts, people and School staff.',
    manifest_json='{"backendModules":["teams","shared-contacts","projects","tasks","subtasks","assignees","followers","checklists","comments","time-tracking","notifications","reminders","whatsapp-webhook"],"sharedCore":["organizations","users","memberships","contacts","contact_people","school_staff_profiles"],"communications":["resend","egosms","ulib-whatsapp-hub"]}',
    updated_at=CURRENT_TIMESTAMP
WHERE module_key='tasks-work';
