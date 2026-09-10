# Cloudflare Dependency Audit

Status: complete baseline audit for self-hosted migration  
Control board: GitHub issue #6  
Architecture source of truth: `docs/SELF_HOSTED_ARCHITECTURE.md`

This document inventories the remaining Cloudflare-specific runtime dependencies that must be replaced or isolated before the self-hosted Ledgerly runtime can become authoritative. The audit is intentionally implementation-oriented: every dependency is mapped to a self-hosted target and a cutover condition.

## 1. Runtime boundary

The current authoritative application entrypoint is `src/index.ts`, exported as a Cloudflare `ExportedHandler`. It combines three Cloudflare lifecycle surfaces:

- HTTP `fetch` through Hono;
- queue consumption through `MessageBatch`;
- scheduled execution through `ScheduledController`.

`modules/backend-types.ts` also exposes Cloudflare runtime types directly to every backend module:

- `BackendQueueHandler = (batch: MessageBatch<any>, env: Env) => Promise<void>`;
- `scheduled?: (env: Env, controller?: ScheduledController) => Promise<void>`.

**Migration target:** keep Hono/module route composition where useful, but introduce provider-neutral request, job and schedule interfaces from `server/src/contracts.mjs`. Cloudflare adapters may continue to wrap those contracts during dual-run. Module definitions must no longer require `MessageBatch` or `ScheduledController` once their self-hosted equivalents are ready.

**Cutover condition:** all mounted modules can execute under the Node runtime without importing Cloudflare-only lifecycle types.

## 2. D1 database

`src/types.ts` binds `FINANCE_DB` as `D1Database`. `wrangler.jsonc` maps it to the `your-finance-pro` D1 database and the repository `migrations/` directory.

Observed coupling includes:

- direct `env.FINANCE_DB.prepare(...).bind(...).run()/all()/first()` usage;
- D1/SQLite transaction assumptions in services and modules;
- SQLite date expressions such as `datetime('now', ...)`, `CURRENT_TIMESTAMP`, and modifier strings;
- SQLite error-text handling in `src/index.ts` for unique, foreign-key, not-null and check constraints;
- scheduled finance/report work executing SQL directly from the Worker entrypoint.

**Migration target:** PostgreSQL behind PgBouncer through the provider-neutral database service. Preserve existing IDs and tenant scoping. Add compatibility helpers/migration tooling for D1-shaped query results while modules are progressively ported. Translate SQLite-specific SQL and error handling deliberately rather than by string replacement.

**Cutover condition:** migrated data passes row-count, relationship and finance-integrity validation; all production writes for a migrated domain use PostgreSQL transactions; no authoritative Node route needs a D1 binding.

## 3. R2 object storage

`src/types.ts` binds two R2 buckets:

| Binding | Current bucket | Primary purpose | Self-hosted target |
| --- | --- | --- | --- |
| `REPORTS_BUCKET` | `your-finance-pro-reports` | generated reports/exports | storage service -> MinIO/local provider |
| `WORK_FILES_BUCKET` | `tasks-work-files` | task/work attachments | storage service -> MinIO/local provider |

Application code must not migrate from R2-specific calls to MinIO-specific calls directly. Both providers must sit behind the common storage contract (`put`, `get`, `head`, `delete`, `list`, download URL).

**Cutover condition:** all file keys are tenant-scoped, existing objects can be copied and verified, signed/download behavior is equivalent, and modules call only the Ledgerly storage abstraction.

## 4. Cloudflare Queues

`wrangler.jsonc` configures four producer/consumer queues:

| Queue binding | Queue name | Current retry/DLQ behavior | Known handler |
| --- | --- | --- | --- |
| `REPORT_QUEUE` | `finance-report-jobs` | batch 5, retry 5, DLQ `finance-report-jobs-dlq` | core report consumer |
| `WEBHOOK_QUEUE` | `finance-webhook-jobs` | batch 10, retry 8, DLQ `finance-webhook-jobs-dlq` | core webhook consumer |
| `WORK_NOTIFICATION_QUEUE` | `tasks-work-notifications` | batch 10, retry 5, DLQ `tasks-work-notifications-dlq` | Tasks & Work module |
| `COMMUNICATION_QUEUE` | `ledgerly-communications` | batch 20, retry 5, DLQ `ledgerly-communications-dlq` | Communications module |

The Worker dispatches queue batches first to module-registered handlers and then to core webhook/report consumers. Queue payload interfaces currently live in `src/types.ts` and do not yet use the versioned self-hosted job envelope consistently.

**Migration target:** Redis-backed durable queue semantics using the common envelope (`jobId`, `kind`, `organizationId`, `createdAt`, `attempt`, optional `idempotencyKey`, `payload`) with explicit acknowledgement, retry visibility and dead-letter handling. Cloudflare Queue adapters remain supported during dual-run.

**Cutover condition:** every current queue producer and consumer has an equivalent self-hosted path, retries are idempotent, failed jobs are inspectable, and no migrated workload depends on `MessageBatch` semantics.

## 5. Cloudflare scheduled triggers

`wrangler.jsonc` currently installs four CRON cadences:

| Cron | Current responsibility | Location |
| --- | --- | --- |
| `* * * * *` | camera failover, health evaluation and native notification dispatch | Security Camera module |
| `0 * * * *` | failed-report cleanup, report schedules, recurring finance templates | core Worker scheduled handler |
| `*/5 * * * *` | scheduled communications/camera notification bridge and task reminders | Communications + Tasks & Work modules |
| `0 5 * * *` | task/work reminders | Tasks & Work module |

Some module scheduled hooks also deliberately support a missing controller for direct/manual execution.

**Migration target:** persistent self-hosted scheduler registration plus queue-backed execution. Schedule identity, last/next run, concurrency policy and retry behavior must be observable. Scheduled handlers should receive a provider-neutral schedule context instead of `ScheduledController`.

**Cutover condition:** all four cadences run from the self-hosted scheduler with equivalent tenant-safe behavior and missed-run/restart recovery.

## 6. Worker static assets and edge behavior

`wrangler.jsonc` serves `./dist` through Cloudflare Workers Assets with SPA fallback and runs the Worker first for `/api/*`, `/auth/*`, `/system/*`, `/docs`, and `/openapi.json`.

**Migration target:** Caddy serves the built web application and reverse-proxies API/auth/system/docs routes to Node. Static assets use immutable/browser caching where filenames are content hashed. SPA fallback must not swallow API 404s.

**Cutover condition:** web refresh/deep links, API routing, docs and static caching pass end-to-end tests through Caddy.

## 7. Cloudflare environment/binding model

`Env` mixes infrastructure bindings and configuration/secrets in one Worker-specific object. In addition to D1/R2/queues it contains JWT, WhatsApp support, EgoSMS, Resend and biometric encryption settings.

The external providers themselves are not Cloudflare dependencies, but their configuration currently arrives through the Worker binding model.

**Migration target:** validated self-hosted configuration/secret loading. Infrastructure clients are injected through the runtime service container; business configuration is supplied separately. Secret values must never appear in health/contract endpoints or logs.

**Cutover condition:** Node can boot with validated production configuration and the same external integrations without Worker bindings.

## 8. Cloudflare-specific type/error assumptions

Remaining portability risks include:

- Cloudflare global types (`D1Database`, `R2Bucket`, `Queue`, `MessageBatch`, `ScheduledController`, `ExportedHandler`);
- D1 result shapes (`results`, `success`, SQLite-oriented semantics);
- SQLite constraint error strings used for user-facing error classification;
- Worker request environment accessed as `c.env` throughout Hono routes;
- queue producer `.send()` behavior and Cloudflare retry acknowledgement semantics;
- R2 object/body/header behavior;
- Worker Assets SPA routing;
- compatibility flags such as `nodejs_compat` and `global_fetch_strictly_public`.

These must be treated as explicit adapter/migration work. They must not leak into new provider-neutral modules.

## 9. Module-specific scheduled/queue dependencies confirmed in this audit

### Communications

- consumes `ledgerly-communications`;
- runs scheduled campaigns every five minutes;
- dispatches/reconciles Security Camera notifications from the same scheduled hook;
- receives the full Worker `Env`.

### Tasks & Work

- consumes `tasks-work-notifications`;
- runs reminders on the five-minute and 05:00 schedules;
- receives the full Worker `Env`.

### Security Camera

- runs every minute;
- evaluates failover and camera health using `FINANCE_DB`;
- dispatches camera-native notifications using Worker `Env`.

### Core finance/report runtime

- consumes finance report and webhook queues;
- hourly cleanup/scheduling directly queries D1;
- creates recurring invoices/bills/journals and optionally posts them;
- produces `REPORT_QUEUE` messages.

## 10. Migration mapping and ownership

| Cloudflare dependency | Self-hosted replacement | Migration status |
| --- | --- | --- |
| Worker HTTP lifecycle | Node HTTP/Hono runtime behind Caddy | foundation runtime exists; business routes pending |
| `FINANCE_DB` / D1 | PostgreSQL + PgBouncer database adapter | pending durable adapter/migration tooling |
| D1 migrations | PostgreSQL migrations + D1 import/verification tooling | pending |
| `REPORTS_BUCKET` R2 | storage abstraction + MinIO/local | foundation local adapter exists; durable object adapter pending |
| `WORK_FILES_BUCKET` R2 | storage abstraction + MinIO/local | foundation local adapter exists; durable object adapter pending |
| Cloudflare Queues | Redis-backed durable jobs + DLQ | contract exists; durable implementation pending |
| Cloudflare CRON | persistent scheduler + queue dispatch | contract exists; durable implementation pending |
| Worker Assets | Caddy static serving + SPA routing | Caddy foundation exists; web cutover pending |
| Worker `Env` | validated config + injected services | foundation config exists; compatibility layer pending |
| `MessageBatch` | provider-neutral job batch/claim context | pending module port |
| `ScheduledController` | provider-neutral schedule context | pending module port |
| Cloudflare observability | structured logs + metrics/health/alerts | pending |

## 11. Non-Cloudflare external dependencies

The following should be preserved but configured independently of Cloudflare:

- WhatsApp Support Hub;
- EgoSMS;
- Resend/email;
- external webhook destinations;
- camera/NVR and Printerly services.

They belong behind Ledgerly notification/integration contracts and must not block the infrastructure migration unnecessarily.

## 12. Audit conclusion

The Cloudflare fallback can remain operational during the migration because the self-hosted foundation currently uses separate files/services and Caddy exposes only `/selfhost/*`. The main portability seams are now explicitly identified: database, storage, queue, scheduler, edge/static serving, configuration injection and Cloudflare lifecycle types.

This audit is considered complete when kept in sync with material changes to `wrangler.jsonc`, `src/types.ts`, `src/index.ts`, or `modules/backend-types.ts`. Subsequent control-board work should implement the replacement layers in the order tracked by issue #6 rather than deleting the Cloudflare path early.
