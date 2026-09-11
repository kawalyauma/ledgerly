#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/../ops/common.sh"
ops_require docker
ops_load_env
: "${LEDGERLY_DATABASE_APP_USER:?set LEDGERLY_DATABASE_APP_USER}"
: "${LEDGERLY_DATABASE_APP_PASSWORD:?set LEDGERLY_DATABASE_APP_PASSWORD}"
[[ "$LEDGERLY_DATABASE_APP_USER" =~ ^[a-zA-Z_][a-zA-Z0-9_]{0,62}$ ]] || ops_die "LEDGERLY_DATABASE_APP_USER is not a safe PostgreSQL identifier"
[[ "$LEDGERLY_DATABASE_APP_USER" != "$POSTGRES_USER" ]] || ops_die "application role must not be the PostgreSQL owner/superuser"

ops_compose exec -T postgres psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
  --set=app_user="$LEDGERLY_DATABASE_APP_USER" --set=app_password="$LEDGERLY_DATABASE_APP_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION', :'app_user', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user') \gexec
SELECT format('ALTER ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION', :'app_user', :'app_password') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'app_user') \gexec
SELECT format('GRANT USAGE ON SCHEMA %I TO %I', nspname, :'app_user')
FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema' \gexec
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO %I', nspname, :'app_user')
FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema' \gexec
SELECT format('GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA %I TO %I', nspname, :'app_user')
FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema' \gexec
SELECT format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA %I TO %I', nspname, :'app_user')
FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema' \gexec
SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', nspname, :'app_user')
FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema' \gexec
SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO %I', nspname, :'app_user')
FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema' \gexec
SQL

echo "Provisioned non-superuser runtime role $LEDGERLY_DATABASE_APP_USER. Restart PgBouncer and API after setting the app credentials."
