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
- Migration prerequisites are enforced against completed runs for the **same D1 source identity**. A dependent phase cannot silently run against an empty prerequisite schema.

## Registered phases

List the phase registry without connecting to D1:

```bash
cd server
npm run migration:phases
```

Current phases:

### `auth-core`

The auth/core manifest copies these tables in dependency order:

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

### `school-reference`

Prerequisite: completed `auth-core` run for the same D1 source.

This phase copies the shared school/academic reference graph used by dynamic year/term/class/subject selection:

1. `school_profiles`
2. `school_branches`
3. `school_academic_years`
4. `school_terms`
5. `school_departments`
6. `school_class_levels`
7. `school_classes`
8. `school_streams`
9. `school_subjects`
10. `school_class_subjects`
11. `school_lesson_periods`

Department parent and class-level promotion self-references are finalized only after their rows have been copied, then relationship validation checks the finished graph.

## Configuration

Copy the self-hosted environment example and set the normal PostgreSQL values plus:

```text
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_D1_DATABASE_ID=
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_API_BASE_URL=https://api.cloudflare.com/client/v4
LEDGERLY_MIGRATION_PHASE=auth-core
LEDGERLY_D1_MIGRATION_BATCH_SIZE=250
LEDGERLY_D1_MIGRATION_HTTP_TIMEOUT_MS=15000
LEDGERLY_MIGRATION_DATABASE_POOL_MAX=4
```

Never commit real values.

## Start PostgreSQL/PgBouncer

```bash
docker compose --env-file .env.selfhost -f compose.selfhost.yml up -d postgres pgbouncer
```

## Plan a phase

For auth/core:

```bash
LEDGERLY_MIGRATION_PHASE=auth-core \
  docker compose --env-file .env.selfhost -f compose.selfhost.yml \
  --profile migration run --rm migrate-d1 \
  node src/migration/cli.mjs plan --phase auth-core
```

For school reference data:

```bash
LEDGERLY_MIGRATION_PHASE=school-reference \
  docker compose --env-file .env.selfhost -f compose.selfhost.yml \
  --profile migration run --rm migrate-d1 \
  node src/migration/cli.mjs plan --phase school-reference
```

The plan reports required table presence, source row counts, dependencies and prerequisite phases. Planning is read-only; the prerequisite gate is enforced when running or validating a phase.

## Run or resume a phase

Auth/core:

```bash
LEDGERLY_MIGRATION_PHASE=auth-core \
  docker compose --env-file .env.selfhost -f compose.selfhost.yml \
  --profile migration run --rm migrate-d1 \
  node src/migration/cli.mjs run --phase auth-core
```

School reference, after auth/core completed:

```bash
LEDGERLY_MIGRATION_PHASE=school-reference \
  docker compose --env-file .env.selfhost -f compose.selfhost.yml \
  --profile migration run --rm migrate-d1 \
  node src/migration/cli.mjs run --phase school-reference
```

By default the command resumes the latest incomplete/failed migration for the same D1 source **and phase**. To deliberately create a new run:

```bash
node src/migration/cli.mjs run --phase auth-core --fresh
```

Do not use `--fresh` merely because a run was interrupted; resuming is safer and avoids repeating already checkpointed batches.

A fresh run does not erase target data. Stable-key upserts remain in effect, so domain-specific validation is still mandatory.

## Validate

The run command validates counts and relationships automatically. A specific run can be revalidated with:

```bash
LEDGERLY_MIGRATION_PHASE=auth-core \
  docker compose --env-file .env.selfhost -f compose.selfhost.yml \
  --profile migration run --rm migrate-d1 \
  node src/migration/cli.mjs validate <RUN_ID> --phase auth-core
```

or:

```bash
LEDGERLY_MIGRATION_PHASE=school-reference \
  docker compose --env-file .env.selfhost -f compose.selfhost.yml \
  --profile migration run --rm migrate-d1 \
  node src/migration/cli.mjs validate <RUN_ID> --phase school-reference
```

Validation records are retained in PostgreSQL even when validation fails.

## Bookkeeping tables

Migration metadata is stored under `ledgerly_meta`:

- `migration_runs` — source, phase, status and run error.
- `migration_table_state` — per-table cursor, copied rows, source/target counts and error.
- `migration_validations` — row-count, source-stability and relationship checks.

Cloudflare API tokens and secrets are never stored in these tables.

## Source mutation warnings

The runner records each table's D1 count before and after its copy. A changed count becomes a `warning`, not an automatic pass for production cutover.

A rehearsal while D1 is live is expected to detect occasional drift. Before final cutover, use a controlled write pause or another approved final-delta procedure and rerun validation against a stable source.

## Failure handling

If a D1 request, PostgreSQL transaction, or process fails mid-table, rerun the same phase. The row checkpoint advances only in the same transaction as the copied batch, so the next attempt starts after the last successfully committed D1 rowid.

Never manually advance `ledgerly_meta.migration_table_state.last_rowid` to skip a failing record. Diagnose the record/schema problem instead.

If a dependent phase reports an unmet prerequisite, complete and validate the named prerequisite against the same D1 database identity first. Do not bypass the prerequisite record manually.

## Final cutover rule

A rehearsal run while D1 is live is not a cutover. Before a domain becomes authoritative in PostgreSQL:

1. put that domain into an agreed write pause / maintenance window, or use a tested final-delta procedure;
2. resume or start the final migration pass;
3. ensure D1 source counts are stable during the pass;
4. require every row-count and relationship validation to pass;
5. run domain-specific integrity checks (finance later additionally requires journal/balance reconciliation);
6. test the Node routes against PostgreSQL;
7. only then move that domain's traffic away from Cloudflare.

A migration phase being `completed` means its configured copy and validations passed for that run. It does **not** automatically make the Node route authoritative.

Never delete D1/R2/Worker resources simply because a copy exists in PostgreSQL.
