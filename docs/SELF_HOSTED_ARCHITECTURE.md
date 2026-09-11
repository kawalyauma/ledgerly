# Ledgerly Self-Hosted Architecture

Status: active migration contract

This document is the source of truth for migrating Ledgerly from its Cloudflare-centric deployment to a production-quality self-hosted runtime. Cloudflare remains operational as the fallback until each replacement workload has passed migration, integrity, security and load validation.

## 1. Current Cloudflare architecture

The current production-compatible path runs the core API as a Hono Cloudflare Worker from `src/index.ts` and still owns normal Ledgerly application traffic.

Cloudflare resources currently include:

- `FINANCE_DB` — D1 relational data.
- `REPORTS_BUCKET` — R2 report/object storage.
- `WORK_FILES_BUCKET` — R2 task/work file storage.
- `REPORT_QUEUE` — report jobs.
- `WEBHOOK_QUEUE` — webhook jobs.
- `WORK_NOTIFICATION_QUEUE` — work notifications.
- `COMMUNICATION_QUEUE` — communications jobs.
- Cloudflare cron schedules for recurring reports, documents and module work.

Existing separable services/applications include:

- `camera-server/` — camera/NVR service.
- `printerly-node/` — Printerly/Scannerly appliance agent.
- `attendance-mobile/` — Android/mobile application.
- `web/` plus the root Vite application — browser frontend.
- `modules/` — modular feature packages.

Do not delete or disable Cloudflare infrastructure simply because a self-hosted equivalent exists.

## 2. Self-hosted target

```text
Internet / LAN
      |
      v
    Caddy
      |
      +--------------------+
      |                    |
      v                    v
 Ledgerly Web        Ledgerly API workers
                           |
              +------------+------------+
              |            |            |
              v            v            v
          PgBouncer      Redis        Storage
              |        cache/jobs     MinIO/local
              v
          PostgreSQL

Separate workloads:
- Camera/NVR service -> media/recording storage
- Printerly service -> queued printer/scanner work
- AI worker -> local model runtime through controlled Ledgerly tools
```

Production internet exposure should be limited to the HTTPS edge. PostgreSQL, PgBouncer, Redis, MinIO administration, camera administration and local AI runtimes stay private.

## 3. Migration principles

1. **No big-bang cutover.** Migrate and verify one domain/workload at a time.
2. **Cloudflare remains a fallback** until the replacement is proven.
3. **Provider-neutral services.** Business modules use Ledgerly database/cache/storage/queue/scheduler/events/notifications/audit/auth contracts instead of vendor bindings.
4. **PostgreSQL is the self-hosted relational authority.** PgBouncer limits database connection pressure.
5. **Redis is not authoritative business storage.** It is used for cache, distributed coordination, transient events and durable queue structures.
6. **Storage is abstracted.** R2 and MinIO/local object storage can coexist during migration.
7. **Tenant scope is mandatory.** `organization_id` must flow through queries, cache keys, storage keys, jobs, schedules, audit and AI tools.
8. **Consequential writes are transactional.** Finance, fees, payroll, attendance, auth/session rotation and other multi-record writes must be retry-safe.
9. **Heavy work leaves HTTP request paths.** PDFs, reports, imports/exports, bulk messaging, payroll, backups and AI work use queues.
10. **Security fails closed.** Missing migration/security prerequisites must block self-hosted authority rather than silently weakening controls.
11. **Permanent provenance.** Human, AI, system and integration actors remain attributable in durable audit records.
12. **AI never gets raw database credentials.** It can act only through authenticated, permission-checked Ledgerly tools.

## 4. Foundation services

`compose.selfhost.yml` currently defines the foundation stack:

| Service | Purpose | Production public exposure |
| --- | --- | --- |
| Caddy | HTTPS/reverse proxy | yes |
| Ledgerly Node API | self-hosted application runtime | Caddy only |
| PostgreSQL | durable relational data | no |
| PgBouncer | connection pooling | no |
| Redis | cache/queue/events | no |
| MinIO | S3-compatible object storage | no |

The Node runtime service container exposes provider-neutral capabilities for:

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

Authentication is a separate compatibility service because public auth cutover depends on migrated and validated security data.

## 5. Durable runtime status

Completed self-hosted foundation capabilities include:

- PostgreSQL adapter through PgBouncer.
- Redis tenant-scoped cache with explicit invalidation support.
- durable Redis job lifecycle with ready/processing/dead-letter state.
- enqueue idempotency for jobs carrying an idempotency key.
- MinIO/S3-compatible storage adapter.
- PostgreSQL scheduler with row locking, stale-claim recovery and `coalesce` missed-run behavior.
- durable PostgreSQL audit for `human`, `ai_agent`, `system` and `integration` actors.
- Redis pub/sub for transient cross-process events.
- EgoSMS, WhatsApp Support Hub and Resend behind one notification contract.
- health/readiness reporting and guarded production mode.

Cloudflare queues and cron handlers remain authoritative until each producer/consumer/schedule is individually ported and equivalence-tested.

## 6. Auth/organization/permission compatibility

The self-hosted auth layer preserves existing Worker semantics so migration does not force user password resets or create a second identity model.

Supported compatibility includes:

- existing `scrypt-v1` password hashes;
- legacy `pbkdf2-sha256` verification plus upgrade on successful login;
- HS256 access tokens with configurable issuer/audience and the existing claims model;
- opaque refresh tokens stored as SHA-256 hashes;
- transactional refresh-session rotation;
- API-key hashing, expiry/revocation and scope behavior;
- organization membership and role/scope enforcement;
- owner/admin scope bypass compatibility;
- school username/phone aliases;
- inactive/suspended/locked checks;
- TOTP MFA and recovery codes;
- login-event logging;
- development-only organization/user header authentication.

Public self-hosted auth endpoints remain disabled until the corresponding PostgreSQL migration phase passes validation.

## 7. D1 -> PostgreSQL migration framework

The migration engine is implemented under `server/src/migration/` and uses the Cloudflare D1 HTTP API as a read source.

Core guarantees:

- original IDs are preserved;
- source reads are parameterized;
- copy batches are bounded;
- copied rows and rowid checkpoint advance in the **same PostgreSQL transaction**;
- interrupted runs resume from the last committed D1 rowid;
- table counts are validated;
- relationship/orphan checks are phase-specific;
- source-count drift is recorded as a warning;
- required source tables fail closed;
- migration state is retained under `ledgerly_meta`;
- Cloudflare credentials are available only to the one-shot migration container;
- dependent migration phases require completed prerequisite phases for the **same D1 source identity**.

See `docs/D1_POSTGRES_MIGRATION.md` for the runbook.

### Registered phase: `auth-core`

Migrates:

- organizations
- users
- memberships
- accounts
- API keys
- refresh sessions
- school user profiles/security state
- school login aliases
- MFA records
- login events

### Registered phase: `school-reference`

Prerequisite: `auth-core` completed for the same D1 source.

Migrates the shared academic reference graph:

- school profile
- branches/campuses
- academic years
- terms
- departments
- class levels
- classes
- streams
- subjects
- class-subject mappings
- lesson periods

Self-referencing department-parent and class-level promotion foreign keys are finalized after row copy, then validated. The phase also performs tenant/reference orphan checks.

## 8. PostgreSQL contract

Existing stable IDs should be preserved unless an explicit migration mapping says otherwise.

PostgreSQL schemas should use:

- foreign keys;
- unique constraints;
- database transactions;
- tenant-aware indexes;
- status/date indexes where access patterns justify them;
- explicit integrity constraints instead of application-only validation.

Common tenant-heavy access patterns should begin indexes with tenant identity, for example:

```sql
CREATE INDEX ... ON some_table (organization_id, status, created_at);
```

Financial and balance-affecting workflows require database transactions and durable idempotency. Derived summaries may improve performance but must remain reconcilable to authoritative records.

## 9. Cache contract

Cache keys are tenant-scoped and versionable, for example:

```text
ledgerly:v1:org:<organizationId>:<domain>:<resource>:<identity>
```

Writes commit to PostgreSQL first, then invalidate/update cache state. TTL is only a fallback consistency mechanism.

Good cache candidates include:

- school profile/configuration
- academic years/terms
- classes/streams/subjects
- grading scales
- fee categories
- account lists
- permission snapshots
- short-lived dashboards/counts

Never treat cache as authoritative for payment/journal/payroll/reversal/auth-sensitive writes.

## 10. Queue and scheduler contract

Jobs use the common envelope:

```text
jobId
kind
organizationId
createdAt
attempt
idempotencyKey
payload
```

Consumers must remain retry-safe even when Redis suppresses duplicate enqueue operations.

Persistent schedules live in PostgreSQL and emit durable jobs. The scheduler does not execute domain business work directly.

## 11. Storage contract

Provider-neutral storage operations include:

```text
put
get
head
delete
list
createDownloadUrl
```

Every non-public object key must encode tenant ownership. Logical areas include documents, receipts, students, staff, academics, evidence, reports, Printerly and NVR.

R2 migration to self-hosted object storage must be resumable and verified before R2 retirement.

## 12. Distributed events and notifications

Redis pub/sub is transient only. Important work must always have a durable PostgreSQL or queue representation.

Current providers behind the notification contract:

- SMS -> EgoSMS
- WhatsApp -> WhatsApp Support Hub
- email -> Resend

Provider IDs and idempotency information should remain attached to durable delivery records when communications are migrated.

## 13. Audit and AI provenance

Audit supports at least:

```text
organization_id
actor_type
actor_id
agent_id
agent_name
agent_role
action
entity_type
entity_id
before
after
reason
request_id
metadata
timestamp
```

`AI reviewed` and `officially approved` are separate states. Consequential academic, financial, payroll and student-record actions default to human approval unless a narrower autonomous policy is explicitly configured.

## 14. Parallel migration ownership

The remaining work is intentionally split across parallel branches/chats. Workers must fetch latest `main` before every substantial batch and preserve unrelated changes.

Current stream ownership:

1. **School/Academics stream** — school setup, students, guardians, staff identity, academics, attendance and Books.
2. **Finance/Runtime stream** — finance, fees, payroll, runtime cutover, storage migration, Printerly, NVR, backup, monitoring and hardening.
3. **AI Workforce stream** — local/offline agent framework, documents, RAG, approvals, agents and scheduling.
4. **Exams/Tasks stream** — standalone Exams, report-card compatibility, Tasks & Work and Work Chat.
5. **Communications/Shared stream** — Communications, shared Contacts, remaining HR, mobile-sync core and shared platform data.

This document and `main` remain the integration source of truth. Worker branches must not merge themselves unless explicitly coordinated.

## 15. Production blockers

Production authority remains intentionally blocked until all of the following are true:

1. every required D1 domain has a PostgreSQL migration phase;
2. every phase passes final stable-source validation;
3. corresponding Node API routes are implemented and compatibility-tested;
4. R2/object migrations are complete and verified;
5. queue and cron workloads are individually switched and validated;
6. finance/fees/payroll integrity tests pass under concurrency;
7. mobile/offline sync behavior passes against PostgreSQL;
8. backups have been restored successfully in a rehearsal;
9. monitoring and alerts cover critical services;
10. security and exposed-port review is complete;
11. load/concurrency testing is complete;
12. Cloudflare/self-hosted dual-run comparisons show acceptable equivalence.

## 16. Cutover sequence

The intended final sequence is:

```text
complete migration phases
-> migration rehearsal
-> stable-source final validation
-> Node route equivalence checks
-> file/object verification
-> load/integrity/security tests
-> backup restore drill
-> dual-run
-> domain-by-domain authority switch
-> production observation
-> retire only proven-replaced Cloudflare resources
```

Cloudflare may remain useful for DNS or tunneling even after application data/runtime authority moves self-hosted.

## 17. Development rule

Before every substantial editing batch:

1. fetch/read latest `main`;
2. inspect recent self-hosting commits and overlapping branches;
3. preserve unrelated work;
4. implement one coherent increment;
5. run relevant executable tests where the environment permits;
6. document unavailable CI/runtime limitations honestly;
7. commit and push;
8. continue from the newest state.

Do not claim production readiness from schema copy alone. Migration, route compatibility, business integrity and operational validation are separate gates.
