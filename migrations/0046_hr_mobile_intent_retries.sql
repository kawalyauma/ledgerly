ALTER TABLE hr_mobile_leave_intents ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hr_mobile_leave_intents ADD COLUMN last_attempt_at TEXT;
ALTER TABLE hr_mobile_leave_intents ADD COLUMN next_attempt_at TEXT;
ALTER TABLE hr_mobile_onboarding_intents ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hr_mobile_onboarding_intents ADD COLUMN last_attempt_at TEXT;
ALTER TABLE hr_mobile_onboarding_intents ADD COLUMN next_attempt_at TEXT;
CREATE INDEX IF NOT EXISTS hr_mobile_leave_retry_idx ON hr_mobile_leave_intents(status,next_attempt_at,created_at);
CREATE INDEX IF NOT EXISTS hr_mobile_onboarding_retry_idx ON hr_mobile_onboarding_intents(status,next_attempt_at,created_at);
