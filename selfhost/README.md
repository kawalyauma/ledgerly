# Ledgerly self-hosted foundation

This directory contains the infrastructure foundation for moving Ledgerly from Cloudflare-specific runtime services to a self-hosted server while retaining the Cloudflare deployment as a fallback during migration.

## Current milestone

The self-hosted stack now provisions:

- PostgreSQL 17
- PgBouncer connection pooling
- Redis persistence, cache and durable job coordination
- MinIO-compatible object storage
- PostgreSQL-backed persistent schedules and audit history
- Caddy edge service
- a separate Node.js migration API under `server/`

The Node service still exposes only migration health/readiness/contract endpoints. Ledgerly business routes, authentication, D1 data, R2 files, Cloudflare queue producers/consumers, and Cloudflare cron handlers have **not** been cut over.

The core persistence adapters are real rather than probes: PostgreSQL queries/transactions run through PgBouncer, cache operations use Redis, background jobs use Redis claim/ack/retry/dead-letter semantics, object operations use MinIO, schedules are persisted and claimed from PostgreSQL with stale-lock recovery, and audit records preserve queryable human/AI/system/integration provenance. `LEDGERLY_RUNTIME_MODE=production` remains intentionally blocked until distributed events, notifications, authentication and migrated business routes are verified.

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

`/selfhost/health` reports process liveness. `/selfhost/ready` performs real PostgreSQL, Redis queue/cache, MinIO, scheduler and audit readiness checks. `/selfhost/contracts` reports non-secret provider information, scheduler-runner state and remaining production blockers. Normal application paths still return HTTP 503 from the self-hosted edge because production cutover is intentionally disabled.

Stop without deleting data:

```bash
docker compose --env-file .env.selfhost -f compose.selfhost.yml down
```

Destroying named volumes deletes self-hosted data and must not be used during normal operation.

## Runtime contracts

`server/src/contracts.mjs` defines the common self-hosted boundary for:

- database
- cache
- storage
- queue
- scheduler
- events
- notifications
- audit

It also defines tenant-scoped cache/storage helpers and the common job envelope. Contract version 3 includes explicit queue claim/ack/retry/dead-letter behavior, persistent schedule registration/list/claim/dispatch/release operations, and queryable audit history.

The scheduler never runs business logic directly. It claims due schedules, emits an idempotent Ledgerly job envelope to the durable queue, then advances the schedule. Missed periods currently use the explicit `coalesce` policy: after downtime one due occurrence is dispatched and the next run advances from current time.

Domain modules should migrate toward these interfaces instead of adding new vendor-specific infrastructure calls.

## Audit provenance

Durable audit events preserve:

- organization
- `actor_type`: `human`, `ai_agent`, `system`, or `integration`
- actor ID
- AI agent ID, name and role when applicable
- action
- entity type/ID
- before/after values
- reason
- request ID
- metadata
- occurrence timestamp

This is the persistence foundation for the requirement that every future AI-created or AI-modified item remains visibly attributable to the exact agent responsible.

## Tests

The self-hosted server has dedicated CI in `.github/workflows/selfhost-server-ci.yml`. It runs on `main` and all `selfhost-*` / `selfhost/**` staging branches, installs Node runtime dependencies, runs syntax checks and unit tests, and validates the Docker Compose configuration.

Current local adapter/runtime tests cover:

- PostgreSQL commit and rollback behavior;
- Redis cache storage, stampede coalescing and tag invalidation;
- Redis job claiming, acknowledgement, retry and dead-letter behavior;
- MinIO-compatible put/get/head/list/delete/download-url behavior;
- persistent scheduler registration and stale-lock recovery;
- scheduler-to-queue dispatch idempotency and failure release;
- durable AI-agent audit provenance and filtered audit history.

## Network exposure

PostgreSQL, PgBouncer, Redis, MinIO, and the Node migration API are published only on `127.0.0.1` during migration so host-side tools can reach them without exposing them directly to the LAN or internet. The internal Docker backend network is marked internal.

Caddy is the only service intended to become internet-facing. It currently proxies only `/selfhost/*` to the Node migration service and deliberately returns 503 for all other application traffic.

## Production notes

Before production cutover:

- replace the process-local event bus with a distributed event provider;
- implement the notification provider bridge;
- migrate and verify authentication, organization and permission behavior;
- migrate business domains and validate D1 -> PostgreSQL data integrity;
- register and verify the current Cloudflare cron workloads against the persistent scheduler before disabling those triggers;
- migrate current Cloudflare queue producers/consumers before disabling those queues;
- pin container images to tested immutable versions/digests;
- use a real domain and automatic TLS;
- move secrets to a protected secret-management path rather than a world-readable env file;
- create automatic PostgreSQL/object-storage/config backups and test restore;
- configure firewall rules and UPS-backed shutdown;
- add monitoring/alerting;
- route Ledgerly API/web traffic through Caddy only after the application runtime passes integrity and load testing.

See `docs/SELF_HOSTED_ARCHITECTURE.md` for the migration contract and sequencing.
