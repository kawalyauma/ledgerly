# Ledgerly self-hosted readiness gates

These checks turn the final cutover requirements into repeatable commands. They do **not** switch authority and they do not remove the Cloudflare fallback.

## 1. Migration evidence

After the final write-pause migration and `migration:rehearsal -- cutover-validate`, run from `server/`:

```bash
npm run readiness:migration
```

The command requires, for every selected migration phase:

- a completed migration run created with `requireStableSource=true`;
- a passing row-count validation for every table;
- a passing source-stability validation for every table;
- a passing final-cutover-source-stability validation for every table;
- passing relationship/orphan validations declared by the phase.

By default all registered phases are required. `LEDGERLY_READINESS_PHASES` may restrict the command during a domain rehearsal, but must be blank for the final all-domain cutover check.

Before treating the phase graph as complete, also run:

```bash
npm run migration:coverage
```

`migration:coverage` inventories every D1 table created by the repository migration history and verifies that each source table has one registered PostgreSQL migration-phase owner or an explicit reviewed exception in `src/migration/coverage-allowlist.json`. It fails for uncovered source tables and duplicate copy ownership. The exception policy is empty by default; see `docs/SELFHOST_MIGRATION_COVERAGE.md` before adding any exception.

The coverage command is intentionally a separate cutover prerequisite for now. Do not claim migration coverage is complete until its JSON report from the exact release commit has been reviewed and archived.

## 2. Complete machine-readable cutover check

Configure:

```bash
export LEDGERLY_SELFHOST_BASE_URL=http://127.0.0.1:8788
export LEDGERLY_BACKUP_ROOT=/backups
export LEDGERLY_BACKUP_MAX_AGE_HOURS=26
```

Then run:

```bash
npm run readiness:cutover
```

This fails closed unless:

1. migration evidence passes;
2. `GET /selfhost/ready` returns a healthy ready response;
3. the newest PostgreSQL and object-storage backups are within the permitted age;
4. the PostgreSQL dump checksum is verified and every object backup file matches `SHA256SUMS`;
5. the repository security/exposure policy passes for the base Compose file, AI overlay, finance/NVR overlay and Caddy edge configuration.

The output is JSON and should be archived with the cutover record.

A successful readiness command does **not** by itself authorize cutover. Migration coverage, restore, load, financial reconciliation, object migration, Printerly, NVR and AI operational checks still apply.

## 3. Security / exposure policy

Run the static exposure check independently from `server/` with:

```bash
npm run readiness:security
```

The policy is fail-closed:

- PostgreSQL, PgBouncer, Redis, MinIO API/console and the Node API may only publish loopback host ports;
- `ledgerly_backend` must remain an internal Docker network;
- an overlay may not make the backend external or explicitly disable its internal flag;
- Caddy HTTP/HTTPS are approved public edge ports;
- MediaMTX WebRTC UDP `8189` is the only approved public NVR media binding in the current overlay;
- MediaMTX RTSP, HLS and WebRTC HTTP endpoints remain loopback-only;
- Ollama currently publishes no host port;
- any unknown service that publishes a host port is rejected unless it is deliberately added to the reviewed allowlist;
- Caddy administration must remain disabled and the expected nosniff/frame/referrer/server-header hardening must remain configured;
- Caddy must not reverse-proxy PostgreSQL, PgBouncer, Redis or MinIO directly.

This static gate catches configuration regressions before deployment. On the target Linux host, also inspect the real listener surface after Compose starts:

```bash
sudo ss -lntup
```

Confirm the configured PostgreSQL, PgBouncer, Redis, MinIO and Node API host ports are listening only on `127.0.0.1`/`::1`; only the intentionally exposed Caddy and approved media ports should be reachable from the LAN/WAN according to your firewall design.

If the repository is not the parent directory of `server/`, set `LEDGERLY_REPOSITORY_ROOT` before running the readiness commands.

## 4. Bounded HTTP load smoke

The load tool performs GET requests only. The default target is `/selfhost/ready`, making the default run non-mutating.

```bash
export LEDGERLY_SELFHOST_BASE_URL=http://127.0.0.1:8788
npm run readiness:load
```

Defaults:

- 200 requests;
- concurrency 10;
- 5 second request timeout;
- maximum error rate 1%;
- maximum p95 latency 1000 ms.

Tune with:

```bash
LEDGERLY_LOAD_REQUESTS=1000 \
LEDGERLY_LOAD_CONCURRENCY=25 \
LEDGERLY_LOAD_MAX_ERROR_RATE=0.005 \
LEDGERLY_LOAD_MAX_P95_MS=750 \
npm run readiness:load
```

Do not point `LEDGERLY_LOAD_PATH` at a mutating endpoint. For authenticated read-path load testing, use a dedicated test tenant and a separate purpose-built load harness rather than embedding production credentials in this command.

## 5. Safe PostgreSQL restore drill

A backup is not valid merely because `pg_dump` returned exit code 0. Run a disposable restore drill:

```bash
selfhost/backups/test-restore-postgres.sh /backups/postgres/ledgerly-YYYYMMDDTHHMMSSZ.dump
```

The script:

- requires the `.sha256` sidecar and verifies it;
- verifies the dump archive can be listed by `pg_restore`;
- creates a disposable database;
- refuses any test database name not beginning with `ledgerly_restore_test_`;
- refuses to restore into the current `PGDATABASE`;
- restores with `--exit-on-error`;
- verifies `organizations`, `users` and `ledgerly_meta.migration_runs` exist;
- records organization/user counts;
- removes the disposable database automatically unless `LEDGERLY_TEST_RESTORE_KEEP_DATABASE=1`.

Example with an explicit test database:

```bash
LEDGERLY_TEST_RESTORE_DATABASE=ledgerly_restore_test_rehearsal_01 \
selfhost/backups/test-restore-postgres.sh /backups/postgres/ledgerly-20260911T100000Z.dump
```

Never weaken the required `ledgerly_restore_test_` prefix. It is a guard against accidentally dropping/restoring the production database.

## 6. Final cutover evidence bundle

Archive at minimum:

- `migration:coverage` JSON from the exact release commit;
- `migration:rehearsal -- cutover-validate` JSON;
- `readiness:migration` JSON;
- `readiness:security` JSON;
- `readiness:cutover` JSON;
- `readiness:load` JSON;
- disposable restore-drill JSON;
- object migration count/checksum report;
- finance reconciliation results;
- target-host `ss -lntup`/firewall exposure evidence;
- Printerly/NVR/AI health evidence;
- rollback decision and Cloudflare fallback status.

Do not set self-hosted production authority until the full evidence bundle is complete and the Cloudflare rollback path is still available.
