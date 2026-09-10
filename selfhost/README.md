# Ledgerly self-hosted foundation

This directory contains the infrastructure foundation for moving Ledgerly from Cloudflare-specific runtime services to a self-hosted server while retaining the Cloudflare deployment as a fallback during migration.

## Current milestone

The self-hosted stack now provisions:

- PostgreSQL 17
- PgBouncer connection pooling
- Redis persistence, cache and durable job coordination
- MinIO-compatible object storage
- Caddy edge service
- a separate Node.js migration API under `server/`

The Node service still exposes only migration health/readiness/contract endpoints. Ledgerly business routes, authentication, D1 data, R2 files, Cloudflare queues, and Cloudflare cron workloads have **not** been cut over.

The core persistence adapters are now real rather than probes: PostgreSQL queries/transactions run through PgBouncer, cache operations use Redis, background jobs use Redis claim/ack/retry/dead-letter semantics, and object operations use MinIO through the storage contract. `LEDGERLY_RUNTIME_MODE=production` remains intentionally blocked until scheduler, notification, audit, authentication and migrated business routes are durable and verified.

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

`/selfhost/health` reports process liveness. `/selfhost/ready` performs real PostgreSQL, Redis queue/cache and MinIO readiness checks. `/selfhost/contracts` reports non-secret provider information and the remaining production blockers. Normal application paths still return HTTP 503 from the self-hosted edge because production cutover is intentionally disabled.

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

It also defines tenant-scoped cache/storage helpers and the common job envelope. Queue contract version 2 includes explicit `take`, `ack`, `retry`, `deadLetter`, queue-size and dead-letter-size operations so job failures are observable and retry-safe.

Domain modules should migrate toward these interfaces instead of adding new vendor-specific infrastructure calls.

## Tests

The self-hosted server has dedicated CI in `.github/workflows/selfhost-server-ci.yml`. It installs the Node runtime dependencies, runs syntax checks and unit tests, and validates the Docker Compose configuration.

Adapter tests cover:

- PostgreSQL commit and rollback behavior;
- Redis cache storage, stampede coalescing and tag invalidation;
- Redis job claiming, acknowledgement, retry and dead-letter behavior;
- MinIO-compatible put/get/head/list/delete/download-url behavior.

## Network exposure

PostgreSQL, PgBouncer, Redis, MinIO, and the Node migration API are published only on `127.0.0.1` during migration so host-side tools can reach them without exposing them directly to the LAN or internet. The internal Docker backend network is marked internal.

Caddy is the only service intended to become internet-facing. It currently proxies only `/selfhost/*` to the Node migration service and deliberately returns 503 for all other application traffic.

## Production notes

Before production cutover:

- implement persistent scheduler, notification and audit providers;
- migrate and verify authentication, organization and permission behavior;
- migrate business domains and validate data integrity;
- pin container images to tested immutable versions/digests;
- use a real domain and automatic TLS;
- move secrets to a protected secret-management path rather than a world-readable env file;
- create automatic PostgreSQL/object-storage/config backups and test restore;
- configure firewall rules and UPS-backed shutdown;
- add monitoring/alerting;
- route Ledgerly API/web traffic through Caddy only after the application runtime passes integrity and load testing.

See `docs/SELF_HOSTED_ARCHITECTURE.md` for the migration contract and sequencing.
