# Ledgerly Self-Hosted Operations Runbook

This runbook is the production operations source for the self-hosted Ledgerly runtime. It complements `docs/SELFHOST_FINANCE_RUNTIME_OPERATIONS.md`; it does not redefine application/domain migration ownership.

## 1. Production topology and trust boundaries

Public traffic terminates at Caddy. PostgreSQL, PgBouncer, Redis, the MinIO API/console, the Node API, MediaMTX/NVR endpoints, and the operations administration listener must remain loopback-only or Docker-internal. Never publish database/cache/object-storage administration ports to a LAN or the Internet.

The `ledgerly_backend` Docker network is internal. Caddy is the only general public ingress. `/selfhost/ready`, `/selfhost/contracts`, and `/selfhost/ops*` are private operations surfaces and are denied at the public Caddy route. Use SSH port forwarding for loopback administration when administering remotely.

Recommended host firewall policy: deny unsolicited inbound traffic by default; permit SSH only from the management network/VPN and permit the configured HTTP/HTTPS ports required by Caddy. Do not add firewall rules for 5432, 6432, 6379, 9000, 9001, 8788, or NVR loopback ports.

## 2. Install / first production setup

1. Install Docker Engine with Compose v2, `curl`, `bash`, `python3`, PostgreSQL client utilities, `restic`, and systemd tooling on the server.
2. Clone Ledgerly and check out the integration-approved self-hosted branch.
3. Copy `.env.selfhost.example` to `/etc/ledgerly/ledgerly.env`; set mode `0600` and ownership `root:root`.
4. Replace every example secret. Use independent random values for PostgreSQL owner, PostgreSQL application role, Redis, MinIO root, MinIO application user, JWT, and Restic. Never commit populated environment files.
5. Set a production Caddy site address and immutable tested image digests (`@sha256:`) for every image/base image, including the MinIO client bootstrap image.
6. Set `LEDGERLY_ENVIRONMENT=production`. Keep Cloudflare authority for capabilities whose self-hosted cutover gate has not passed.
7. Render the stack before first start: `docker compose --env-file /etc/ledgerly/ledgerly.env -f compose.selfhost.yml -f compose.finance-runtime.yml config -q`.
8. Start PostgreSQL/Redis/MinIO/PgBouncer first, then provision the PostgreSQL application role with `selfhost/postgres/provision-app-role.sh`. The API must not use the PostgreSQL owner in production.
9. The one-shot `minio-bootstrap` service creates the configured bucket and a bucket-scoped application policy/user. Root MinIO credentials are retained only for administration/backups. Production validation rejects API/root credential reuse.
10. Install systemd units from `selfhost/systemd/` and enable the backup, restore-test, and health timers.
11. Run `selfhost/ops/validate-production.sh`. Do not enable Node authority for a capability until its integration/cutover validation passes.

## 3. Startup

From the repository root:

```bash
sudo docker compose --env-file /etc/ledgerly/ledgerly.env \
  -f compose.selfhost.yml -f compose.finance-runtime.yml up -d
sudo selfhost/ops/health-check.sh
```

Verify Caddy TLS, Node readiness, PostgreSQL, PgBouncer, Redis, MinIO, scheduler/queue workers, notification adapters, Printerly, NVR, disks, and backup freshness. A running container is not equivalent to a healthy service.

## 4. Shutdown

Prefer graceful Compose shutdown:

```bash
sudo docker compose --env-file /etc/ledgerly/ledgerly.env \
  -f compose.selfhost.yml -f compose.finance-runtime.yml stop
```

The Node process handles SIGTERM/SIGINT and drains the HTTP server before closing runtime dependencies. PostgreSQL has a longer stop grace period. Do not use `docker kill` except during an unrecoverable incident.

## 5. Upgrade

1. Confirm the new commit/branch and review migration/runtime changes.
2. Produce and verify a fresh backup: `sudo selfhost/backups/backup-all.sh` followed by `sudo selfhost/backups/verify-backup.sh <backup-set>`.
3. Confirm the most recent scheduled scratch restore proof is fresh. For high-risk upgrades, run `sudo selfhost/backups/test-restore.sh <backup-set>` on the rehearsal host.
4. Pin all changed container images/base images to tested immutable digests.
5. Render Compose and run `sudo selfhost/ops/validate-production.sh` before deployment.
6. Pull/build images, apply approved migrations, and deploy with Compose.
7. Run health/readiness, smoke tests, and cutover gates. Keep Cloudflare fallback for unproven capabilities.
8. Record the deployed Git SHA, image digests, migration phase, and backup set used as the rollback anchor.

Never combine an application upgrade with secret rotation unless the incident requires it; separating changes makes rollback safer.

## 6. Rollback

For a code-only defect, restore the previous Git commit and previous image digests, then redeploy. Do not blindly roll database schema backward.

If a schema/data rollback is required, stop writes, preserve an incident backup, and restore the verified pre-upgrade database/object backup into a scratch environment first. Only after validation should a destructive production restore be considered. Cloudflare remains the fallback authority where the capability was not fully cut over.

## 7. Backup operations

`selfhost/backups/backup-all.sh` creates one atomic backup set. A set is successful only after component validation completes and the top-level manifest/freshness marker is published.

The backup set covers:

- PostgreSQL custom-format dump plus relation inventory and restore-TOC validation.
- MinIO/object storage mirror plus per-object SHA-256 checksums and metadata.
- Allowlisted Ledgerly runtime/operations configuration.
- NVR configuration/catalog metadata where applicable. Bulk CCTV archive media follows the NVR retention/storage design rather than generic Ledgerly backup.
- Critical Compose/Caddy/systemd/PostgreSQL bootstrap configuration.

Plaintext runtime secrets are excluded from configuration archives. Restic repository credentials/password files live outside the backed-up tree with root-only permissions.

Scheduled backups use `ledgerly-backup.timer`. Monitor `BACKUP_FRESHNESS_SECONDS`; absence/staleness of the verified success marker is a health failure.

## 8. Encrypted off-site backup

Configure a remote Restic repository in `/etc/ledgerly/backup.env`. Store the Restic password in a separate root-owned `0400`/`0600` file. `backup-all.sh` sends only an already locally verified backup set to Restic and runs repository checks according to configuration before publishing success.

Use retention in both layers: local backup-set retention for fast restores and Restic snapshot retention for off-site recovery. Periodically test recovery from the off-site copy, not just local disk.

## 9. Restore procedure

Never restore directly over production as the first test.

1. Identify a backup set and run `selfhost/backups/verify-backup.sh <set>`.
2. Run `selfhost/backups/test-restore.sh <set>` to a scratch database/object target. The script validates that the data can actually be restored, not only that checksums match.
3. Review the backup manifest, timestamps, source database, object counts/checksums, and restore-test result.
4. For configuration, use the restore tooling to extract into a locked staging directory. Review the staged files manually; configuration restore intentionally does not overwrite live files.
5. For a production database/object restore, stop application writers first and use the explicit target-specific destructive confirmation required by the restore script.
6. After restore, run database integrity/application smoke checks, object reads, queue/scheduler checks, Printerly/NVR checks, and `selfhost/ops/health-check.sh` before admitting traffic.

## 10. Safe recurring restore proof

`ledgerly-restore-test.timer` runs a disposable restore rehearsal. When `RESTORE_TEST_REQUIRED=true`, health monitoring requires a fresh proof under `RESTORE_TEST_FRESHNESS_SECONDS`. A successful dump command without a verified restore proof is not sufficient evidence of recoverability.

Never point scratch restore variables at the production database or production MinIO bucket.

## 11. Disaster recovery

For complete host loss:

1. Provision a clean trusted host and install the pinned runtime prerequisites.
2. Recover the approved Ledgerly Git SHA and production Compose/Caddy/systemd configuration from source control/verified configuration backup.
3. Recreate `/etc/ledgerly/ledgerly.env` and Restic credentials from the organization secret manager/offline escrow; do not expect plaintext secrets inside backups.
4. Recover the latest verified off-site backup set and run checksum/manifest verification.
5. Restore PostgreSQL and object storage into isolated targets, validate, then attach the application.
6. Restore/review NVR catalog/config; recover retained video according to the separate NVR/NAS/archive plan.
7. Reprovision least-privilege PostgreSQL and MinIO application credentials if necessary.
8. Start private dependencies, then API/workers/NVR, then Caddy.
9. Run production validation and smoke checks before DNS/traffic cutover.
10. Record achieved RPO/RTO and any missing data; rotate credentials if the failed host may have been compromised.

## 12. Secret rotation

Rotate one class of secret at a time. Generate a new value in the secret manager, update `/etc/ledgerly/ledgerly.env` with mode `0600`, update the corresponding service/account, restart only dependent services, and verify health before retiring the old secret.

For PostgreSQL application credentials, set the new password and rerun `selfhost/postgres/provision-app-role.sh`, then restart PgBouncer/API. Do not give the API the owner password.

For MinIO, change `MINIO_APP_SECRET_KEY`; rerun/recreate `minio-bootstrap`, then restart API. MinIO root rotation is separate and should not affect the application user.

For JWT secret rotation, existing tokens signed with the previous secret become invalid unless a dual-key transition mechanism is explicitly implemented. Plan user reauthentication.

Rotate Restic credentials/password only with a tested repository-access procedure; losing the Restic password makes encrypted off-site backups unusable.

## 13. Monitoring and private administration

The root-only collector gathers service state and writes a redacted snapshot. The administration viewer runs unprivileged, has no Docker socket, and is bound only to loopback. Sections cover Overview, Services, Database, Cache, Queues, Storage, Backups, Logs, NVR, and Updates; adapter state is displayed separately.

For remote access, tunnel the loopback admin port rather than publishing it, for example:

```bash
ssh -L 8790:127.0.0.1:8790 ledgerly-server
```

Never expose the Docker socket through a web process. Never surface raw environment variables or secrets in health JSON/log dashboards.

## 14. PostgreSQL troubleshooting and performance

Use `selfhost/ops/performance-audit.sh` and `selfhost/postgres/ops-diagnostics.sql`. Review connection pressure, blockers, long-running queries, dead tuples, sequential-scan-heavy tables, and statement timing when `pg_stat_statements` is installed. Diagnostics skip statement timing cleanly when the extension is absent.

Do not add/drop indexes solely because a generic counter is high. Capture the actual slow query with representative tenant predicates and use `EXPLAIN (ANALYZE, BUFFERS)` on staging/replica before changing an index. Never run `EXPLAIN ANALYZE` for a destructive statement on production.

HTTP request concurrency is not PostgreSQL connection count. The Node pool is bounded and production validation rejects `LEDGERLY_DATABASE_POOL_MAX > 50`. PgBouncer limits backend connections independently. Size total backend connections for all API/worker instances plus maintenance headroom; scaling HTTP workers must not multiply DB pools without recalculating the budget.

If the database is saturated: pause nonessential exports/jobs, identify blockers/long transactions, verify PgBouncer saturation, and scale only after query/index problems are understood.

## 15. Redis troubleshooting

Check container health and authenticate with `redis-cli`. Review memory, persistence errors, blocked clients, reconnect logs, and queue backlog. Do not disable authentication or expose Redis to solve connectivity issues.

After Redis restart/failover, `/selfhost/ready` must recover and queue/scheduler workers must reconnect. Use the staging-only restart rehearsal rather than testing failure injection on a busy production host.

## 16. Queue backlog

Determine whether backlog is caused by provider latency, Redis failure, worker crash, poison jobs, or insufficient bounded concurrency. Inspect retry/DLQ state before increasing concurrency. Raising queue concurrency can overload PostgreSQL/external providers; change it in controlled increments and watch DB/provider pressure.

Do not delete queues to clear a backlog. Preserve job idempotency and DLQ evidence.

## 17. Failed scheduler

If scheduler readiness reports stopped/stale:

1. Check API/worker logs and PostgreSQL/Redis readiness.
2. Confirm scheduler is enabled and its worker ID/lock timeout are sane.
3. Inspect stale/claimed jobs and database locks without manually rewriting business rows.
4. Restart the scheduler process only after dependencies are healthy.
5. Confirm due work resumes once and is not duplicated.

## 18. MinIO / object-storage troubleshooting

Check `/minio/health/ready` through the loopback API endpoint and verify disk capacity. Confirm the bucket exists and that the bucket-scoped application user can list/read/write/delete only the configured bucket as required. Keep root credentials reserved for operations/backups.

If object backup fails, inspect available space, object checksum mismatch, network/storage errors, and Restic status. Do not mark the backup successful manually.

## 19. Printerly troubleshooting

Keep Printerly domain/business changes with its owning stream. Operations checks should verify runtime readiness, queue/backlog, scheduler/outbox workers, object access, printer/node connectivity, and logs. If Printerly is unhealthy, keep/restore its configured Cloudflare authority rather than forcing Node cutover.

When debugging a stuck print job, preserve idempotency/lease data and do not delete accounting/cost records to make the queue move.

## 20. NVR troubleshooting

Check MediaMTX/NVR process health, loopback RTSP/HLS/WebRTC bindings, disk usage, recording catalog state, camera reachability, timezone/clock sync, and archive/NAS availability. Keep NVR ports private; expose viewing only through the authenticated Ledgerly application path approved by the NVR stream.

A full NVR video archive is not silently copied into general backups. Configuration/catalog metadata is protected by Ledgerly backup; video retention/replication follows the NVR storage policy.

## 21. Disk-full emergency

The backup preflight refuses to start when configured free-space thresholds are not met. Health monitoring separately checks server and NVR storage utilization.

If disk usage becomes critical:

1. Stop nonessential writes/exports and NVR recording only if required to protect database integrity.
2. Identify the filesystem consuming space with `df`/`du`; do not randomly delete PostgreSQL, Redis, MinIO, Docker volume, or active backup files.
3. Remove only documented expired local backup sets/cache/logs after confirming off-site copies and retention policy.
4. Expand/move storage if durable data is consuming the space legitimately.
5. Re-run backup verification and service health after recovery.

## 22. Failed backup

A failed or stale backup is an incident. Inspect the backup logs and component manifest; determine whether failure is PostgreSQL dump validation, MinIO checksum/mirror, safe-config archive, insufficient disk, Restic upload/check, or retention.

Do not edit `last-success-set`/freshness markers manually. Fix the root cause, run a new backup, verify it, and perform a scratch restore when data-path integrity was in doubt.

## 23. Logs

Use Docker/systemd journals locally. Redact authorization headers, passwords, connection strings, tokens, and full environment dumps before sharing logs. Configure host log rotation so logs cannot fill the database/object volume. The admin surface reports status/metadata; it should not become a secret-bearing raw-log portal.

## 24. Updates policy

Production uses pinned, tested immutable image digests. Review security releases regularly, stage updates on a rehearsal host, create a verified backup and restore proof, then deploy during a controlled maintenance window. Do not automatically install major database/object-store/runtime upgrades on production.

OS security updates should follow the host's managed patch policy. Reboot only after verifying a recent off-site backup and scheduling downtime/failover.

## 25. Report/export limits and timeout strategy

Large reports/exports should remain bounded, paginated or asynchronous and use queue workers rather than holding unlimited HTTP requests/database sessions. Caddy enforces the public body-size limit; Node enforces declared body size and explicit request/header/keepalive timeouts. External notification/storage calls use their own bounded timeouts.

Do not solve a slow export by globally raising HTTP/DB timeouts. Diagnose the query, cap rows/bytes, move long work to an idempotent job, and retain cancellation/retry semantics.

## 26. Rehearsal and production gates

Static/safe validation:

```bash
sudo selfhost/ops/validate-production.sh
```

Live target-host validation (creates a fresh backup):

```bash
sudo OPS_LIVE_TESTS=true selfhost/ops/validate-production.sh
```

Disruptive rehearsal only on staging/pre-production or an approved maintenance window:

```bash
sudo OPS_LIVE_TESTS=true OPS_DESTRUCTIVE_TESTS=true \
  selfhost/ops/validate-production.sh
```

The destructive mode performs scratch restore validation plus API graceful-stop/restart, Redis reconnect/queue-scheduler recovery, and PgBouncer/database reconnect checks. It refuses to run unless explicitly enabled.

Set `OPS_PUBLIC_URL=https://ledgerly.example.com` during validation to assert that private admin/readiness/contracts endpoints are inaccessible through the public proxy.

Skipped checks are reported as skipped, not passed. A host is production-ready only when required checks have actually run in the target environment and any skips are understood/accepted by the release gate.
