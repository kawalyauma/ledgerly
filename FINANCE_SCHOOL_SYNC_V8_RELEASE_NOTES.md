# Ledgerly Finance + School Management Sync v8

## What changed

- Fixed Student Fee Balances so learner names, admission/student numbers, class/stream, and balances are returned with a consistent camelCase API contract.
- Added report pagination, CSV export, and printable full-report output with school/company letterhead on the main reporting surfaces.
- Added a shared searchable select component with visible loading and empty states for student and chart-of-account selectors.
- Standardized school finance references on the immutable internal `studentId` (`std_...`). Admission/student numbers remain display, search, and import aliases.
- Added meaningful journal narration for school fee invoices and richer narration for generic documents.
- Journal detail now resolves contact/project/school dimensions to human-readable names instead of showing raw dimension IDs.
- Linked journal reversal now voids the source document when safe. School fee charges linked to a void document are cancelled, so the school fee subledger and general ledger stay consistent.
- Generic journal reversal is blocked for source-managed school fee adjustments/write-offs/refunds; these must be reversed from Fees & Billing so both ledgers stay synchronized.
- Historical reversed school-fee journals/documents are repaired by migration `0012_school_fee_ledger_sync.sql`.
- Fee balances, statements, defaulters, class summaries, ageing, and dashboard totals exclude voided source documents defensively.
- Replaced raw control-account entry during invoice/bill posting with a searchable loading-aware account selector.

## Deployment requirement

Apply all pending D1 migrations, including:

`migrations/0012_school_fee_ledger_sync.sql`

This migration is required for the document-status → school-fee-charge synchronization trigger and historical repair.

## Identifier policy

- Canonical reference: `school_students.id` / `studentId` (`std_...`).
- Display/search aliases: admission number and student number.
- Imports may accept admission/student number, but they are resolved to the canonical `std_...` ID before storage.

## Validation performed

- Syntax/transpile validation passed for all modified backend and frontend TypeScript/TSX files.
- SQLite migration/reversal synchronization scenario passed: reversed fee journal → source document void → linked fee charge cancelled.
- A full npm build/test suite could not be completed in this environment because dependency installation timed out; no claim is made that the full project build was executed here.
