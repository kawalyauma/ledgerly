# Self-hosted Runtime, Jobs, and Storage

This branch finalizes the shared runtime primitives used by Ledgerly self-hosted modules. It intentionally does not move any business capability to Node authority; Cloudflare remains the fallback until the final integrator enables each validated cutover.

## Durable Redis jobs

Every runtime-created Redis queue now has five durable structures: ready, processing, visibility leases, delayed retries, and dead letters. Enqueue idempotency remains keyed by the caller-provided idempotency key. A claimed job receives a visibility lease. Long-running generic workers renew that lease. The recovery runner periodically returns expired claims to ready and also recovers processing-list entries that have no lease, covering a process crash between the durable list move and lease registration.

Delayed retries use a sorted set and are promoted only when due. Retry attempts are bounded by the queue max-attempt policy and exhausted work is dead-lettered. Unknown job kinds are dead-lettered instead of silently discarded.

The runtime owns the queue registry. Extensions must obtain queues from `createQueue`. Generic workers must be created with `createWorker`, which refuses unmanaged queues and applies bounded concurrency, poll intervals, exponential retry delays, visibility renewal, graceful drain, and status metrics. Creating a worker does not start it automatically; the owning extension controls when its domain is allowed to consume work.

### Queue settings

- `LEDGERLY_QUEUE_VISIBILITY_TIMEOUT_MS` default: 300000
- `LEDGERLY_QUEUE_RECOVERY_ENABLED` default: true
- `LEDGERLY_QUEUE_RECOVERY_INTERVAL_MS` default: 30000
- `LEDGERLY_QUEUE_RECOVERY_BATCH_SIZE` default: 100
- `LEDGERLY_JOB_WORKER_POLL_INTERVAL_MS` default: 500
- `LEDGERLY_JOB_WORKER_CONCURRENCY` default: 4
- `LEDGERLY_JOB_RETRY_BASE_MS` default: 1000
- `LEDGERLY_JOB_RETRY_MAX_MS` default: 300000

`/selfhost/ready` reports all managed queues, recovery status, and managed worker status. `/selfhost/contracts` reports the same runtime topology without enabling business authority.

## PostgreSQL scheduler interaction

The existing PostgreSQL scheduler remains the durable source for recurring schedules. Claims use `FOR UPDATE SKIP LOCKED`, have a stale-lock timeout, and enqueue an idempotent occurrence key before advancing the next run. During shutdown, scheduler intake is stopped before managed workers are drained so new work is not introduced while the runtime is closing.

## Object storage integrity

MinIO writes are tenant-key-safe and now include a SHA-256 object metadata value generated from the actual bytes. A caller-supplied SHA-256 value must match those bytes or the write fails before upload. After upload the adapter verifies the stored object size before reporting success. `head()` surfaces the persisted SHA-256 value and `verify()` can validate expected size/checksum, reading the object back when checksum metadata is unavailable.

This complements the D1/R2 to PostgreSQL/MinIO migration state in `ledgerly_meta.object_migration_state`; successful migration must be followed by validation rather than treating a successful copy command as proof of integrity.

## Validation

Focused tests added by this branch cover:

- visibility leases and expired-claim recovery
- orphaned processing recovery after the pre-lease crash window
- successful acknowledgement
- delayed retries
- unknown-kind dead letters
- runtime-wide queue recovery sweeps
- SHA-256 metadata persistence
- rejection of incorrect caller checksums
- fail-closed MinIO write-size verification

Run from `server/`:

```sh
npm test
npm run check
```

For real integration validation, Redis must be restarted while a claimed test job is in flight, then the job must become claimable again after the visibility deadline. MinIO validation must write a test object, compare size and SHA-256, restart MinIO, then repeat `head()`/`verify()` before deleting the test object. These tests should run with a non-production tenant and object prefix.

## Integration rules

Do not expose Redis or MinIO directly through Caddy. Do not use HTTP request concurrency as the Redis worker or PostgreSQL pool size. Do not start a Node worker for a domain whose cutover mode is still `cloudflare`. During final integration, resolve shared changes in `runtime.mjs`, `config.mjs`, `.env.selfhost.example`, and `redis-queue.mjs` by preserving both domain-specific routes and these recovery/integrity invariants.
