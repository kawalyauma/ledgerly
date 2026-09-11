# Ledgerly Operations Validation Evidence

Branch: `selfhost/ops-dr-security-final`

This file records what the operations stream could and could not execute before integration. It is evidence, not a substitute for the production gates in `selfhost/ops/validate-production.sh`.

## Repository/static review completed

- Branch remains based on `selfhost/finance-runtime-migration`; the operations stream is ahead without rewriting application/business migrations.
- Backup/restore scripts, systemd scheduling, health/admin surfaces, Caddy/private-service exposure, least-privilege PostgreSQL/MinIO paths, bounded DB pools, Redis reconnect behavior, queue/scheduler health, disk safeguards, and operations runbooks were reviewed as one operations surface.
- `docs/SELFHOST_PERFORMANCE_AUDIT.md` records the finance-core index inspection and the rule that new workload indexes require representative `EXPLAIN (ANALYZE, BUFFERS)` evidence.
- The production validator is fail-closed for production TLS/site configuration, immutable image digests, non-owner PostgreSQL API credentials, bucket-scoped MinIO application credentials, bounded pools, restricted NVR origins, encrypted Restic off-site backup configuration, recent restore proof, and target-host live validation.

## GitHub Actions status

The final branch push triggered `Self-hosted Server CI` run `34622115512` for commit `5c00daf005b3736daa22caec6cf487ae4bba013b`. Both attempt 1 and attempt 2 failed before a GitHub-hosted runner was assigned: the `server` and `operations-static` jobs reported `runner_id: 0` and zero executed steps. No repository test command ran, and no test log was produced. Therefore those failures are recorded as unavailable CI infrastructure, not as passing or failing application tests.

## Environment limitations

The development execution environment used by this stream has no reachable Docker target host and no outbound Git clone access. Consequently it did not execute live PostgreSQL/Redis/MinIO/NVR services here.

The following must run on the integration/staging server and are intentionally enforced by the validator/runbook rather than claimed as already executed:

- rendered Compose validation against the actual production environment file;
- live service/readiness checks;
- fresh PostgreSQL + MinIO + safe-configuration backup generation;
- SHA/checksum/manifest verification;
- disposable PostgreSQL and MinIO restore rehearsal;
- public-edge proof that private administration endpoints are inaccessible;
- graceful API stop/restart;
- Redis reconnect plus queue/scheduler recovery;
- PgBouncer/database reconnect;
- representative finance query-plan analysis on staging data.

Run safe target-host validation with:

```bash
sudo OPS_LIVE_TESTS=true selfhost/ops/validate-production.sh
```

Run disruptive restart/restore fault injection only on staging/pre-production or an approved maintenance window:

```bash
sudo OPS_LIVE_TESTS=true OPS_DESTRUCTIVE_TESTS=true selfhost/ops/validate-production.sh
```

Production-mode validation fails when live validation, encrypted off-site configuration, or recent restore proof is missing. This prevents an integration-ready code branch from being mistaken for a fully proven production deployment.
