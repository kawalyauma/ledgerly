# Ledgerly finance/runtime self-hosting operations

Cloudflare remains the fallback authority until each capability is explicitly moved from `cloudflare` to `shadow` and finally `node` after migration and integrity validation. Never infer cutover from the existence of PostgreSQL data.

## Network and security boundaries

Only Caddy should be Internet-facing. PostgreSQL, PgBouncer, Redis, MinIO administration, backup jobs and NVR control endpoints remain private. The NVR overlay binds RTSP/HLS/WHEP HTTP to loopback; only the WebRTC UDP media port may require LAN/VPN reachability. Never proxy continuous camera bytes through the Ledgerly Node API.

Use host firewall rules to permit 80/443 to Caddy and explicitly approved WebRTC/VPN traffic only. Secrets stay in the deployment environment/secret store, never committed. Run backup files with mode 0600-equivalent permissions and encrypt off-site copies with restic/rclone crypt or an equivalent audited mechanism.

## NVR

Start the base stack plus MediaMTX with:

```bash
docker compose --env-file .env.selfhost -f compose.selfhost.yml -f compose.finance-runtime.yml up -d
```

Phones publish once to the NVR. MediaMTX records locally and fans out WHEP/WebRTC viewers. The Ledgerly API owns tenant/site/camera authorization, pairing, metadata and audit only.

## Backups

Create a PostgreSQL backup:

```bash
docker compose --env-file .env.selfhost -f compose.selfhost.yml -f compose.finance-runtime.yml --profile backup run --rm backup
```

Each dump receives a SHA-256 sidecar. Copy PostgreSQL dumps, object-storage snapshots and deployment config to an encrypted secondary/off-site target. Recommended retention: 7 daily, 5 weekly and 12 monthly restore points; adjust to policy and storage capacity.

Restore is deliberately manual and destructive. Restore into a disposable verification database first, run schema/domain integrity tests, then perform production recovery during an approved outage. Set `LEDGERLY_RESTORE_CONFIRM=RESTORE` only for the intended target.

## Operational health

Monitor API health/readiness, PostgreSQL/PgBouncer saturation, Redis latency and ready/processing/dead queues, MinIO capacity, scheduler lag, notification provider failures, Printerly node heartbeat/job age, NVR disk/stream health and backup freshness. Alert on disk pressure before NVR retention or database WAL can exhaust the host.

## Performance guardrails

HTTP concurrency is not PostgreSQL connection count. Keep Node database pools bounded and below PgBouncer/server capacity across all processes. Scale API workers horizontally behind Caddy while keeping per-process pools small. Bound payroll/report/export workers separately from request workers; expensive reports and bulk work must use queues.

Use `pg_stat_statements`, `EXPLAIN (ANALYZE, BUFFERS)` in staging, slow-query logging and the tenant/date/status indexes introduced by the migration phases before raising connection limits.

## Security-update policy

Patch the host OS and container images on a scheduled cadence, with expedited updates for remotely exploitable vulnerabilities. Pin critical service major versions, rehearse upgrades against backups, and retain a rollback image/tag. Rotate application, database, Redis, MinIO, notification and pairing credentials after suspected exposure.
