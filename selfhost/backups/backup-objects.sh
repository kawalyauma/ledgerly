#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"
require_cmd docker; require_cmd sha256sum
load_runtime_env; preflight_disk
SET_ID="${BACKUP_SET_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
DEST="$BACKUP_ROOT/objects/$SET_ID"; PARTIAL="$DEST.partial.$$"
rm -rf "$PARTIAL"; mkdir -p "$PARTIAL"; chmod 0700 "$PARTIAL"; trap 'rm -rf "$PARTIAL"' EXIT
MINIO_CID="$(compose ps -q minio)"; [[ -n "$MINIO_CID" ]] || die "MinIO container is not running"
log "mirroring MinIO bucket $MINIO_DEFAULT_BUCKET into $DEST"
docker run --rm --network "container:$MINIO_CID" --user "$(id -u):$(id -g)" \
  -e MINIO_ROOT_USER -e MINIO_ROOT_PASSWORD -e MINIO_DEFAULT_BUCKET \
  -v "$PARTIAL:/backup" --entrypoint /bin/sh minio/mc:latest -ec '
    export MC_CONFIG_DIR=/tmp/.mc
    mc alias set source http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
    mc ready source >/dev/null
    mc mirror --overwrite "source/$MINIO_DEFAULT_BUCKET" /backup
  '
COUNT="$(find "$PARTIAL" -type f | wc -l | tr -d ' ')"
PAYLOAD_BYTES="$(du -sb "$PARTIAL" | awk '{print $1}')"
cat <<JSON >"$PARTIAL/meta.json"
{"kind":"minio","set_id":"$SET_ID","created_at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","bucket":"$MINIO_DEFAULT_BUCKET","files":$COUNT,"payload_bytes":$PAYLOAD_BYTES,"checksums_verified":true}
JSON
TMP_SUMS="$PARTIAL/.SHA256SUMS.tmp"
find "$PARTIAL" -type f ! -name SHA256SUMS ! -name '.SHA256SUMS.tmp' -print0 | sort -z | xargs -0 -r sha256sum >"$TMP_SUMS"
mv "$TMP_SUMS" "$PARTIAL/SHA256SUMS"
( cd "$PARTIAL" && sha256sum -c SHA256SUMS >/dev/null )
chmod 0600 "$PARTIAL/meta.json" "$PARTIAL/SHA256SUMS"
mv "$PARTIAL" "$DEST"; trap - EXIT
printf '%s\n' "$DEST"
