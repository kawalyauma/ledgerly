# Ledgerly Self-Hosted Performance Audit

This document records the operations-stream performance findings and the production diagnostic procedure. It deliberately does not invent finance-domain indexes without representative query-plan evidence.

## Connection budget

Ledgerly keeps HTTP concurrency separate from PostgreSQL connection count. The default Node process pool is bounded at 20 connections. PgBouncer defaults to a 40-connection transaction pool plus a 10-connection reserve, with a 70-connection database cap. PostgreSQL defaults to 200 connections with 20 reserved operationally for administration/recovery headroom.

`selfhost/ops/performance-audit.sh` fails when a Node pool exceeds its PgBouncer per-user capacity or when PgBouncer can consume the PostgreSQL administrative reserve. When scaling to multiple API/worker processes, calculate the aggregate pool budget; do not multiply the per-process pool blindly.

## Finance index audit

The PostgreSQL finance-core schema already contains tenant-qualified access paths for the major accounting reads/writes:

- contacts: `(organization_id, type)`
- journal entries: `(organization_id, posting_date, status)` and `(organization_id, source_type, source_id)`
- journal lines: `(organization_id, journal_entry_id)`, `(organization_id, account_id)`, `(organization_id, contact_id)`
- documents/ageing: `(organization_id, type, status, due_date)`
- payments: `(organization_id, payment_date, status)`
- payment allocations: `(organization_id, document_id)`
- budget lines: `(organization_id, budget_id, period)`

Finance writes additionally rely on tenant-qualified unique/idempotency constraints for journal entry numbers/idempotency keys, document numbers, payment numbers/idempotency keys, and payment/document allocations.

The broader finance-operations, School Fees, Payroll and Printerly schemas have workload-specific indexes and constraints owned by their migration streams. The operations stream does not add speculative indexes merely because a table exists.

## Query-plan gate

On representative staging data, identify real expensive statements using `pg_stat_statements` and `selfhost/postgres/ops-diagnostics.sql`. For candidate read queries run:

```sql
EXPLAIN (ANALYZE, BUFFERS, WAL, SETTINGS) <representative SELECT>;
```

Use realistic organization/date/status predicates and realistic cardinality. Never run `EXPLAIN ANALYZE` on destructive production writes. Capture baseline execution time, rows estimated/actual, buffer hits/reads, lock waits and the proposed plan before adding an index. Re-run after the candidate index and retain the evidence with the change review.

High sequential-scan counts or an `idx_scan = 0` counter are investigation signals, not automatic reasons to add/drop an index.

## Slow-query diagnostics

PostgreSQL enables `pg_stat_statements` in the self-hosted bootstrap and logs statements above the configured slow-query duration. The operations diagnostics expose connection pressure, idle-in-transaction sessions, long-running statements, blockers, sequential scans, unused-index candidates, dead tuples/autovacuum state and top statement execution time.

During an incident, fix long transactions, missing predicates, lock contention or pathological plans before raising connection limits.

## Redis and queues

The Redis client uses a bounded reconnect backoff capped at three seconds. Queue/cache readiness is part of the Node readiness payload, and the restart rehearsal verifies Redis recovery plus queue/scheduler reconnection after a controlled Redis restart.

Keep worker concurrency bounded. Increasing queue consumers increases PostgreSQL and external-provider pressure even when Redis itself is healthy. Preserve idempotency/retry/DLQ semantics rather than clearing queues or launching unbounded workers.

## HTTP, reports and exports

Caddy enforces the public request-body cap and Node enforces request/header/keepalive timeouts plus a bounded per-client rate limiter. These controls are independent of the database pool.

Large reports/exports should be paginated, size-limited or moved to idempotent queue jobs. Do not solve a slow export by globally increasing HTTP, PgBouncer or PostgreSQL timeouts. Heavy report/export concurrency should have its own bounded worker budget so it cannot consume the request-serving database pool.

## Runtime scaling gate

Before increasing API replicas or worker concurrency:

1. measure current PgBouncer server/client usage and PostgreSQL active/idle counts;
2. multiply per-process Node pool size by the maximum simultaneous processes;
3. retain database administration/recovery headroom;
4. inspect queue depth/provider latency and slow statements;
5. load-test representative finance reads/writes on staging;
6. run `selfhost/ops/performance-audit.sh` and the full health/restart rehearsal.

No live `EXPLAIN (ANALYZE, BUFFERS)` results are recorded here because this development environment did not have representative production PostgreSQL data. The runbook makes that target-host/staging evidence an operational gate rather than pretending static schema inspection proves optimal plans.
