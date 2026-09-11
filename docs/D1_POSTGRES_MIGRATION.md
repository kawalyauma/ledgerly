# D1 to PostgreSQL migration runbook

Status: active migration tooling

This runbook covers the controlled migration of Ledgerly data from Cloudflare D1 to the self-hosted PostgreSQL runtime. Cloudflare remains authoritative until validation and cutover are explicitly completed.

## Safety model

- The long-running Ledgerly API container does **not** receive the Cloudflare D1 API token.
- D1 credentials are supplied only to the Compose `migration` profile / `migrate-d1` one-shot container.
- Use a narrowly scoped Cloudflare API token that can read/query the Ledgerly D1 database; rotate or revoke it after migration.
- PostgreSQL IDs are preserved from D1.
- Every copied batch is upserted and its rowid checkpoint is advanced in the same PostgreSQL transaction.
- An interrupted run is resumable from its last committed D1 rowid.
- Row counts and relationship/orphan checks are recorded in `ledgerly_meta.migration_validations`.
- If D1 changes during a copy, the run records a source-stability warning. Final cutover requires a write pause followed by another migration/validation pass.
- A target row-count mismatch or relationship failure blocks the migration from being marked complete.

## First phase: auth/core identity

The first manifest copies these tables in dependency order:

1. `organizations`
2. `users`
3. `memberships`
4. `accounts`
5. `api_keys`
6. `sessions`
7. `school_user_profiles`
8. `school_login_aliases`
9. `school_user_mfa`
10. `school_login_events`

This phase exists before public self-hosted login is enabled so password hashes, roles/scopes, sessions, API keys, school aliases, lock state and MFA can be verified before any authentication cutover.

## Configuration

Copy the self-hosted environment example and set the normal PostgreSQL values plus:

```text
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_D1_DATABASE_ID=
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_API_BASE_URL=https://api.cloudflare.com/client/v4
LEDGERLY_D1_MIGRATION_BATCH_SIZE=250
LEDGERLY_D1_MIGRATION_HTTP_TIMEOUT_MS=15000
LEDGERLY_MIGRATION_DATABASE_POOL_MAX=4
```

Never commit real values.

## Plan

Start/verify PostgreSQL/PgBouncer, then inspect the D1 source before copying:

```bash
docker compose --env-file .env.selfhost -f compose.selfhost.yml up -d postgres pgbouncer

docker compose --env-file .env.selfhost -f compose.selfhost.yml \
  --profile migration run --rm migrate-d1 \
  node src/migration/cli.mjs plan
```

The plan reports required table presence, source row counts and dependency order. Missing auth/security tables are a hard blocker rather than being silently skipped.

## Run or resume

```bash
docker compose --env-file .env.selfhost -f compose.selfhost.yml \
  --profile migration run --rm migrate-d1 \
  node src/migration/cli.mjs run
```

By default the command resumes the latest incomplete/failed auth-core migration for the same D1 source. To deliberately create a new run:

```bash
docker compose --env-file .env.selfhost -f compose.selfhost.yml \
  --profile migration run --rm migrate-d1 \
  node src/migration/cli.mjs run --fresh
```

Do not use `--fresh` merely because a run was interrupted; resuming is safer and avoids repeating already checkpointed batches.

## Validate

The run command validates counts and relationships automatically. A specific run can be revalidated with:

```bash
docker compose --env-file .env.selfhost -f compose.selfhost.yml \
  --profile migration run --rm migrate-d1 \
  node src/migration/cli.mjs validate <RUN_ID>
```

Validation records are retained in PostgreSQL even when validation fails.

## Bookkeeping tables

Migration metadata is stored under `ledgerly_meta`:

- `migration_runs` — source, phase, status and run error.
- `migration_table_state` — per-table cursor, copied rows, source/target counts and error.
- `migration_validations` — row-count, source-stability and relationship checks.

Cloudflare API tokens and secrets are never stored in these tables.

## Final cutover rule

A rehearsal run while D1 is live is not a cutover. Before a domain becomes authoritative in PostgreSQL:

1. put that domain into an agreed write pause / maintenance window;
2. resume or start the final migration pass;
3. ensure D1 source counts are stable during the pass;
4. require every row-count and relationship validation to pass;
5. run domain-specific integrity checks (finance later additionally requires journal/balance reconciliation);
6. test the Node routes against PostgreSQL;
7. only then move that domain's traffic away from Cloudflare.

Never delete D1/R2/Worker resources simply because a copy exists in PostgreSQL.
