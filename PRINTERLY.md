# Printerly v1.2

Printerly is Ledgerly's secure institution-wide print and scan platform.

## Architecture

`Ledgerly user → Printerly cloud queue → outbound Printerly Node → CUPS printer / SANE scanner`

No printer, scanner or school computer needs a public IP or inbound router port.

## Capabilities

- Remote printing and secure release.
- Global **Print with Printerly** from Ledgerly screens.
- Project and department charging using existing Ledgerly dimensions.
- Estimated and actual paper/toner/maintenance/electricity costing.
- Optional idempotent posting of completed print costs into Ledgerly journals.
- Printer health telemetry, node-offline detection and fault alerts.
- In-app, email, SMS and WhatsApp alert preferences using Ledgerly notification infrastructure.
- Scannerly: SANE discovery, flatbed/ADF scan jobs, private R2 storage and scan inboxes.
- Direct scan routing to student/staff documents or Finance, Academics, Examinations and School Management destinations.
- Claim leases, SHA-256 verification and restart-safe duplicate prevention.

## Deployment

Apply the newest Printerly migration, deploy Ledgerly, then install `printerly-node/` on the always-on Linux computer beside the devices. Pair that node from the Printerly UI.

PDF is the preferred print format. Scannerly supports PDF, PNG and JPEG results; ADF jobs are normalized to PDF.
