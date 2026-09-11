#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"
ops_load_env
pool="${LEDGERLY_DATABASE_POOL_MAX:-20}"
pgb_pool="${PGBOUNCER_DEFAULT_POOL_SIZE:-40}"
reserve="${PGBOUNCER_RESERVE_POOL_SIZE:-10}"
pgmax="${POSTGRES_MAX_CONNECTIONS:-200}"
admin_reserve="${POSTGRES_ADMIN_RESERVED_CONNECTIONS:-20}"
for n in "$pool" "$pgb_pool" "$reserve" "$pgmax" "$admin_reserve"; do [[ "$n" =~ ^[0-9]+$ ]] || ops_die "connection limits must be integers"; done
(( pool <= pgb_pool + reserve )) || ops_die "Node pool ($pool) exceeds PgBouncer per-user capacity ($((pgb_pool+reserve)))"
(( pgb_pool + reserve <= pgmax - admin_reserve )) || ops_die "PgBouncer server pool can consume PostgreSQL administrative reserve"
printf 'Node DB pool max: %s\nPgBouncer default/reserve: %s/%s\nPostgreSQL max/admin reserve: %s/%s\n' "$pool" "$pgb_pool" "$reserve" "$pgmax" "$admin_reserve"
printf '%s\n' 'HTTP request concurrency is intentionally not derived from PostgreSQL connection count; database access remains bounded by the Node and PgBouncer pools.'
if [[ "${OPS_SKIP_DB_DIAGNOSTICS:-false}" != "true" ]]; then
  ops_require docker
  ops_compose exec -T postgres psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -f - < "$LEDGERLY_REPO_ROOT/selfhost/postgres/ops-diagnostics.sql"
fi
