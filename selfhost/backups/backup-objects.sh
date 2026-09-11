#!/bin/sh
set -eu
umask 077
: "${MC_ALIAS:?MC_ALIAS is required}"
: "${MINIO_DEFAULT_BUCKET:=ledgerly}"
ROOT="${BACKUP_ROOT:-/backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$ROOT/objects/$STAMP"
mkdir -p "$DEST"
mc mirror --overwrite "$MC_ALIAS/$MINIO_DEFAULT_BUCKET" "$DEST"
find "$DEST" -type f -print0 | sort -z | xargs -0 sha256sum > "$DEST/SHA256SUMS"
