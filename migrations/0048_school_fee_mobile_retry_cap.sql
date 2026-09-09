-- Stop permanently failing School Fees offline intents from retrying forever.
-- Existing processor already retries due failures and recovers stale processing rows.
-- After ten failed conversion attempts, retain the intent as visible `failed` history but park its retry timestamp permanently.
CREATE TRIGGER IF NOT EXISTS school_mobile_fee_retry_cap
AFTER UPDATE OF status,attempts,next_attempt_at ON school_mobile_fee_receipt_intents
WHEN NEW.status='failed' AND NEW.attempts>=10 AND COALESCE(NEW.next_attempt_at,'')<>'9999-12-31T23:59:59.999Z'
BEGIN
  UPDATE school_mobile_fee_receipt_intents
  SET next_attempt_at='9999-12-31T23:59:59.999Z',updated_at=CURRENT_TIMESTAMP
  WHERE id=NEW.id AND organization_id=NEW.organization_id;
END;
