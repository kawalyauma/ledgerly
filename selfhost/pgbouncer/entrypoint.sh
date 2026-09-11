#!/bin/sh
set -eu

: "${DATABASE_HOST:?DATABASE_HOST is required}"
: "${DATABASE_PORT:=5432}"
: "${DATABASE_NAME:?DATABASE_NAME is required}"
: "${DATABASE_USER:?DATABASE_USER is required}"
: "${DATABASE_PASSWORD:?DATABASE_PASSWORD is required}"
: "${DATABASE_APP_USER:=}"
: "${DATABASE_APP_PASSWORD:=}"
: "${PGBOUNCER_POOL_MODE:=transaction}"
: "${PGBOUNCER_DEFAULT_POOL_SIZE:=40}"
: "${PGBOUNCER_RESERVE_POOL_SIZE:=10}"
: "${PGBOUNCER_MAX_DB_CONNECTIONS:=70}"
: "${PGBOUNCER_MAX_CLIENT_CONN:=1000}"
: "${PGBOUNCER_QUERY_TIMEOUT:=120}"
: "${PGBOUNCER_CLIENT_IDLE_TIMEOUT:=300}"
: "${PGBOUNCER_IDLE_TRANSACTION_TIMEOUT:=60}"
: "${PGBOUNCER_SERVER_IDLE_TIMEOUT:=600}"
: "${PGBOUNCER_SERVER_LIFETIME:=3600}"

mkdir -p /etc/pgbouncer
chmod 0700 /etc/pgbouncer

# Password material is generated only inside the container. The admin role is
# retained for migrations/maintenance; production API traffic should use the
# optional non-superuser app role provisioned by provision-app-role.sh.
printf '"%s" "%s"\n' "$DATABASE_USER" "$DATABASE_PASSWORD" > /etc/pgbouncer/userlist.txt
if [ -n "$DATABASE_APP_USER" ]; then
  [ -n "$DATABASE_APP_PASSWORD" ] || { echo "DATABASE_APP_PASSWORD is required when DATABASE_APP_USER is set" >&2; exit 1; }
  printf '"%s" "%s"\n' "$DATABASE_APP_USER" "$DATABASE_APP_PASSWORD" >> /etc/pgbouncer/userlist.txt
fi
chmod 0600 /etc/pgbouncer/userlist.txt

cat > /etc/pgbouncer/pgbouncer.ini <<EOF2
[databases]
${DATABASE_NAME} = host=${DATABASE_HOST} port=${DATABASE_PORT} dbname=${DATABASE_NAME}

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
unix_socket_dir = /tmp
auth_type = scram-sha-256
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = ${PGBOUNCER_POOL_MODE}
max_client_conn = ${PGBOUNCER_MAX_CLIENT_CONN}
default_pool_size = ${PGBOUNCER_DEFAULT_POOL_SIZE}
reserve_pool_size = ${PGBOUNCER_RESERVE_POOL_SIZE}
reserve_pool_timeout = 3
max_db_connections = ${PGBOUNCER_MAX_DB_CONNECTIONS}
query_timeout = ${PGBOUNCER_QUERY_TIMEOUT}
client_idle_timeout = ${PGBOUNCER_CLIENT_IDLE_TIMEOUT}
idle_transaction_timeout = ${PGBOUNCER_IDLE_TRANSACTION_TIMEOUT}
server_idle_timeout = ${PGBOUNCER_SERVER_IDLE_TIMEOUT}
server_lifetime = ${PGBOUNCER_SERVER_LIFETIME}
server_reset_query = DISCARD ALL
server_reset_query_always = 1
server_check_delay = 10
server_check_query = SELECT 1
ignore_startup_parameters = extra_float_digits
log_connections = 1
log_disconnections = 1
log_pooler_errors = 1
stats_period = 60
admin_users = ${DATABASE_USER}
stats_users = ${DATABASE_USER}
EOF2

exec pgbouncer /etc/pgbouncer/pgbouncer.ini
