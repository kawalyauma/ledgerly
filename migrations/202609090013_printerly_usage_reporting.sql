-- Printerly v1.3: usage analytics and CSV reporting metadata.

UPDATE app_modules
SET version='1.3.0',
    description='Secure remote printing, Scannerly, printer-health monitoring, print-cost accounting and usage reporting for Ledgerly using always-online local Printerly Nodes.',
    manifest_json='{"standalone":true,"sharedCore":["organizations","users","permissions","files","projects","dimensions","journals","notifications","reports"],"features":["remote-printing","global-print-with-printerly","department-project-charging","print-cost-accounting","ledger-journal-posting","printer-health","multi-channel-alerts","scannerly","student-staff-scan-routing","module-scan-inbox","usage-reporting","daily-requester-department-project-printer-breakdowns","csv-usage-export","private-r2-documents","secure-release","priority-queue","cups-node","sane-scanner","claim-leases","checksum-verification","restart-safe-duplicate-prevention"]}',
    updated_at=CURRENT_TIMESTAMP
WHERE module_key='printerly';
