#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$0")/common.sh"
[[ $# -eq 1 ]] || die "usage: restore-objects.sh BACKUP_OBJECT_DIRECTORY"
SRC="$1"; [[ -d "$SRC" && -f "$SRC/SHA256SUMS" ]] || die "object backup directory is incomplete"
require_cmd docker; require_cmd sha256sum; load_runtime_env
( cd "$SRC" && sha256sum -c SHA256SUMS >/dev/null )
[[ "${LEDGERLY_RESTORE_OBJECTS_CONFIRM:-}" == "RESTORE_OBJECTS:$MINIO_DEFAULT_BUCKET" ]] || die "set LEDGERLY_RESTORE_OBJECTS_CONFIRM=RESTORE_OBJECTS:$MINIO_DEFAULT_BUCKET to continue"
MINIO_CID="$(compose ps -q minio)"; [[ -n "$MINIO_CID" ]] || die "MinIO container is not running"
REMOVE_FLAG=""; [[ "${LEDGERLY_RESTORE_OBJECTS_REMOVE_EXTRANEOUS:-false}" == "true" ]] && REMOVE_FLAG="--remove"
MC_IMAGE="${MINIO_MC_IMAGE:-minio/mc:latest}"
log "restoring object backup into bucket $MINIO_DEFAULT_BUCKET (remove_extraneous=${LEDGERLY_RESTORE_OBJECTS_REMOVE_EXTRANEOUS:-false})"
docker run --rm --network "container:$MINIO_CID" --user "$(id -u):$(id -g)" \
  -e MINIO_ROOT_USER -e MINIO_ROOT_PASSWORD -e MINIO_DEFAULT_BUCKET -e REMOVE_FLAG \
  -v "$SRC:/backup:ro" --entrypoint /bin/sh "$MC_IMAGE" -ec '
    export MC_CONFIG_DIR=/tmp/.mc
    mc alias set target http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
    mc ready target >/dev/null
    mc mb --ignore-existing "target/$MINIO_DEFAULT_BUCKET" >/dev/null
    mc mirror --overwrite $REMOVE_FLAG --exclude SHA256SUMS --exclude meta.json /backup "target/$MINIO_DEFAULT_BUCKET"
  '
printf '{"status":"restored","bucket":"%s","source":"%s"}\n' "$MINIO_DEFAULT_BUCKET" "$SRC"
