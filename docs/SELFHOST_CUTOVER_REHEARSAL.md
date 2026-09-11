# Ledgerly self-hosted migration rehearsal and cutover

This runbook is the final gate between the Cloudflare-backed Ledgerly deployment and the self-hosted PostgreSQL/Redis/MinIO/Node stack.

Cloudflare Workers, D1, R2, queues and CRON remain the rollback/fallback path until every gate below passes. Do not infer readiness from the existence of PostgreSQL rows or a healthy Docker stack.

## 1. Preconditions

Before a rehearsal:

- deploy the current `main` self-hosted stack to a non-production rehearsal host or isolated database;
- confirm PostgreSQL/PgBouncer, Redis, MinIO, scheduler, notifications, Printerly and NVR health;
- configure narrowly scoped Cloudflare D1 migration credentials only for the one-shot migration process;
- confirm sufficient free disk space for PostgreSQL, object storage, backups and NVR retention;
- take a verified PostgreSQL/config backup before destructive rehearsal reruns;
- keep normal production traffic on Cloudflare.

Required migration environment variables are the same values used by the existing per-phase migration CLI: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_D1_DATABASE_ID`, `CLOUDFLARE_API_TOKEN`, and the `LEDGERLY_DATABASE_*` connection settings.

## 2. Inspect the phase graph

From `server/`:

```bash
npm run migration:rehearsal -- phases
npm run migration:rehearsal -- plan
```

The rehearsal coordinator automatically includes transitive prerequisites and executes phases in dependency order. To rehearse only a domain and its prerequisites:

```bash
npm run migration:rehearsal -- plan --phases exams,tasks-work
```

Never bypass a missing prerequisite by manually editing migration bookkeeping.

## 3. Live rehearsal while Cloudflare is authoritative

Run a complete resumable rehearsal while production can continue to use Cloudflare:

```bash
npm run migration:rehearsal -- run
```

This pass validates copy/checkpoint/resume behavior, table counts and relationship checks. Source-change warnings are expected if D1 receives writes while a table is copying. They are not acceptable for final cutover.

If a phase fails, fix the cause and rerun the same command. Failed/running/validation-failed runs resume from their committed row checkpoint.

Do not continue toward cutover while any phase ends in `validation_failed` or `failed`.

## 4. Object/file migration rehearsal

Run the R2/object migration through the existing storage abstraction and verify, at minimum:

- object count by tenant/domain;
- byte totals;
- checksums where the source exposes them;
- content type and metadata;
- tenant/object-key ownership;
- receipt, student/staff, academic, evidence, report and Printerly references;
- a representative sample can be opened from MinIO/local storage.

NVR recordings are operational media and should remain on the configured NVR recording volume; migrate only metadata/evidence objects that belong in Ledgerly storage.

## 5. Restore rehearsal

A backup is not considered proven until it restores successfully.

1. Create a PostgreSQL dump with the self-host backup job.
2. Restore it into a disposable database/host using `restore-postgres.sh`.
3. Run the self-hosted server checks and migration/domain integrity tests against the restored copy.
4. Verify MinIO/object files and config backups independently.
5. Record the restore duration and any manual steps required.

Do not perform the first restore test during a production incident.

## 6. Final write-pause catch-up

Schedule a maintenance window. Pause all writes that can mutate the Cloudflare source, including mobile/offline upload workers and integrations. Reads may remain available if they cannot trigger writes.

With writes paused, run a strict all-phase copy:

```bash
npm run migration:rehearsal -- run --strict
```

`--strict` makes any D1 change during a table copy fail the phase. A previously completed phase receives a new migration run; incomplete runs remain resumable.

If anything is still writing to D1, stop and identify it rather than weakening this check.

## 7. Final cutover validation

While writes remain paused:

```bash
npm run migration:rehearsal -- cutover-validate
```

This re-opens the latest completed run for every phase and validates:

- source and target row counts;
- configured relationship/orphan checks;
- source snapshot stability since the strict copy;
- source stability during the validation pass.

The command exits non-zero when any phase is missing or fails validation. A successful JSON report must contain `"ok": true`.

Archive the JSON output with the change/cutover record.

## 8. Cross-module integrity gates

Before changing authority, verify end-to-end behavior for at least:

- login, organization membership, roles/scopes and MFA;
- student/guardian/staff identity and class/term/subject references;
- academics, attendance, books and Exams;
- Tasks & Work / Work Chat and mobile sync;
- communications opt-outs, retries, scheduled campaigns and provider IDs;
- balanced journal posting and rollback;
- School Fees payment allocation, receipt archive and journal reversal propagation;
- payroll posting/payment/reversal integrity;
- AI requester/agent/approver permission intersection, tenant-scoped RAG/memory and permanent provenance;
- Printerly queue/idempotency and node health;
- NVR LIVE + HISTORY authorization, playback grants and recording metadata.

Financial totals must reconcile with the Cloudflare source before cutover.

## 9. Performance and security gates

Run representative concurrency/load tests against the target server. Verify:

- Node worker/process capacity and graceful shutdown;
- PgBouncer/PostgreSQL connection saturation stays bounded;
- Redis cache/queue latency and dead-letter queues;
- slow-query diagnostics and indexes;
- report/PDF/payroll/AI worker concurrency limits;
- NVR disk pressure does not starve PostgreSQL or object storage;
- only Caddy/approved media ports are externally reachable;
- PostgreSQL, Redis and MinIO administration are not publicly exposed;
- TLS, rate limits, request-size limits, timeouts and secret permissions are active.

Do not size PostgreSQL connections from HTTP concurrency. Multiple API processes must share a bounded PgBouncer/database capacity.

## 10. Dual-run and authority switch

Move capabilities from Cloudflare to self-hosted authority only through their explicit cutover settings/capability map. Prefer:

1. `cloudflare` — old path authoritative;
2. `shadow` — self-hosted path observes/processes without becoming authoritative where supported;
3. `node` — self-hosted path authoritative only after validation.

Do not retire D1/R2/Workers/CRON merely because one module is ready. Switch capability-by-capability and monitor audit/error/queue/financial metrics.

## 11. Rollback

If a cutover gate fails or production integrity diverges:

- stop new self-hosted writes where required;
- return the affected capability/domain to Cloudflare authority;
- preserve self-hosted logs/audit and database state for diagnosis;
- reconcile writes made during the attempted cutover before another migration pass;
- rerun strict copy and cutover validation.

Cloudflare should not be deleted until the agreed dual-run observation period has completed and a restore/rollback drill is documented.

## Completion criteria

Self-hosted migration is ready for final production authority only when all of the following are true:

- every migration phase has a completed strict run;
- `cutover-validate` returns `ok: true` for the complete phase graph;
- object/file verification passes;
- financial and cross-module integrity checks pass;
- backup restore is proven;
- load/performance and security gates pass;
- Printerly/NVR/AI operational health is acceptable on the target hardware;
- rollback to Cloudflare has been rehearsed or documented with verified data-reconciliation steps.
