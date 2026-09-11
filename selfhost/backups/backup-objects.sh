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
TMP_SUMS="$DEST/.SHA256SUMS.tmp"
find "$DEST" -type f ! -name 'SHA256SUMS' ! -name '.SHA256SUMS.tmp' -print0 \
  | sort -z \
  | xargs -0 -r sha256sum > "$TMP_SUMS"
mv "$TMP_SUMS" "$DEST/SHA256SUMS"
