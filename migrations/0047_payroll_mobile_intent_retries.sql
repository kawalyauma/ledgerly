ALTER TABLE pay_mobile_payment_intents ADD COLUMN last_attempt_at TEXT;
ALTER TABLE pay_mobile_payment_intents ADD COLUMN next_attempt_at TEXT;
CREATE INDEX IF NOT EXISTS pay_mobile_payment_retry_idx ON pay_mobile_payment_intents(status,next_attempt_at,created_at);
