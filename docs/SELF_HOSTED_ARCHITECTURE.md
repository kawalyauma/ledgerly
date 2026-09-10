# Ledgerly Self-Hosted Architecture

Status: active migration contract

This document is the source of truth for migrating Ledgerly from a Cloudflare-centric deployment to a self-hosted runtime without breaking the existing Cloudflare deployment during the transition.

## 1. Current architecture audit

At the start of the migration, `main` runs the core API as a Hono Cloudflare Worker from `src/index.ts`. The Worker mounts public and authenticated routes from the generated modular backend registry, and exposes Worker `fetch`, `queue`, and `scheduled` handlers.

The current Worker environment is tightly bound to Cloudflare resources through `src/types.ts`:

- `FINANCE_DB` — D1 database.
- `REPORTS_BUCKET` — R2 report/object storage.
- `WORK_FILES_BUCKET` — R2 task/work file storage.
- `REPORT_QUEUE` — report jobs.
- `WEBHOOK_QUEUE` — webhook jobs.
- `WORK_NOTIFICATION_QUEUE` — work notifications.
- `COMMUNICATION_QUEUE` — communications.
- Cloudflare scheduled handlers currently drive recurring reports, recurring finance documents, and module schedules.

`wrangler.jsonc` currently configures one D1 database, two R2 buckets, four producer/consumer queue bindings, four cron schedules, static assets, and Worker observability.

The repository already contains separable Node services that fit the self-hosted target well:

- `camera-server/` — Ledgerly camera/NVR service.
- `printerly-node/` — Printerly/Scannerly appliance agent.
- `attendance-mobile/` — Android/mobile device application.
- `web/` and root Vite application — browser frontend.
- `modules/` — modular backend/frontend feature packages.

The existing Cloudflare runtime remains supported until the self-hosted replacement passes migration, integrity, and load tests.

## 2. Target architecture

```text
Internet / LAN
      |
      v
 Caddy edge
      |
      +-------------------+
      |                   |
      v                   v
 Ledgerly Web        Ledgerly API workers
                          |
              +-----------+-----------+
              |           |           |
              v           v           v
          PgBouncer     Redis       Object storage
              |       cache/jobs       |
              v                       MinIO/local
          PostgreSQL

Separate workloads:
- Camera/NVR service -> recording storage / WebRTC / playback
- Printerly service -> queued printer/scanner jobs
- AI runtime -> local model + controlled Ledgerly tools
```

## 3. Migration principles

1. **No big-bang cutover.** Cloudflare stays operational while equivalent self-hosted services are introduced and verified.
2. **Domain modules do not depend directly on infrastructure vendors.** New code must use Ledgerly database, cache, storage, queue, scheduler, event, notification, and audit interfaces.
3. **PostgreSQL becomes the authoritative self-hosted relational store.** PgBouncer protects it from excessive client connections.
4. **Redis is shared infrastructure, not a source of truth.** Durable records remain in PostgreSQL/object storage. Queue implementations must be durable and must not rely on evictable cache entries.
5. **Object storage is accessed through a Ledgerly storage interface.** R2 and MinIO/local storage remain interchangeable during migration.
6. **Every tenant-scoped operation carries `organization_id`.** Cache keys, jobs, storage paths, queries, audit records, and agent work must preserve tenant boundaries.
7. **Consequential writes are transactional and idempotent where applicable.** Finance, fees, payroll, inventory, attendance, and AI actions must remain safe under retries/concurrency.
8. **Heavy work leaves the request path.** PDFs, imports/exports, bulk communications, reports, backups, media processing, payroll batches, and AI work use background jobs.
9. **AI never receives raw database credentials.** Agents operate only through permission-checked Ledgerly tools.
10. **Human/AI/system provenance is permanent.** AI-created or AI-modified data must retain the responsible agent identity even after later human edits.

## 4. Runtime service contract

The self-hosted platform will expose the following internal services. Ports are defaults and may be changed by environment configuration.

| Service | Internal port | Public exposure |
| --- | ---: | --- |
| Caddy | 80/443 | yes |
| Ledgerly API | 8788 | no; Caddy only |
| PostgreSQL | 5432 | no; loopback during migration only |
| PgBouncer | 6432 | no; loopback during migration only |
| Redis | 6379 | no |
| MinIO S3 API | 9000 | no |
| MinIO console | 9001 | no; admin LAN/loopback only |
| Camera/NVR | module-defined | no direct internet exposure unless explicitly proxied |
| Local AI runtime | module-defined | no |

Only HTTPS should be internet-facing in production. PostgreSQL, PgBouncer, Redis, MinIO administration, NVR administration, and AI runtime stay private.

The Node runtime must provide a common service container with these provider-neutral ports:

```text
database
cache
storage
queue
scheduler
events
notifications
audit
```

Foundation adapters may exist for development and migration diagnostics, but the runtime must refuse production mode while any critical persistence, queue, scheduler, notification, or audit port is non-durable.

## 5. Database contract

PostgreSQL migration work must preserve existing IDs unless a migration explicitly maps them. New schemas must use foreign keys, unique constraints, transactions, and indexes appropriate to access patterns.

High-volume tenant tables should normally index combinations beginning with tenant identity, for example:

```sql
CREATE INDEX ... ON some_table (organization_id, status, created_at);
```

Audit-capable entities should converge on actor metadata equivalent to:

```text
created_by_type: human | ai_agent | system | integration
created_by_id
updated_by_type
updated_by_id
```

Financial and balance-affecting workflows must use database transactions and preserve idempotency keys. Derived balance/summary tables may be used for speed, but the authoritative ledger/event records remain reconcilable.

## 6. Cache contract

Cache keys must be tenant-scoped and versionable:

```text
ledgerly:v1:org:<organizationId>:<domain>:<resource>:<identity>
```

Do not cache authorization-sensitive data without tenant/user scope. Writes commit to PostgreSQL first, then invalidate or refresh affected cache keys/tags. TTL is a fallback, not the primary consistency mechanism.

Candidate cached data includes school configuration, academic years, terms, classes, streams, subjects, grading scales, fee categories, account lists, permission snapshots, and short-lived dashboard summaries.

## 7. Job contract

Background jobs use a common envelope so Cloudflare Queues and the self-hosted queue adapter can coexist during migration:

```text
jobId
kind
organizationId
createdAt
attempt
idempotencyKey (when required)
payload
```

Queue contract version 2 requires explicit claim/acknowledgement, retry, dead-letter and queue-depth behavior. Consumers must be retry-safe. Permanent failures move to a dead-letter path and remain inspectable from administration tooling.

## 8. Storage contract

Application code should converge on a provider-neutral interface similar to:

```text
put(key, bytes, metadata)
get(key)
head(key)
delete(key)
list(prefix)
createDownloadUrl(key, options)
```

Logical prefixes should include documents, receipts, students, staff, academics, evidence, reports, printerly, and NVR. Tenant identity must be present in every non-public storage key.

## 9. Audit and AI provenance contract

Audit events must support at least:

```text
actor_type
actor_id
action
entity_type
entity_id
before
after
reason
timestamp
request_id
```

AI actions additionally preserve `agent_id`, `agent_name`, `agent_role`, task/reason, and approval state. The UI must visibly label AI-generated or AI-modified content with the responsible agent name.

`AI reviewed` and `officially approved` are distinct states. Important academic, financial, payroll, and student-record actions default to human approval unless an administrator explicitly grants a narrower autonomous policy.

## 10. Initial AI Workforce roles

Predefined, editable roles:

- Secretary — editable letters/notices/minutes/memos first, PDF rendering after review/approval.
- Academic Assistant — creates/fills lesson-plan and academic drafts from Ledgerly context and uploaded knowledge.
- Academic Reviewer — reviews curriculum alignment, competence/objective quality, sequence, activities, assessment, resources, and completeness.
- Finance Assistant.
- HR Assistant.
- Reception Assistant.
- Inventory Assistant.
- Support Assistant.

Administrators may rename, reconfigure, disable, or create agents. Agents never bypass Ledgerly permissions.

## 11. Self-hosting milestones

1. Architecture audit and infrastructure foundation.
2. PostgreSQL/PgBouncer, Redis, storage, queue, scheduler and Node API adapters.
3. Auth/organization/permission runtime compatibility.
4. D1 -> PostgreSQL migration framework and validation.
5. Core school data -> academics/students/staff -> attendance -> finance/fees/accounting/payroll -> remaining modules.
6. Cache/invalidation, background jobs, backups, monitoring and security hardening.
7. Printerly and NVR integration.
8. AI Workforce framework, document engine, Secretary, Academic Assistant, local knowledge/RAG, Academic Reviewer, then additional agents.
9. Concurrency/load/integrity testing, migration rehearsal, dual-run, production cutover.

## 12. Development rule

Other developers may commit concurrently. Before every editing batch, read the latest `main`, review recent commits affecting the same paths, avoid overwriting unrelated work, make one coherent change, validate it, commit it, and continue from the new latest state.

Do not remove Cloudflare bindings or migrations merely because a self-hosted equivalent exists. Removal occurs only after the replacement is verified and production cutover is complete.

## 13. Migration progress

### Completed: infrastructure foundation

The repository contains `compose.selfhost.yml`, PostgreSQL/PgBouncer, Redis, MinIO, Caddy, bootstrap SQL, protected environment examples, and the migration contract. Existing Worker/D1/R2/queue/cron configuration remains unchanged.

### Completed: Node runtime shell and service contracts

`server/` provides a separate Node 20 runtime with `/selfhost/health`, `/selfhost/ready`, `/selfhost/contracts`, tenant-scoped cache/storage helpers, provider-neutral service contracts, a versioned job envelope, graceful shutdown, conservative request/header timeouts and an explicit production-mode guard.

Caddy proxies only `/selfhost/*` to this service. All normal application paths remain blocked on the self-hosted edge, so Cloudflare is still the authoritative application runtime.

### Completed: durable core data/cache/job/object adapters

The Node migration runtime now uses:

- PostgreSQL through PgBouncer with parameterized queries, health checks and explicit transaction commit/rollback behavior;
- Redis for shared cache data with TTLs, tag invalidation and in-process request coalescing to reduce cache stampedes;
- Redis-backed durable job lists with ready/processing/dead-letter state, explicit claim receipts, acknowledgement, retry attempt tracking and dead-letter routing;
- MinIO/S3-compatible object storage behind the provider-neutral storage contract, including bucket initialization, object metadata, listing and presigned download URLs;
- validated environment/Compose wiring for database, Redis, queue and object-storage credentials/settings;
- dedicated self-hosted CI plus adapter unit tests.

The original local-filesystem and in-memory adapters remain useful for tests/development but are no longer the runtime providers for the durable core.

### Current production blockers

Production mode intentionally remains blocked until the following are implemented and verified:

1. persistent scheduler and missed-run/restart recovery;
2. durable audit persistence and queryability;
3. real notification provider bridge;
4. auth/organization/permission compatibility;
5. migrated business routes and D1 -> PostgreSQL data validation.

### Next

Implement persistent scheduler + audit storage, then notification bridging and auth/organization/permission compatibility. Cloudflare remains the fallback throughout.
