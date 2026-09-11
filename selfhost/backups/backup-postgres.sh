#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"
require_cmd docker; require_cmd sha256sum
load_runtime_env; preflight_disk
SET_ID="${BACKUP_SET_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
OUT="$BACKUP_ROOT/postgres/ledgerly-$SET_ID.dump"
PARTIAL="$OUT.partial.$$"
trap 'rm -f "$PARTIAL"' EXIT
log "creating PostgreSQL custom-format backup $OUT"
compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --compress=6 --no-owner --no-acl >"$PARTIAL"
[[ -s "$PARTIAL" ]] || die "PostgreSQL dump is empty"
TOC_COUNT="$(compose exec -T postgres pg_restore --list <"$PARTIAL" | awk '!/^;/ && NF {n++} END {print n+0}')"
(( TOC_COUNT > 0 )) || die "pg_restore could not find any TOC entries"
SOURCE_RELATIONS="$(compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atv ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema');")"
[[ "$SOURCE_RELATIONS" =~ ^[0-9]+$ ]] || die "could not validate source relation count"
chmod 0600 "$PARTIAL"; mv -f "$PARTIAL" "$OUT"; trap - EXIT
SHA="$(sha256_of "$OUT")"; SIZE="$(size_of "$OUT")"
printf '%s  %s\n' "$SHA" "$(basename "$OUT")" >"$OUT.sha256"; chmod 0600 "$OUT.sha256"
cat <<JSON | atomic_write "$OUT.meta.json"
{"kind":"postgresql","set_id":"$SET_ID","created_at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","database":"$POSTGRES_DB","bytes":$SIZE,"sha256":"$SHA","pg_restore_toc_entries":$TOC_COUNT,"source_relations":$SOURCE_RELATIONS,"validated":true}
JSON
printf '%s\n' "$OUT"
