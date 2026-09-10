# Ledgerly self-hosted foundation

This directory contains the infrastructure foundation for moving Ledgerly from Cloudflare-specific runtime services to a self-hosted server while retaining the Cloudflare deployment as a fallback during migration.

## Current milestone

The self-hosted stack now provisions:

- PostgreSQL 17
- PgBouncer connection pooling
- Redis persistence/cache/job coordination
- MinIO-compatible object storage
- Caddy edge service
- a separate Node.js foundation API under `server/`

The Node service currently exposes only migration health/readiness/contract endpoints. Ledgerly business routes, authentication, D1 data, R2 files, Cloudflare queues, and Cloudflare cron workloads have **not** been cut over.

Foundation mode intentionally uses non-durable in-memory cache/queue adapters and blocks `LEDGERLY_RUNTIME_MODE=production`. That guard remains until PostgreSQL, Redis, object-storage, scheduler, notification, and audit adapters are durable and verified.

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

`/selfhost/health` reports whether the Node process is alive. `/selfhost/ready` additionally probes PgBouncer/PostgreSQL reachability, Redis reachability, MinIO reachability, and local writable storage. Normal application paths still return HTTP 503 from Caddy because production cutover is intentionally disabled.

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

It also defines tenant-scoped cache/storage helpers and the common job envelope. Domain modules should migrate toward these interfaces instead of adding new vendor-specific infrastructure calls.

## Network exposure

PostgreSQL, PgBouncer, Redis, MinIO, and the Node foundation API are published only on `127.0.0.1` during migration so host-side tools can reach them without exposing them directly to the LAN or internet. The internal Docker backend network is marked internal.

Caddy is the only service intended to become internet-facing. It currently proxies only `/selfhost/*` to the Node foundation service and deliberately returns 503 for all other application traffic.

## Production notes

Before production cutover:

- replace foundation database/cache/queue/storage coordination with durable production adapters;
- pin all container images to tested immutable versions/digests;
- use a real domain and automatic TLS;
- move secrets to a protected secret-management path rather than a world-readable env file;
- create automatic PostgreSQL/object-storage/config backups and test restore;
- configure firewall rules and UPS-backed shutdown;
- add monitoring/alerting;
- route Ledgerly API/web traffic through Caddy only after the application runtime passes integrity and load testing.

See `docs/SELF_HOSTED_ARCHITECTURE.md` for the migration contract and sequencing.
