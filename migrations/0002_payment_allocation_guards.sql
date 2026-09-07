CREATE TRIGGER payment_allocation_validate
BEFORE INSERT ON payment_allocations
FOR EACH ROW
BEGIN
  SELECT (CASE WHEN NEW.amount_minor <= 0 THEN RAISE(ABORT, 'allocation amount must be positive') END);
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM payments p JOIN documents d ON d.id = NEW.document_id
    WHERE p.id = NEW.payment_id
      AND p.organization_id = NEW.organization_id
      AND d.organization_id = NEW.organization_id
      AND p.contact_id = d.contact_id
      AND p.currency = d.currency
      AND p.status = 'posted'
      AND d.status IN ('open', 'partially_paid')
      AND ((p.type = 'receipt' AND d.type = 'invoice') OR (p.type = 'payment' AND d.type = 'bill'))
  ) THEN RAISE(ABORT, 'allocation document does not match payment') END);
  SELECT (CASE WHEN (
    SELECT COALESCE(SUM(pa.amount_minor), 0) + NEW.amount_minor
    FROM payment_allocations pa WHERE pa.payment_id = NEW.payment_id
  ) > (SELECT amount_minor FROM payments WHERE id = NEW.payment_id)
  THEN RAISE(ABORT, 'allocations exceed payment amount') END);
  SELECT (CASE WHEN NEW.amount_minor > (
    SELECT total_minor - paid_minor FROM documents WHERE id = NEW.document_id
  ) THEN RAISE(ABORT, 'allocation exceeds document balance') END);
END;
--> statement-breakpoint
CREATE TRIGGER payment_allocation_apply
AFTER INSERT ON payment_allocations
FOR EACH ROW
BEGIN
  UPDATE documents
  SET paid_minor = paid_minor + NEW.amount_minor,
      status = CASE WHEN paid_minor + NEW.amount_minor = total_minor THEN 'paid' ELSE 'partially_paid' END,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.document_id AND organization_id = NEW.organization_id;
END;
