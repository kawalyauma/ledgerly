CREATE TRIGGER payment_allocation_reverse_validate
BEFORE UPDATE OF reversed_at ON payment_allocations
FOR EACH ROW
WHEN OLD.reversed_at IS NOT NULL OR NEW.reversed_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'allocation reversal is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER payment_allocation_reverse_apply
AFTER UPDATE OF reversed_at ON payment_allocations
FOR EACH ROW
WHEN OLD.reversed_at IS NULL AND NEW.reversed_at IS NOT NULL
BEGIN
  UPDATE documents
  SET paid_minor = paid_minor - OLD.amount_minor,
      status = CASE
        WHEN paid_minor - OLD.amount_minor = 0 THEN 'open'
        ELSE 'partially_paid'
      END,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = OLD.document_id AND organization_id = OLD.organization_id;
END;
