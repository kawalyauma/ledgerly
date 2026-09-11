#!/bin/sh
set -eu
umask 077
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ROOT="${BACKUP_ROOT:-/backups}"
KEEP_DAYS="${BACKUP_RETENTION_DAYS:-30}"
mkdir -p "$ROOT/postgres"
OUT="$ROOT/postgres/ledgerly-$STAMP.dump"
pg_dump --format=custom --no-owner --no-acl --file="$OUT" "$PGDATABASE"
sha256sum "$OUT" > "$OUT.sha256"
find "$ROOT/postgres" -type f -mtime "+$KEEP_DAYS" -delete
printf '%s\n' "$OUT"
