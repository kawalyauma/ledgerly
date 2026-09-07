-- Keep the School Fees subledger and Ledgerly source documents synchronized.
-- A direct reversal of a posted document journal now voids the linked core
-- document in ledger.ts. This trigger mirrors that core state into the
-- school-fee charge so balances and reports use the same accounting truth.

DROP TRIGGER IF EXISTS trg_school_fee_charge_document_status;
CREATE TRIGGER trg_school_fee_charge_document_status
AFTER UPDATE OF paid_minor,status ON documents
BEGIN
  UPDATE school_student_fee_charges
  SET status = CASE
      WHEN NEW.status='void' THEN 'cancelled'
      WHEN NEW.status='paid' THEN 'settled'
      WHEN NEW.status='partially_paid' THEN 'partially_settled'
      WHEN NEW.status='open' THEN 'invoiced'
      ELSE status END,
      updated_at=CURRENT_TIMESTAMP
  WHERE organization_id=NEW.organization_id AND document_id=NEW.id
    AND status IN ('draft','invoiced','partially_settled','settled');
END;

-- Repair records created before journal/document synchronization existed.
UPDATE documents
SET status='void',updated_at=CURRENT_TIMESTAMP
WHERE paid_minor=0
  AND status='open'
  AND journal_entry_id IN (
    SELECT id FROM journal_entries WHERE status='reversed'
  );

UPDATE school_student_fee_charges
SET status='cancelled',updated_at=CURRENT_TIMESTAMP
WHERE status IN ('draft','invoiced')
  AND document_id IN (
    SELECT id FROM documents WHERE status='void'
  );

-- Backfill meaningful narration for school-fee invoice journals created before
-- the narration enrichment was added. This also repairs already-posted journals
-- such as JE records that previously showed only a document number.
UPDATE journal_entries
SET description = (
  SELECT 'School fees invoice ' || d.number || ' — ' ||
         TRIM(s.first_name || ' ' || COALESCE(s.middle_name || ' ', '') || s.last_name) ||
         CASE WHEN COALESCE(s.admission_number,'')<>'' THEN ' (' || s.admission_number || ')' ELSE '' END ||
         CASE WHEN COALESCE(c.description,'')<>'' THEN ' — ' || c.description ELSE '' END
  FROM documents d
  JOIN school_student_fee_charges c ON c.document_id=d.id AND c.organization_id=d.organization_id
  JOIN school_students s ON s.id=c.student_id AND s.organization_id=c.organization_id
  WHERE d.organization_id=journal_entries.organization_id
    AND d.journal_entry_id=journal_entries.id
  LIMIT 1
)
WHERE source_type='invoice'
  AND EXISTS (
    SELECT 1 FROM documents d
    JOIN school_student_fee_charges c ON c.document_id=d.id AND c.organization_id=d.organization_id
    WHERE d.organization_id=journal_entries.organization_id AND d.journal_entry_id=journal_entries.id
  );

UPDATE journal_lines
SET description = (SELECT je.description FROM journal_entries je WHERE je.id=journal_lines.journal_entry_id)
WHERE journal_entry_id IN (
  SELECT je.id FROM journal_entries je
  JOIN documents d ON d.journal_entry_id=je.id AND d.organization_id=je.organization_id
  JOIN school_student_fee_charges c ON c.document_id=d.id AND c.organization_id=d.organization_id
  WHERE je.source_type='invoice'
)
AND (description IS NULL OR TRIM(description)='' OR description IN (
  SELECT d.number FROM documents d WHERE d.journal_entry_id=journal_lines.journal_entry_id
));

UPDATE app_modules
SET version='1.2.1',updated_at=CURRENT_TIMESTAMP
WHERE module_key='school-management';
