# Ledgerly Mobile Sync Architecture

This document defines the backend contract for Ledgerly's offline-first mobile synchronization system. It is the operational source of truth for module authors adding or changing mobile-sync behavior.

## Goals

Ledgerly mobile clients must remain usable during very long periods without connectivity, including deployments that may stay offline for roughly a year. Reconnection must be safe under retries, process crashes, stale data, duplicate requests, schema upgrades and concurrent server-side changes.

The system therefore prioritizes deterministic synchronization over last-write-wins convenience. Server-owned financial, payroll, configuration and operational-control data stays server authoritative. Only explicitly registered collections may participate in generic Mobile Sync.

## Core guarantees

- Stable client-generated record and operation identifiers.
- Per-device monotonic push sequence.
- Operation and batch idempotency.
- Content-hash replay protection.
- Atomic domain mutation + record version + change feed + audit + sequence advancement.
- Explicit record versions and stale-write detection.
- Persistent tombstones for deletions.
- Dependency-aware push ordering.
- Exact pull cursor acknowledgement.
- Bootstrap watermarks that prevent races from skipping changes.
- Schema acknowledgement before bootstrap or mutation.
- Interrupted-sync recovery and replay of persisted terminal results.
- Server-side permission checks on every pull and push collection.
- No arbitrary table access from a mobile client.

## Device and authentication lifecycle

A signed-in user registers one logical mobile installation. Registration returns a high-entropy opaque offline grant that is stored only as a SHA-256 hash on the server.

The current offline grant lifetime is 400 days. Exchanging a valid grant produces a short-lived 15-minute JWT. The exchange does not replace the opaque grant because rotating it during exchange could strand a long-offline client if the server committed the rotation but the HTTP response was lost.

Every exchange revalidates:

- the mobile device is active;
- the user is active;
- the organization is active;
- the user still belongs to the organization;
- the school account is not suspended or locked;
- the grant is not revoked or expired.

The access token is bound to `mobileDeviceId`. A token issued for one device cannot be used to operate another device even when both belong to the same user.

Revoking a device revokes every unrevoked offline grant for that device.

## Collection registry

Generic synchronization is opt-in. Each collection is registered under the tuple:

`moduleKey:collectionKey`

Duplicate registration is a startup error. A writable collection cannot register without a mutation preparer.

Each collection declares:

- schema version;
- mode: read-only, read-write or append-only;
- source of truth: server, client or merge;
- conflict policy;
- pull/push scope;
- optional dynamic authorization;
- snapshot function;
- mutation preparation logic for writable collections.

New modules must never expose arbitrary user-selected table names or raw SQL through Mobile Sync.

## Schema versioning

A device must acknowledge the exact current schema version for every requested collection before it can bootstrap or mutate that collection.

A mutation carrying an old or mismatched schema version is rejected with `SCHEMA_MIGRATION_REQUIRED`.

When a privacy or shape change removes fields from a collection, the server must do more than change the snapshot. Historical `mobile_sync_changes` payloads can still contain the old shape. The migration must:

1. scrub unsafe historical change rows for that collection;
2. republish authoritative sanitized current rows;
3. replay retained tombstones so long-offline devices also remove records that disappeared during the migration;
4. increment the collection schema version.

This pattern is currently used for Contacts, School Students, Tasks & Work and Communications privacy hardening.

## Push protocol

A push batch contains at most 250 operations. Each operation includes:

- `operationId`;
- monotonic `sequence`;
- module and collection keys;
- stable record ID;
- operation kind;
- collection schema version;
- base record version;
- client timestamp;
- payload;
- optional operation/record dependencies.

The backend stores operation state and request hashes. Retrying the same operation after a lost response returns the persisted result instead of applying the domain mutation again.

The device sequence advances only when an operation reaches a terminal state. A blocked dependency does not consume the sequence. Conflicts and terminal validation rejections do consume it so a permanently invalid operation cannot deadlock all future synchronization.

### Conflict policies

- `server-wins`: stale client mutations conflict.
- `reject-stale`: stale client mutations conflict and must be reconciled explicitly.
- `append-only`: a record ID may be created once and cannot be overwritten or deleted by mobile.

Do not introduce `client-wins` behavior for accounting, payroll, stock, attendance canonical state, configuration or shared operational resources without a module-specific consistency proof.

## Dependencies

Operations may depend on another operation ID or on a server record reaching a minimum version.

A pending dependency blocks the operation and keeps it retryable. A dependency that permanently conflicted or was rejected causes the dependent operation to be rejected rather than applying on an invalid foundation.

Clients should include dependencies whenever the local action relies on another queued creation or a server-owned reference.

## Transactional consistency

For an applied generic mutation, these effects are committed together in one D1 batch:

- optimistic CAS check;
- domain statements;
- record version update;
- tombstone create/remove;
- change-feed insert;
- operation result/state update;
- device sequence advancement;
- sync event/audit data.

This prevents a crash from committing a business mutation without advancing its synchronization state, or vice versa.

Module-specific intent processors must provide equivalent idempotency using deterministic IDs or stable idempotency keys.

## Pull and bootstrap

Pull uses the global change ID with a per-device cursor. Deliveries are acknowledged using the exact delivery ID and cursor returned by the server. The server does not skip an unacknowledged range.

Bootstrap records the collection change watermark before reading the snapshot. A concurrent server mutation may therefore appear in both the snapshot and the next incremental pull, but it cannot be omitted. Duplicate delivery is safe because record versions make the later authoritative state deterministic.

Tombstones are retained so deletions remain observable by long-offline clients. There is currently no aggressive changelog compaction. Any future compactor must be based on proven acknowledged watermarks and must preserve the one-year-offline contract.

## Interrupted-sync recovery

The design explicitly supports these failures:

- connection lost before the server receives a request;
- connection lost while processing;
- server commits an operation but the response is lost;
- client retries the same batch or operation;
- client receives pull data but acknowledgement is lost;
- server worker restarts while an asynchronous intent is processing.

Generic operations replay stored terminal results. Asynchronous intent processors use stale-processing recovery, bounded retries/backoff and stable idempotency keys or deterministic official IDs.

## Module source-of-truth matrix

### Attendance

Offline devices append attendance events. Canonical attendance records, sessions, roster, policies, identifiers and sanitized biometric settings are server authoritative. Biometric template bytes are never generic mobile-sync payloads.

### School / Students

Safe student profile fields are read-write with stale-version protection. Guardian relationships, enrollments and academic context are server authoritative. Arbitrary student `customFields` are server-only. Student notes are append-only and non-confidential.

### Academics

Scheduling, templates and supervision projections are server authoritative. Teacher-owned schemes, scheme items, lesson plans and deliveries may be edited offline subject to ownership/approval rules. Actions are append-only.

### Exams

Exam setup and report cards are server authoritative. Mark entry is writable offline with stale-version rejection. Publication, finalization, grading configuration and report computation remain server-only.

### School Fees

Official charges, receipts, balances, payment plans, allocations and journals are server authoritative. Mobile creates immutable receipt intents only. The server validates and converts intents idempotently.

### Ledgerly Finance Core

Accounts, dimensions, products, projects, periods, bank accounts, documents, journal rows and other posted finance state are server authoritative. Mobile may create append-only document/journal draft intents. Posting, reversals, approvals, reconciliation and period closing are never offline-writable.

### Books

Shared stock and official distributions are server authoritative. Mobile submits immutable operation intents for stock movement and book issue. The server converts them with deterministic official IDs and validates current stock/enrollment state.

### Human Resources

Employee master data, departments, leave types, leave requests and onboarding state are read-only projections. Offline write flows use append-only leave-request and onboarding-completion intents. Payroll, tax, bank and other sensitive employment data are excluded.

### Payroll & Payments

Official payments and payroll state are server authoritative. Mobile may create draft payment intents only. Payroll run/line/payment-batch projections require payroll-specific read permission. Posting, calculation, approval, reversals and salary-batch execution remain online/server-only.

### Tasks & Work

Projects are server authoritative. Tasks allow only safe operational edits such as status, progress and actual time. Structural task lifecycle fields remain server-controlled. Comments/time entries/checklist completion are append-only patterns. Arbitrary task `customFields` are server-only.

### Communications

Message types, campaigns, recipients and deliveries are server-authoritative history. Mobile may create campaign drafts only; send/schedule/provider delivery remains online. Recipient arbitrary data variables, provider message IDs and raw provider errors are not generic mobile-sync payloads.

### Contacts

Contacts allow safe profile edits only. Contact people and addresses are append-only from mobile. Financial/contact policy fields, tax data, credit settings, pricing tiers and arbitrary custom fields remain server-only.

## Appliance modules intentionally outside generic Mobile Sync

### Printerly

Printerly is an appliance/local-spool system, not a stale-record synchronization problem. Printer nodes use leased/idempotent execution, local spool durability, secure pairing, checksum validation and restart-safe duplicate prevention.

Do not expose print execution, queue claims, secure-release commands, approvals, raw printable payloads, quotas or printer credentials through year-old generic Mobile Sync operations.

### Security Cameras

Security Cameras use a local-first camera/NVR architecture with a durable local MP4 segment queue, authenticated segment replay, WebRTC WHIP/WHEP streaming, short-lived viewer/playback grants, local recording and server-controlled policy/governance.

Do not expose pairing, live-stream start/stop, evidence deletion, recording policy mutation, NVR administration, camera lifecycle controls or long-lived media credentials as generic stale Mobile Sync writes.

The camera module may share Ledgerly identity/permissions infrastructure, but its streaming and durable-segment protocols remain separate from record synchronization.

## Sensitive-data rules

A mobile snapshot is durable local data. Treat it as a long-lived replica, not as a transient API response.

Do not synchronize:

- secrets, API keys, provider tokens or credential hashes;
- raw biometric template bytes;
- raw storage/R2 object locators when a server API can issue a short-lived access grant instead;
- arbitrary custom JSON unless the collection contract explicitly requires it and its sensitivity is understood;
- bank/tax/payroll details outside payroll-specific authorization;
- raw provider diagnostics that can expose implementation details;
- server-only financial control fields.

A field being read-only is not enough to make it safe to download.

## Retry policy for asynchronous intents

Validation/authorization failures are terminal. Infrastructure/runtime failures are retryable with backoff. Processors should recover stale `processing` rows after a lease interval and cap repeated failures where appropriate.

Current hardened processors include School Fees, Finance, Books, HR and Payroll/Payments.

## Adding a new offline collection

Before registering a new collection:

1. Decide whether offline writing is genuinely required. Prefer read-only snapshots or append-only intents for shared/financial state.
2. Define server vs client source of truth.
3. Choose the conflict policy explicitly.
4. Define stable record IDs and operation idempotency.
5. Define required dependencies.
6. Minimize the durable snapshot payload.
7. Add collection-specific pull/push authorization.
8. Add migration triggers/change publication for server-origin changes.
9. Preserve deletes with tombstones.
10. Add schema-version migration behavior for future shape changes.
11. Test duplicate request, lost response, stale base version, dependency block, delete/tombstone and long-offline upgrade scenarios.
12. Verify no appliance/real-time control is being forced into generic Mobile Sync.

## Migration ordering

The Mobile Sync sequence currently begins with `0028_mobile_sync_core.sql` and then module adapters/hardening migrations. Privacy migrations are ordered so their dependencies run deterministically:

- `0049_contacts_mobile_privacy.sql`
- `0050_school_students_mobile_privacy_v2.sql`
- `0051_tasks_work_mobile_privacy_v2.sql`
- `0052_mobile_privacy_tombstones_communications.sql`

Do not reuse an existing numeric prefix within the Mobile Sync sequence. Newer appliance modules may use timestamp-style migration names; preserve their existing convention rather than renaming already-applied migrations.

## Operational verification checklist

Before declaring a synchronization change complete, verify:

- module imports its mobile-sync adapter at backend startup;
- generated backend registry still includes the owning module;
- collection keys are unique;
- schema acknowledgement is required;
- pull and push scopes are correct;
- snapshots exclude durable secrets/sensitive arbitrary data;
- server-origin inserts/updates/deletes publish changes;
- deletes create/replay tombstones;
- stale writes conflict correctly;
- duplicate operations replay instead of reapplying;
- domain mutation and sync metadata are atomic;
- async processors recover interrupted work and do not retry terminal failures forever;
- migrations have deterministic unique names;
- Printerly/Security Camera control operations remain outside generic Mobile Sync.
