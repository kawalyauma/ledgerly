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
2. **Domain modules do not depend directly on infrastructure vendors.** New code must use Ledgerly database, cache, storage, queue, scheduler, event, notification, audit and auth compatibility interfaces.
3. **PostgreSQL becomes the authoritative self-hosted relational store.** PgBouncer protects it from excessive client connections.
4. **Redis is shared infrastructure, not a source of truth.** Durable records remain in PostgreSQL/object storage. Queue implementations must be durable and must not rely on evictable cache entries.
5. **Object storage is accessed through a Ledgerly storage interface.** R2 and MinIO/local storage remain interchangeable during migration.
6. **Every tenant-scoped operation carries `organization_id`.** Cache keys, jobs, storage paths, queries, audit records, schedules, auth principals and agent work must preserve tenant boundaries.
7. **Consequential writes are transactional and idempotent where applicable.** Finance, fees, payroll, inventory, attendance, scheduled work, authentication/session rotation and AI actions must remain safe under retries/concurrency.
8. **Heavy work leaves the request path.** PDFs, imports/exports, bulk communications, reports, backups, media processing, payroll batches, and AI work use background jobs.
9. **AI never receives raw database credentials.** Agents operate only through permission-checked Ledgerly tools.
10. **Human/AI/system provenance is permanent.** AI-created or AI-modified data must retain the responsible agent identity even after later human edits.
11. **Security must fail closed during migration.** Self-hosted auth routes remain disabled until required auth/security tables exist and validation passes.

## 4. Runtime service contract

The self-hosted platform exposes or will expose the following internal services. Ports are defaults and may be changed by environment configuration.

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

The Node runtime provides a common service container with these provider-neutral ports:

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

Authentication compatibility is exposed separately because it depends on migrated domain tables and must remain disabled as a public route until those tables are validated.

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

## 7. Job and schedule contract

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

Queue contract version 3 requires explicit claim/acknowledgement, retry, dead-letter and queue-depth behavior. Jobs carrying an `idempotencyKey` are atomically de-duplicated at enqueue time in Redis for a bounded retention window. Consumers must still be retry-safe because end-to-end business idempotency remains mandatory.

Persistent schedules live in PostgreSQL and are claimed with row locking plus stale-lock recovery. The scheduler never executes domain work directly: it emits a normal durable job envelope containing schedule identity and the scheduled occurrence time. The current missed-run policy is explicitly `coalesce`: after downtime one due occurrence is emitted, then the next run advances from current time.

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

## 9. Distributed events and notifications

Redis pub/sub is used for transient cross-process event delivery only. Important durable work must go through PostgreSQL or the durable Redis queue and must not depend on pub/sub delivery alone.

The notification bridge preserves the current providers behind one self-hosted contract:

- SMS -> EgoSMS
- WhatsApp -> WhatsApp Support Hub
- email -> Resend

Deployment readiness can require selected channels through `LEDGERLY_NOTIFICATION_REQUIRED_CHANNELS`. Provider credentials remain outside business modules.

## 10. Auth, organization and permission compatibility

The self-hosted auth compatibility layer matches the existing Worker security model so migrated users do not require a second identity system or password reset.

### Passwords

- Current `scrypt-v1` hashes use the same N/r/p/key/salt parameters as the Worker and remain directly verifiable.
- Legacy `pbkdf2-sha256` hashes remain verifiable for migration compatibility.
- A successful legacy login upgrades the stored hash to the current scrypt format.

### Access tokens

- HS256 is preserved.
- `sub` remains the user ID.
- `org`, `role`, `scopes`, and optional `mobileDeviceId` claims are preserved.
- issuer and audience remain configurable and should match the Worker during dual-run.
- default access-token lifetime remains 900 seconds.

### Refresh sessions

- refresh tokens remain random opaque values stored only as SHA-256 hashes;
- default session lifetime remains 30 days;
- rotation is improved on self-hosted PostgreSQL by locking and revoking the old session and creating the replacement session inside one transaction.

### API keys

- API keys remain SHA-256 hashed;
- revoked/expired keys are rejected;
- integration principals retain organization and scope lists;
- `last_used_at` is updated when a key authenticates.

### Permissions

- owner and admin roles continue to bypass explicit scope lists;
- other roles/integrations require explicit scopes;
- the existing scope names are preserved so module authorization behavior does not change during migration.

### School authentication security

The compatibility layer preserves:

- username/phone login aliases scoped to organization;
- suspended/inactive/locked school account checks;
- TOTP MFA using the existing encrypted-secret format;
- recovery-code hashing/consumption;
- successful/failed login event logging;
- development-only `X-Organization-Id` / `X-User-Id` bypass behavior.

The compatibility service deliberately fails closed when required school security tables are absent. Public Node login/register/refresh/logout routes must not be enabled until auth-table migration and validation are complete.

## 11. Audit and AI provenance contract

Audit events persist in PostgreSQL and support at least:

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

`actor_type` is one of `human`, `ai_agent`, `system`, or `integration`. AI actions preserve the exact `agent_id`, `agent_name`, `agent_role`, task/reason context, and before/after data so provenance remains queryable even after later human edits.

`AI reviewed` and `officially approved` are distinct states. Important academic, financial, payroll, and student-record actions default to human approval unless an administrator explicitly grants a narrower autonomous policy.

## 12. Initial AI Workforce roles

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

## 13. Self-hosting milestones

1. Architecture audit and infrastructure foundation.
2. PostgreSQL/PgBouncer, Redis, storage, queue, scheduler and Node API adapters.
3. Auth/organization/permission runtime compatibility.
4. D1 -> PostgreSQL migration framework and validation.
5. Core school data -> academics/students/staff -> attendance -> finance/fees/accounting/payroll -> remaining modules.
6. Cache/invalidation, background jobs, backups, monitoring and security hardening.
7. Printerly and NVR integration.
8. AI Workforce framework, document engine, Secretary, Academic Assistant, local knowledge/RAG, Academic Reviewer, then additional agents.
9. Concurrency/load/integrity testing, migration rehearsal, dual-run, production cutover.

## 14. Development rule

Other developers may commit concurrently. Before every editing batch, read the latest `main`, review recent commits affecting the same paths, avoid overwriting unrelated work, make one coherent change, validate it, commit it, and continue from the new latest state.

Do not remove Cloudflare bindings or migrations merely because a self-hosted equivalent exists. Removal occurs only after the replacement is verified and production cutover is complete.

## 15. Migration progress

### Completed: infrastructure foundation

The repository contains `compose.selfhost.yml`, PostgreSQL/PgBouncer, Redis, MinIO, Caddy, bootstrap SQL, protected environment examples, and the migration contract. Existing Worker/D1/R2/queue/cron configuration remains unchanged.

### Completed: Node runtime shell and service contracts

`server/` provides a separate Node 20 runtime with `/selfhost/health`, `/selfhost/ready`, `/selfhost/contracts`, tenant-scoped cache/storage helpers, provider-neutral service contracts, a versioned job envelope, graceful shutdown, conservative request/header timeouts and an explicit production-mode guard.

Caddy proxies only `/selfhost/*` to this service. All normal application paths remain blocked on the self-hosted edge, so Cloudflare is still the authoritative application runtime.

### Completed: durable core data/cache/job/object adapters

The Node migration runtime uses PostgreSQL through PgBouncer, Redis cache, Redis durable jobs with ready/processing/dead-letter state, and MinIO/S3-compatible object storage. Queue enqueue atomically suppresses duplicate jobs carrying the same idempotency key. Dedicated self-hosted tests cover transactions, cache invalidation, queue lifecycle/idempotency and object operations.

### Completed: persistent scheduler and durable audit foundation

The runtime provides PostgreSQL-backed schedules, stale-lock recovery, queue-backed dispatch, occurrence idempotency, durable human/system/integration/AI audit records and filtered audit history. Current Cloudflare cron schedules and queue handlers remain authoritative until each workload is ported and equivalence-tested.

### Completed: distributed events and notification bridge

The runtime uses Redis pub/sub for cross-process transient events and provides EgoSMS, WhatsApp Support Hub and Resend behind the notification service contract. Provider readiness can be required per deployment.

### Completed: auth/organization/permission runtime compatibility

The Node migration runtime now includes:

- Worker-compatible scrypt and legacy PBKDF2 password verification;
- HS256 access-token signing/verification with the existing claim model;
- API-key authentication;
- development-header authentication;
- owner/admin scope bypass and explicit staff/integration scope enforcement;
- organization membership lookup;
- registration semantics and default-account creation matching the Worker;
- transactional PostgreSQL refresh-session rotation;
- logout/revocation behavior;
- school alias login, lock-state checks, TOTP MFA and recovery-code compatibility;
- auth schema-health reporting so missing/migrated tables are visible without prematurely enabling public routes.

Auth compatibility code is ready, but PostgreSQL does not become authoritative for authentication until the next migration phase copies and validates the corresponding D1 tables.

### Current production blockers

Production mode intentionally remains blocked until the following are implemented and verified:

1. D1 -> PostgreSQL migration framework and validation;
2. auth/users/organizations/memberships/sessions/API-key/school-security data migration;
3. migrated business routes and domain data validation;
4. workload-by-workload queue/cron cutover;
5. backup/monitoring/security/load/integrity validation before final cutover.

### Next

Build the D1 -> PostgreSQL migration framework with schema/application bookkeeping, resumable table copies, row-count and relationship validation, then migrate the auth/core organization tables first. Cloudflare remains the fallback throughout.
