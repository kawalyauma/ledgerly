-- Printerly v1.7: audit and compliance center metadata upgrade.
UPDATE app_modules
SET version='1.7.0',
    description='Secure remote print and scan management with accounting, governance, scheduling, batch printing and unified audit/compliance reporting.',
    updated_at=CURRENT_TIMESTAMP
WHERE module_key='printerly';
