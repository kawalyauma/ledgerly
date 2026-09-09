-- Redact finance-sensitive and arbitrary custom contact data from the generic mobile change feed.
DROP TRIGGER IF EXISTS contacts_sync_contact_i;
DROP TRIGGER IF EXISTS contacts_sync_contact_u;
CREATE TRIGGER contacts_sync_contact_i AFTER INSERT ON contacts
WHEN NOT EXISTS(SELECT 1 FROM contacts_mobile_sync_suppression WHERE record_key=NEW.organization_id||':contacts:'||NEW.id)
BEGIN
 INSERT INTO contacts_mobile_change_events VALUES(NULL,NEW.organization_id,'contacts',NEW.id,
  CASE WHEN NEW.archived_at IS NULL THEN 'upsert' ELSE 'delete' END,
  CASE WHEN NEW.archived_at IS NULL THEN json_object('id',NEW.id,'type',NEW.type,'code',NEW.code,'name',NEW.name,'email',NEW.email,'active',NEW.active) ELSE NULL END);
END;
CREATE TRIGGER contacts_sync_contact_u AFTER UPDATE ON contacts
WHEN NOT EXISTS(SELECT 1 FROM contacts_mobile_sync_suppression WHERE record_key=NEW.organization_id||':contacts:'||NEW.id)
BEGIN
 INSERT INTO contacts_mobile_change_events VALUES(NULL,NEW.organization_id,'contacts',NEW.id,
  CASE WHEN NEW.archived_at IS NULL THEN 'upsert' ELSE 'delete' END,
  CASE WHEN NEW.archived_at IS NULL THEN json_object('id',NEW.id,'type',NEW.type,'code',NEW.code,'name',NEW.name,'email',NEW.email,'active',NEW.active) ELSE NULL END);
END;
