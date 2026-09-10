#!/bin/sh
set -eu

: "${DATABASE_HOST:?DATABASE_HOST is required}"
: "${DATABASE_PORT:=5432}"
: "${DATABASE_NAME:?DATABASE_NAME is required}"
: "${DATABASE_USER:?DATABASE_USER is required}"
: "${DATABASE_PASSWORD:?DATABASE_PASSWORD is required}"
: "${PGBOUNCER_POOL_MODE:=transaction}"
: "${PGBOUNCER_DEFAULT_POOL_SIZE:=40}"
: "${PGBOUNCER_MAX_CLIENT_CONN:=1000}"

mkdir -p /etc/pgbouncer
chmod 0700 /etc/pgbouncer

# PgBouncer accepts a clear-text password in auth_file and uses SCRAM on the
# client connection. The auth file is generated inside the container and never
# committed to the repository.
printf '"%s" "%s"\n' "$DATABASE_USER" "$DATABASE_PASSWORD" > /etc/pgbouncer/userlist.txt
chmod 0600 /etc/pgbouncer/userlist.txt

cat > /etc/pgbouncer/pgbouncer.ini <<EOF
[databases]
${DATABASE_NAME} = host=${DATABASE_HOST} port=${DATABASE_PORT} dbname=${DATABASE_NAME} user=${DATABASE_USER} password=${DATABASE_PASSWORD}

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
unix_socket_dir = /tmp
auth_type = scram-sha-256
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = ${PGBOUNCER_POOL_MODE}
max_client_conn = ${PGBOUNCER_MAX_CLIENT_CONN}
default_pool_size = ${PGBOUNCER_DEFAULT_POOL_SIZE}
reserve_pool_size = 10
reserve_pool_timeout = 3
server_reset_query = DISCARD ALL
server_check_delay = 10
server_check_query = SELECT 1
ignore_startup_parameters = extra_float_digits
log_connections = 1
log_disconnections = 1
log_pooler_errors = 1
stats_period = 60
admin_users = ${DATABASE_USER}
stats_users = ${DATABASE_USER}
EOF

exec pgbouncer /etc/pgbouncer/pgbouncer.ini
