# Ledgerly self-hosted foundation

This directory contains the infrastructure foundation for moving Ledgerly from Cloudflare-specific runtime services to a self-hosted server while retaining the Cloudflare deployment as a fallback during migration.

## Current milestone

The self-hosted stack now provisions:

- PostgreSQL 17
- PgBouncer connection pooling
- Redis persistence, cache, durable jobs and distributed pub/sub
- MinIO-compatible object storage
- PostgreSQL-backed persistent schedules and audit history
- provider-neutral SMS, WhatsApp and email delivery through EgoSMS, WhatsApp Support Hub and Resend
- Worker-compatible JWT/password/MFA/permission behavior in the Node migration runtime
- Caddy edge service
- a separate Node.js migration API under `server/`

The Node service still exposes only migration health/readiness/contract endpoints. Ledgerly business routes, public self-hosted authentication routes, D1 data, R2 files, Cloudflare queue producers/consumers, and Cloudflare cron handlers have **not** been cut over.

The core persistence adapters are real rather than probes: PostgreSQL queries/transactions run through PgBouncer, cache operations use Redis, background jobs use Redis claim/ack/retry/dead-letter semantics, events use Redis pub/sub across API processes, object operations use MinIO, schedules are persisted and claimed from PostgreSQL with stale-lock recovery, audit records preserve queryable human/AI/system/integration provenance, notification providers are selected behind a common service contract, and auth compatibility preserves the current Worker token/password/MFA/role/scope model. `LEDGERLY_RUNTIME_MODE=production` remains intentionally blocked until authentication data, business routes and D1 data have been migrated and verified.

## First start

```bash
cp .env.selfhost.example .env.selfhost
```

Replace every `CHANGE_ME` value, then start the stack:

```bash
docker compose --env-file .env.selfhost -f compose.selfhost.yml up -d --build
```

Inspect health/status:

```bash
docker compose --env-file .env.selfhost -f compose.selfhost.yml ps
curl http://localhost:${LEDGERLY_HTTP_PORT:-8080}/healthz
curl http://localhost:${LEDGERLY_HTTP_PORT:-8080}/selfhost/health
curl http://localhost:${LEDGERLY_HTTP_PORT:-8080}/selfhost/ready
curl http://localhost:${LEDGERLY_HTTP_PORT:-8080}/selfhost/contracts
```

`/selfhost/health` reports process liveness. `/selfhost/ready` checks PostgreSQL, Redis cache/jobs/events, MinIO, scheduler, audit and required notification channels. It also reports auth migration status separately; missing auth tables do not make the foundation process unhealthy, but they keep auth cutover blocked. `/selfhost/contracts` reports non-secret provider information, scheduler-runner state, auth compatibility information and remaining production blockers. Normal application paths still return HTTP 503 from the self-hosted edge because production cutover is intentionally disabled.

Stop without deleting data:

```bash
docker compose --env-file .env.selfhost -f compose.selfhost.yml down
```

Destroying named volumes deletes self-hosted data and must not be used during normal operation.

## Runtime contracts

`server/src/contracts.mjs` defines the common self-hosted boundary for database, cache, storage, queue, scheduler, events, notifications and audit.

The scheduler never runs business logic directly. It claims due schedules, emits an idempotent Ledgerly job envelope to the durable queue, then advances the schedule. Missed periods currently use the explicit `coalesce` policy: after downtime one due occurrence is dispatched and the next run advances from current time.

Redis pub/sub is used only for distributed transient events. Durable work still belongs in the queue or PostgreSQL; important events must not depend on pub/sub delivery alone.

## Authentication compatibility

The self-hosted auth layer intentionally matches the current Worker behavior rather than creating a second login model:

- `scrypt-v1` password hashes remain valid without resets;
- legacy `pbkdf2-sha256` hashes remain verifiable and are upgraded after successful login;
- HS256 access tokens keep the same issuer/audience semantics and default 15-minute lifetime;
- refresh sessions keep the 30-day default but rotate transactionally in PostgreSQL;
- API keys remain SHA-256 hashed and organization/scopes are preserved;
- owner/admin continue to bypass explicit scope lists while other roles require assigned scopes;
- school username/phone aliases, account locks, TOTP MFA and recovery codes retain their existing behavior;
- development `X-Organization-Id` / `X-User-Id` authentication remains development-only.

The compatibility service deliberately fails closed when school security tables are missing. Public self-hosted auth routes stay disabled until the D1 -> PostgreSQL migration framework copies those tables and validation confirms their row counts/relationships.

Keep `LEDGERLY_JWT_ISSUER`, `LEDGERLY_JWT_AUDIENCE` and `LEDGERLY_JWT_SECRET` aligned with the current Worker during dual-run so already-issued access tokens behave consistently across the migration boundary.

## Notifications

The self-hosted bridge preserves the providers already used by Ledgerly:

- SMS -> EgoSMS
- WhatsApp -> WhatsApp Support Hub
- email -> Resend

`LEDGERLY_NOTIFICATION_REQUIRED_CHANNELS` controls readiness. During foundation work it may be empty. Before a production migration it should list the channels the deployment requires, for example `email,sms,whatsapp`; readiness then fails if any required provider is missing credentials.

The bridge accepts a Ledgerly delivery ID and forwards it as the provider idempotency key where supported. Campaign/audience/delivery-table migration remains a later domain step.

## Audit provenance

Durable audit events preserve organization, actor type/ID, exact AI agent ID/name/role when applicable, action, entity type/ID, before/after values, reason, request ID, metadata and occurrence timestamp.

## Tests

Self-hosted tests cover PostgreSQL transactions, Redis cache invalidation, durable queue lifecycle/idempotency, MinIO object operations, scheduler recovery/dispatch, audit provenance, distributed event publish/subscribe, SMS/WhatsApp/email provider request behavior, auth password compatibility, role/scope rules, API-key/Bearer/development principals, and transactional refresh-token rotation.

## Network exposure

PostgreSQL, PgBouncer, Redis, MinIO, and the Node migration API are published only on `127.0.0.1` during migration. Caddy remains the only service intended to become internet-facing.

## Production notes

Before production cutover:

- migrate and verify auth/users/organizations/memberships/sessions/API keys and school security tables;
- migrate business domains and validate D1 -> PostgreSQL data integrity;
- register and verify current Cloudflare cron workloads before disabling those triggers;
- migrate current Cloudflare queue producers/consumers before disabling those queues;
- require and verify all production notification channels;
- pin container images to tested immutable versions/digests;
- use a real domain and automatic TLS;
- move secrets to protected secret management;
- create automatic PostgreSQL/object-storage/config backups and test restore;
- configure firewall rules and UPS-backed shutdown;
- add monitoring/alerting;
- route Ledgerly API/web traffic through Caddy only after integrity and load testing.

See `docs/SELF_HOSTED_ARCHITECTURE.md` for the migration contract and sequencing.
