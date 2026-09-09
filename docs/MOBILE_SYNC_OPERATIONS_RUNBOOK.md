# Ledgerly Mobile Offline Sync Operations Runbook

This runbook records the final reliability and security audit of Ledgerly's generic mobile synchronization system and the appliance protocols that intentionally sit outside it. It complements `MOBILE_SYNC_ARCHITECTURE.md` and is written for operators and module developers.

## Verified operating model

Ledgerly Mobile is designed to keep approved workflows usable through very long connectivity outages, including roughly one year offline. The current opaque offline grant lifetime is 400 days. Reconnection still requires a live server exchange before any push or pull; that exchange revalidates the device, user, organization, current organization membership, school account state and grant revocation before issuing a 15-minute access token.

A device that remains disconnected beyond the grant expiry cannot silently bypass authentication. It must authenticate/register again according to the normal mobile flow.

Local Mobile Sync payloads, queued mutation payloads/dependencies/results and secure session/grant material are encrypted with AES-GCM using a key held by Android KeyStore. The local database stores synchronization metadata and identifiers, while durable business payloads are encrypted.

## One-year offline reconnect scenario

The expected long-outage flow is:

1. While online, register the installation and bootstrap the required collections.
2. Persist the collection schemas, records and acknowledged bootstrap watermarks locally.
3. While offline, read the local replica and queue only mutations permitted by each collection contract.
4. Allocate one monotonic per-device sequence in the same SQLite transaction that stores each queued operation.
5. On reconnect, exchange the still-valid opaque grant for a short-lived access token. The server re-checks current permissions and membership at this point.
6. Fetch the current manifest. If queued operations use an obsolete collection schema, do not acknowledge the new schema until those operations are reconciled or migrated.
7. Flush any locally persisted bootstrap/pull acknowledgements left from an earlier interrupted session.
8. Push pending operations in sequence order. A dependency block does not consume sequence; terminal validation/conflict outcomes do consume sequence so later work is not permanently deadlocked.
9. Retry the same operation/batch IDs after network uncertainty. The server replays stored terminal results rather than applying the domain mutation twice.
10. Pull server changes from each collection's acknowledged cursor, apply them locally, persist the pull acknowledgement, and only then acknowledge the exact delivery cursor to the server.
11. Continue until the local queue and pending acknowledgement stores are empty.

This design tolerates the server changing extensively while the device is away. Server-owned configuration, accounting, payroll, shared stock and other control state is revalidated when offline intents are converted.

## Interrupted-sync recovery matrix

| Failure point | Recovery behavior |
| --- | --- |
| Device crashes before local enqueue commit | No operation exists and no sequence was consumed. |
| Device crashes after local enqueue | Operation and sequence persist together and are sent later. |
| Request never reaches server | Retry the same operation/batch IDs. |
| Server commits push but response is lost | Stored operation/batch result is replayed; domain mutation is not repeated. |
| Push conflicts with newer server version | Conflict becomes a terminal result and consumes that sequence. |
| Dependency is still pending | Operation remains blocked/retryable and does not consume sequence. |
| Pull is received but app crashes before local apply | Server cursor is unchanged; delivery can be requested again. |
| Pull is applied locally but HTTP acknowledgement is lost | Local pending ACK survives; startup resends the exact delivery ID/cursor. Equal-version replay is idempotent. |
| Bootstrap is applied locally but server ACK is lost | Local pending bootstrap ACK survives and is flushed on startup. |
| Server worker crashes during an asynchronous module intent | Hardened processors retry/recover stale work using stable IDs/idempotency keys. |
| User changes Ledgerly account/API endpoint | The previous account's replica, queue and ACK state must be purged transactionally before a new sync identity can be registered. Reset failure now fails closed. |

## Account-switch isolation

`clearMobileSyncAccountData()` must never ignore a local reset failure. The native reset removes records, operations, bootstrap/pull acknowledgements, collection state and resets the next sequence in one SQLite transaction. The TypeScript client clears the stored mobile-sync identity only after that transaction succeeds.

This prevents queued operations or replicated records from one organization surviving into a newly registered organization on the same installation.

## Source-of-truth summary

- Attendance: append-only capture events may originate offline; canonical sessions/records/roster/policies are server-owned.
- School Students: only the explicitly safe profile whitelist is mutable offline; enrollment/status/promotion and protected relationships remain server-owned.
- Academics: approved teacher-owned planning/delivery fields may be edited offline; scheduling/templates/supervision authority remains server-side.
- Exams: marks can use stale-version-protected offline edits; setup, publication and computed reports are server-owned.
- School Fees: official charges, receipts, balances, allocations and journals are server-owned. Offline capture creates immutable receipt intents.
- Finance Core: posted financial state is server-owned. Offline creation is restricted to draft document/journal intents.
- Books: stock and official distributions are server-owned. Offline changes are immutable operation intents validated against current stock/enrollment on conversion.
- Human Resources: master employment state is server-owned; leave requests and onboarding completion use safe intent flows.
- Payroll & Payments: official payments/payroll processing are server-owned; offline payment capture creates draft intents only.
- Tasks & Work: project structure is server-owned; task status/progress/actual-time edits use stale-version protection; comments/time/checklist completion use append-only patterns.
- Communications: delivery is server/provider-controlled; offline work is restricted to campaign drafts.
- Contacts: name/email profile edits use stale-version protection; new people/addresses are append-only; lifecycle/financial fields remain server-owned.

## Sensitive-data audit

Verified durable mobile snapshots do not include raw biometric templates, provider API credentials, camera/node secrets, R2 payslip object keys, HR banking/tax data, or arbitrary sensitive financial-control fields.

Payroll payment-batch snapshot items contain employee ID and amount only. Communications snapshots contain message/campaign/delivery state rather than provider secrets. Attendance biometric settings contain thresholds/configuration, not template bytes.

Security Camera recording list/timeline API responses deliberately omit NVR filesystem `local_path`. Playback and export use separate short-lived grants instead.

## Printerly exception

Printerly is not generic Mobile Sync. It is an appliance/local-spool protocol.

Node pairing returns a high-entropy node credential once and stores only its SHA-256 hash server-side. Printable bytes can be downloaded only by an authenticated node that also presents the active job claim for that node/job. Claims are leased for 15 minutes and renewed during active processing. Tenant job listings do not expose R2 object keys or printable payload URLs.

Secure-release PINs/tokens are stored as digests, are revocable/one-use, are rate-limited after failures, and expire between 2 and 120 minutes (15 minutes by default).

Do not add stale generic-sync commands for print claiming, document retrieval, cancellation, release, routing, approvals or node administration.

## Security Camera exception

Security Cameras are also outside generic Mobile Sync for real-time/control operations.

- Camera pairing QR token: one-time, hash stored, 10-minute expiry.
- NVR/server pairing token: one-time, hash stored, 20-minute expiry.
- Camera/server credentials: high-entropy; only hashes retained by Ledgerly.
- Live viewer signaling token: fresh random token, 5-minute expiry.
- Recording playback grant: 10-minute expiry.
- Clip export grant: 30-minute expiry.
- Video payloads stay on the assigned local NVR/storage path; browser/mobile responses do not expose the NVR filesystem path.

Do not move live start/stop, pairing, camera/NVR lifecycle, evidence deletion, recording policy or failover control into year-old generic queued mutations.

## Asynchronous intent processors

The following modules are wired into scheduled backend execution:

- School Fees receipt intents.
- Ledgerly Finance document/journal intents.
- Books operation intents.
- Human Resources leave/onboarding intents.
- Payroll & Payments payment intents.

Books, Finance, Payroll and HR leave explicitly recover stale `processing` rows after a lease interval. HR onboarding uses a future retry lease while remaining pending. School Fees scans stale `processing` receipt intents and reconverts them using the stable payment idempotency key `school-fee-mobile-intent:<intentId>`.

Terminal validation/business failures are bounded; infrastructure failures use retry/backoff rather than becoming permanent successes.

## Migration and collection checks

The generic Mobile Sync migration sequence from `0028` through `0052` is unique and ordered. Later Printerly/Security Camera migrations use timestamp-style names and should keep that convention.

Every collection is registered by the tuple `moduleKey:collectionKey`. The registry rejects duplicate tuples at startup and rejects writable collections without a mutation preparer.

The generated backend registry includes Academics, Attendance, Books, Communications, Contacts, Exams, Human Resources, Ledgerly Finance Core, Mobile Sync, Payroll & Payments, Printerly, School Management, Security Camera and Tasks & Work.

## Tombstones and long-offline deletion

Server deletes are represented by durable tombstones/change events. The native store retains the record version with `deleted=true`, while normal local reads exclude deleted rows. Privacy/schema migrations that remove data must scrub historical change payloads, republish sanitized current rows and replay retained tombstones.

Do not introduce changelog/tombstone compaction based only on age. Any future compaction must prove that all supported long-offline devices have crossed a safe acknowledged watermark or force a safe rebootstrap.

## Schema upgrades

A device must acknowledge the exact current collection schema before bootstrap/push/pull. Queued operations carrying an obsolete schema block acknowledgement of the new schema until reconciled; they are not silently reinterpreted.

The native record store is intentionally JSON-shaped, so many collection payload shape upgrades do not require SQLite column changes. If the native database schema itself changes in future, implement an explicit Android database migration before increasing its database version.

## Verification performed

The audit verified source-level behavior for authentication/revocation, local encryption, queue sequence allocation, bootstrap/pull ACK durability, push idempotency, dependency ordering, conflict/CAS behavior, tombstones, account isolation, module registration, migration numbering, sensitive snapshots, scheduled intent recovery, Printerly credential/payload boundaries, and Security Camera pairing/live/playback/export boundaries.

A full repository `npm`/mobile Gradle build was not executed in the audit environment because the available container could not resolve `github.com`, and the audited GitHub head exposed no CI status checks. Do not interpret this runbook as a replacement for the normal developer command suite. Before release, run the repository's current module sync/validation, TypeScript checks, unit tests, web build, Android checks, migration dry-run/apply tests, and an API-level device bootstrap/push/retry/pull/ack smoke test in an environment with dependencies installed.

## Release smoke test

For each release that changes sync behavior, exercise this sequence with a test organization:

1. Register a fresh mobile device.
2. Exchange the offline grant.
3. Fetch/ack manifest schemas.
4. Bootstrap at least one read-only and one writable collection and acknowledge bootstrap.
5. Queue one safe offline mutation and one append-only intent.
6. Push them; discard the HTTP response; retry the exact same batch and confirm no duplicate domain rows.
7. Make a server-side update and deletion, pull them, apply locally, discard the ACK response, resend the pending ACK and confirm exact-cursor idempotency.
8. Create a stale base-version mutation and verify a conflict rather than silent overwrite.
9. Create a dependency-blocked operation and verify its sequence is not consumed until the dependency resolves.
10. Disable/revoke the device or user and confirm the next grant exchange is denied.
11. Attempt an account switch while forcing local reset failure and confirm the app refuses to register the second tenant.
12. Verify Printerly and Security Camera real-time/appliance commands do not appear in the generic Mobile Sync manifest.
