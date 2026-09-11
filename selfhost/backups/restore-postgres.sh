#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"
[[ $# -eq 1 ]] || die "usage: restore-postgres.sh BACKUP.dump"
BACKUP="$1"; [[ -s "$BACKUP" ]] || die "backup not found or empty: $BACKUP"
require_cmd docker; require_cmd sha256sum; load_runtime_env
[[ -f "$BACKUP.sha256" ]] || die "checksum file is required"
( cd "$(dirname "$BACKUP")" && sha256sum -c "$(basename "$BACKUP").sha256" >/dev/null )
compose exec -T postgres pg_restore --list <"$BACKUP" | awk '!/^;/ && NF {n++} END {exit !(n>0)}' || die "pg_restore structural validation failed"
TARGET_DB="${LEDGERLY_RESTORE_DATABASE:-$POSTGRES_DB}"
EXPECTED="RESTORE:$TARGET_DB"
[[ "${LEDGERLY_RESTORE_CONFIRM:-}" == "$EXPECTED" ]] || die "set LEDGERLY_RESTORE_CONFIRM=$EXPECTED to acknowledge destructive restore"
log "restoring PostgreSQL backup into $TARGET_DB"
compose exec -T postgres pg_restore -U "$POSTGRES_USER" --clean --if-exists --no-owner --no-acl --exit-on-error --dbname="$TARGET_DB" <"$BACKUP"
compose exec -T postgres psql -U "$POSTGRES_USER" -d "$TARGET_DB" -v ON_ERROR_STOP=1 -Atc "SELECT 1" | grep -qx 1 || die "post-restore SQL validation failed"
RELATIONS="$(compose exec -T postgres psql -U "$POSTGRES_USER" -d "$TARGET_DB" -Atv ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema');")"
[[ "$RELATIONS" =~ ^[0-9]+$ ]] && (( RELATIONS > 0 )) || die "restored database contains no application relations"
printf '{"status":"restored","database":"%s","relations":%s}\n' "$TARGET_DB" "$RELATIONS"
